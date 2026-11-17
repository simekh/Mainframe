import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncPrompt, type SyncStep } from '../todo/syncRun';
import type { AgentSetting, SyncAdapter } from './agent';
import type { Run } from './codexInstructions';
import { CODEX_SYNC_SCHEMA_JSON, codexNamespace, codexSyncArgv, codexSyncConfig, listCodexServers, makeCodexSync, readCodexAnswer, strictJsonSchema } from './codexSync';

const jsonl = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n');
const message = (text: string) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
const NONE = '{"kind":"none","message":"No tracker","connector":null,"readTools":null,"lists":null,"source":null,"cards":null}';

describe('strictJsonSchema', () => {
  it('requires every property, makes the optional ones nullable and closes the object', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };
    expect(strictJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      required: ['a', 'b'],
      additionalProperties: false,
    });
  });

  it('makes an object inside items strict and leaves its input alone', () => {
    const schema = { type: 'array', items: { type: 'object', properties: { x: { type: 'number' } } } };
    const copy = structuredClone(schema);
    expect(strictJsonSchema(schema)).toEqual({
      type: 'array',
      items: { type: 'object', properties: { x: { anyOf: [{ type: 'number' }, { type: 'null' }] } }, required: ['x'], additionalProperties: false },
    });
    expect(schema).toEqual(copy);
  });
});

describe('CODEX_SYNC_SCHEMA_JSON', () => {
  it('is strict at every object, and message is a string or null', () => {
    const schema = JSON.parse(CODEX_SYNC_SCHEMA_JSON);
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      const n = node as Record<string, unknown>;
      if (n.properties) objects.push(n);
      Object.values(n).forEach(walk);
    };
    walk(schema);
    expect(objects.length).toBeGreaterThan(1);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect(o.required).toEqual(Object.keys(o.properties as object));
    }
    expect(schema.properties.message).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });
});

describe('codexNamespace', () => {
  it('turns every character outside letters, digits and underscore into an underscore', () => {
    expect(codexNamespace('my-trk')).toBe('my_trk');
    expect(codexNamespace('a_b9')).toBe('a_b9');
  });
});

describe('readCodexAnswer', () => {
  it('reads the agent message and drops the nulls', () => {
    const out = jsonl(
      { type: 'thread.started', thread_id: 't' },
      { type: 'item.completed', item: { type: 'error', message: 'Model metadata not found' } },
      message(NONE),
      { type: 'turn.completed' },
    );
    const answer = readCodexAnswer(out, []);
    expect(answer).toEqual({ kind: 'none', message: 'No tracker' });
    expect(answer).not.toHaveProperty('connector');
  });

  it('reads the last of two agent messages', () => {
    const out = jsonl(message('thinking aloud'), message(NONE));
    expect(readCodexAnswer(out, [])).toEqual({ kind: 'none', message: 'No tracker' });
  });

  it('skips lines that are not JSON', () => {
    expect(readCodexAnswer(`warning: something\n${jsonl(message(NONE))}`, [])).toEqual({ kind: 'none', message: 'No tracker' });
  });

  it('throws when the turn failed', () => {
    expect(() => readCodexAnswer(jsonl({ type: 'turn.failed', error: { message: 'rate limited' } }), [])).toThrow('The sync run failed: rate limited');
    expect(() => readCodexAnswer(jsonl({ type: 'error', message: 'boom' }), [])).toThrow('The sync run failed: boom');
  });

  it('throws when a tool outside the allowed ones completed', () => {
    const call = (status: string) => jsonl({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'my-trk', tool: 'create_card', status } }, message(NONE));
    const tools = ['mcp__my_trk__get_card'];
    expect(() => readCodexAnswer(call('completed'), tools)).toThrow("The sync used a tool that wasn't allowed: mcp__my_trk__create_card");
    expect(() => readCodexAnswer(call('failed'), tools)).not.toThrow();
  });

  it('allows a tool that was named', () => {
    const out = jsonl({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'my-trk', tool: 'get_card', status: 'completed' } }, message(NONE));
    expect(() => readCodexAnswer(out, ['mcp__my_trk__get_card'])).not.toThrow();
  });

  it('throws without an agent message', () => {
    expect(() => readCodexAnswer(jsonl({ type: 'turn.completed' }), [])).toThrow('The sync run ended without an answer');
  });

  it('throws when the answer is not JSON or has the wrong shape', () => {
    expect(() => readCodexAnswer(jsonl(message('not json')), [])).toThrow("The sync run's answer wasn't JSON");
    expect(() => readCodexAnswer(jsonl(message('{"kind":"bogus"}')), [])).toThrow("The sync run's answer didn't have the shape Mainframe asked for");
  });
});

describe('codexSyncConfig', () => {
  const FEATURES = ['features.shell_tool=false', 'web_search="disabled"', 'features.multi_agent=false', 'features.apps=false', 'features.goals=false'];

  it('lets discover see every server but approve nothing', () => {
    expect(codexSyncConfig({ kind: 'discover' }, [], ['trk', 'my-trk'])).toEqual([
      ...FEATURES,
      'mcp_servers.trk.default_tools_approval_mode="prompt"',
      'mcp_servers.my-trk.default_tools_approval_mode="prompt"',
    ]);
  });

  it('lets a read call the confirmed tools alone', () => {
    const tools = ['mcp__my_trk__get_card', 'mcp__my_trk__list_cards'];
    expect(codexSyncConfig({ kind: 'read', list: null }, tools, ['trk', 'my-trk'])).toEqual([
      ...FEATURES,
      'mcp_servers.trk.enabled=false',
      'mcp_servers.my-trk.enabled_tools=["get_card","list_cards"]',
      'mcp_servers.my-trk.default_tools_approval_mode="prompt"',
      'mcp_servers.my-trk.tools.get_card.approval_mode="approve"',
      'mcp_servers.my-trk.tools.list_cards.approval_mode="approve"',
    ]);
  });

  it("refuses a server name it can't pass, also in a read", () => {
    const refusal = `Codex's MCP server "a.b" has a name Mainframe can't pass to Codex`;
    expect(() => codexSyncConfig({ kind: 'discover' }, [], ['a.b'])).toThrow(refusal);
    expect(() => codexSyncConfig({ kind: 'read', list: null }, ['mcp__trk__x'], ['trk', 'a.b'])).toThrow(refusal);
  });

  it('refuses a tool that matches no server or two', () => {
    const refusal = (name: string) => `Sync again to find the tools: "${name}" doesn't match one of Codex's MCP servers`;
    expect(() => codexSyncConfig({ kind: 'read', list: null }, ['mcp__other__x'], ['trk'])).toThrow(refusal('mcp__other__x'));
    expect(() => codexSyncConfig({ kind: 'read', list: null }, ['mcp__a_b__x'], ['a_b', 'a-b'])).toThrow(refusal('mcp__a_b__x'));
  });

  it("refuses a tool name it can't pass", () => {
    expect(() => codexSyncConfig({ kind: 'read', list: null }, ['mcp__trk__a.b'], ['trk'])).toThrow(
      `Codex's MCP tool "mcp__trk__a.b" has a name Mainframe can't pass to Codex`,
    );
  });
});

describe('codexSyncArgv', () => {
  it('runs codex exec read-only in the project with the schema and every setting', () => {
    expect(codexSyncArgv({ bin: '/b/codex', projectDir: '/p', schemaFile: '/d/s.json', config: ['a=1', 'b=2'] })).toEqual([
      '/b/codex', 'exec', '--json', '--ephemeral', '-s', 'read-only', '-C', '/p', '--output-schema', '/d/s.json', '-c', 'a=1', '-c', 'b=2', '-',
    ]);
  });
});

describe('listCodexServers', () => {
  const base = { bin: '/b/codex', projectDir: '/p', env: { A: '1' } };
  const listing = (stdout: string) => vi.fn<Run>().mockResolvedValue(stdout);

  it("runs `mcp list --json` in the project's folder and returns the names", async () => {
    const run = listing('[{"name":"trk","enabled":true}]');
    expect(await listCodexServers({ ...base, run })).toEqual(['trk']);
    expect(run).toHaveBeenCalledWith(['/b/codex', 'mcp', 'list', '--json'], { cwd: '/p', env: { A: '1' } });
  });

  it.each(['not json', '{}', '[{"enabled":true}]'])('throws for the output %s', async (out) => {
    await expect(listCodexServers({ ...base, run: listing(out) })).rejects.toThrow('Codex could not list its MCP servers: ');
  });

  it('throws when the run fails', async () => {
    await expect(listCodexServers({ ...base, run: vi.fn<Run>().mockRejectedValue(new Error('boom')) })).rejects.toThrow('Codex could not list its MCP servers: boom');
  });
});

describe('makeCodexSync', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const prepareOf = (sync: SyncAdapter, step: SyncStep, tools: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-sync-'));
    dirs.push(dir);
    return { dir, result: sync.prepare({ bin: '/b/codex', nodeBin: null, dir, projectDir: '/p', env: { A: '1' }, step, tools, setting: {} as AgentSetting }) };
  };

  it('prepares the run with the schema written next to it', async () => {
    const sync = makeCodexSync({ run: vi.fn<Run>().mockResolvedValue('[{"name":"trk"}]') });
    const { dir, result } = prepareOf(sync, { kind: 'discover' }, []);
    const schemaFile = join(dir, 'codex-sync-schema.json');
    expect(await result).toEqual({
      argv: codexSyncArgv({ bin: '/b/codex', projectDir: '/p', schemaFile, config: codexSyncConfig({ kind: 'discover' }, [], ['trk']) }),
      cwd: '/p',
      env: { A: '1' },
    });
    expect(readFileSync(schemaFile, 'utf8')).toBe(CODEX_SYNC_SCHEMA_JSON);
  });

  it("makes the folder first, which a new project's first sync lacks", async () => {
    const sync = makeCodexSync({ run: vi.fn<Run>().mockResolvedValue('[]') });
    const parent = mkdtempSync(join(tmpdir(), 'codex-sync-'));
    dirs.push(parent);
    const dir = join(parent, 'todo', 'new-project');
    await sync.prepare({ bin: '/b/codex', nodeBin: null, dir, projectDir: '/p', env: {}, step: { kind: 'discover' }, tools: [], setting: {} as AgentSetting });
    expect(readFileSync(join(dir, 'codex-sync-schema.json'), 'utf8')).toBe(CODEX_SYNC_SCHEMA_JSON);
  });

  it('says so when the schema cannot be written', async () => {
    const sync = makeCodexSync({ run: vi.fn<Run>().mockResolvedValue('[]') });
    const parent = mkdtempSync(join(tmpdir(), 'codex-sync-'));
    dirs.push(parent);
    writeFileSync(join(parent, 'file'), '');
    const dir = join(parent, 'file', 'sub');
    await expect(
      sync.prepare({ bin: '/b/codex', nodeBin: null, dir, projectDir: '/p', env: {}, step: { kind: 'discover' }, tools: [], setting: {} as AgentSetting }),
    ).rejects.toThrow("Could not write the sync's answer schema: ");
  });

  it('rejects when the listing fails', async () => {
    const sync = makeCodexSync({ run: vi.fn<Run>().mockRejectedValue(new Error('boom')) });
    await expect(prepareOf(sync, { kind: 'discover' }, []).result).rejects.toThrow('Codex could not list its MCP servers: boom');
  });

  it('words the sync for Codex', () => {
    const sync = makeCodexSync();
    expect(sync.words.noConnector).toBe("Mainframe looked in Codex's MCP servers: set your tracker up there (codex mcp add), then sync again.");
    expect(sync.words.toolNames).toBe('(as mcp__<server>__<tool>, such as mcp__tracker__get_card)');
    expect(sync.prompt({ kind: 'discover' })).toBe(syncPrompt({ kind: 'discover' }, sync.words));
    expect(sync.isToolName('mcp__trk__get_card')).toBe(true);
    expect(sync.isToolName('get_card')).toBe(false);
    expect(sync.models).toBeUndefined();
    expect(sync.afterRun({ bin: '', dir: '', env: {}, stdout: '' })).toBeUndefined();
  });
});
