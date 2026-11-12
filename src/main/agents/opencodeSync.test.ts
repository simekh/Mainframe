import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncPrompt, type SyncStep } from '../todo/syncRun';
import { SYNC_ANSWER_JSON } from '../todo/todoSchema';
import { makeOpencodeAgent, opencodeAgent } from './opencode';
import { isOpencodeToolName, readOpencodeAnswer, syncConfig } from './opencodeSync';

const SES = 'ses_' + 'b'.repeat(28);
const TOOLS = ['tracker_get_list', 'tracker_get_card'];
const ANSWER = { kind: 'tools', connector: 'Tracker', readTools: TOOLS };

// Events as `opencode run --format json` prints them (cli/src/run/noninteractive.ts).
const ev = (type: string, data: object) => JSON.stringify({ type, timestamp: 1, sessionID: SES, ...data });
const text = (messageID: string, t: string) => ev('text', { part: { id: 'p', sessionID: SES, messageID, type: 'text', text: t } });
const stepFinish = (messageID: string, reason: string) =>
  ev('step_finish', { part: { id: 'p', sessionID: SES, messageID, type: 'step-finish', reason, cost: 0, tokens: {} } });
const toolUse = (tool: string, status: 'completed' | 'error') =>
  ev('tool_use', { part: { partID: 'p', sessionID: SES, messageID: 'm1', type: 'tool', id: 't', tool, state: { status } } });
const lines = (...l: string[]) => l.join('\n') + '\n';

describe('readOpencodeAnswer', () => {
  it('a good answer split over two text events', () => {
    const json = JSON.stringify(ANSWER);
    const out = lines(text('m2', json.slice(0, 10)), text('m2', json.slice(10)), stepFinish('m2', 'stop'));
    expect(readOpencodeAnswer(out, [])).toEqual(ANSWER);
  });

  it('a fenced answer', () => {
    const out = lines(text('m2', '```json\n' + JSON.stringify(ANSWER) + '\n```'), stepFinish('m2', 'stop'));
    expect(readOpencodeAnswer(out, [])).toEqual(ANSWER);
  });

  it('only the message that stopped counts', () => {
    const out = lines(
      'not an event',
      text('m1', 'Let me look at the tools.'),
      toolUse('tracker_get_list', 'completed'),
      stepFinish('m1', 'tool-calls'),
      text('m2', JSON.stringify({ ...ANSWER, extra: 'dropped' })),
      stepFinish('m2', 'stop'),
    );
    expect(readOpencodeAnswer(out, ['tracker_get_list'])).toEqual(ANSWER);
  });

  it('an answer without kind', () => {
    const out = lines(text('m2', JSON.stringify({ connector: 'Tracker' })), stepFinish('m2', 'stop'));
    expect(() => readOpencodeAnswer(out, [])).toThrow("The sync run's answer didn't have the shape Mainframe asked for");
  });

  it("an answer that isn't JSON", () => {
    const out = lines(text('m2', 'Here are the tools.'), stepFinish('m2', 'stop'));
    expect(() => readOpencodeAnswer(out, [])).toThrow("The sync run's answer wasn't JSON");
  });

  it('an error event', () => {
    const out = lines(ev('error', { error: { type: 'provider.auth', message: 'Invalid API key' } }));
    expect(() => readOpencodeAnswer(out, [])).toThrow('The sync run failed: Invalid API key');
  });

  it('a completed tool outside the confirmed ones fails the sync', () => {
    const answered = [text('m2', JSON.stringify(ANSWER)), stepFinish('m2', 'stop')];
    expect(() => readOpencodeAnswer(lines(toolUse('tracker_move_card', 'completed'), ...answered), TOOLS)).toThrow(
      "The sync used a tool that wasn't allowed: tracker_move_card",
    );
    expect(readOpencodeAnswer(lines(toolUse('tracker_move_card', 'error'), ...answered), TOOLS)).toEqual(ANSWER);
  });

  it('no stop message', () => {
    const out = lines(text('m1', JSON.stringify(ANSWER)), stepFinish('m1', 'length'));
    expect(() => readOpencodeAnswer(out, [])).toThrow('The sync run ended without an answer');
    expect(() => readOpencodeAnswer('', [])).toThrow('The sync run ended without an answer');
  });
});

describe('syncConfig', () => {
  it('discover may see but not call any tool, in both places, with no title run and 12 steps', () => {
    const rules = [
      { action: '*', resource: '*', effect: 'ask' },
      { action: 'execute', resource: '*', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'write', resource: '*', effect: 'deny' },
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'subagent', resource: '*', effect: 'deny' },
      { action: 'webfetch', resource: '*', effect: 'deny' },
      { action: 'opencode_*', resource: '*', effect: 'deny' },
    ];
    expect(JSON.parse(syncConfig({ kind: 'discover' }, [], '/p/AGENTS.md'))).toEqual({
      permissions: rules,
      agents: { 'mainframe-sync': { mode: 'primary', steps: 12, permissions: rules }, title: { disabled: true } },
      instructions: ['/p/AGENTS.md'],
    });
  });

  it('read may use only the confirmed tools', () => {
    const rules = [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'tracker_get_list', resource: '*', effect: 'allow' },
      { action: 'tracker_get_card', resource: '*', effect: 'allow' },
    ];
    expect(JSON.parse(syncConfig({ kind: 'read', list: null }, TOOLS, null))).toEqual({
      permissions: rules,
      agents: { 'mainframe-sync': { mode: 'primary', steps: 12, permissions: rules }, title: { disabled: true } },
    });
  });
});

describe('prepare', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const prepare = (files: string[], setting: { syncModel?: string } = { syncModel: 'p/m' }) => {
    const dir = mkdtempSync(join(tmpdir(), 'mainframe-oc-sync-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'mainframe-oc-project-'));
    dirs.push(dir, projectDir);
    for (const f of files) writeFileSync(join(projectDir, f), '');
    const spec = opencodeAgent.sync.prepare({
      bin: 'oc',
      nodeBin: null,
      dir,
      projectDir,
      env: { HOME: '/h' },
      step: { kind: 'read', list: null },
      tools: TOOLS,
      setting,
    });
    return { spec, dir, projectDir, config: JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT) };
  };

  it('runs opencode standalone in an empty folder with the project config off', () => {
    const { spec, dir } = prepare([]);
    const runDir = join(dir, 'opencode-run');
    expect(spec.argv).toEqual([
      'oc', 'run', '--standalone', '--format', 'json', '--agent', 'mainframe-sync', '--title', 'sync', '--archived', '-m', 'p/m',
    ]);
    expect(spec.argv).not.toContain('--auto');
    expect(spec.cwd).toBe(runDir);
    expect(existsSync(runDir)).toBe(true);
    expect(readdirSync(runDir)).toEqual([]);
    expect(spec.env).toMatchObject({
      HOME: '/h',
      PWD: runDir,
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
    });
  });

  it("hands the project's instructions file by path: AGENTS.md first, then CLAUDE.md, else none", () => {
    const both = prepare(['AGENTS.md', 'CLAUDE.md']);
    expect(both.config.instructions).toEqual([join(both.projectDir, 'AGENTS.md')]);
    const claude = prepare(['CLAUDE.md']);
    expect(claude.config.instructions).toEqual([join(claude.projectDir, 'CLAUDE.md')]);
    expect(prepare([]).config).not.toHaveProperty('instructions');
  });

  it('prepare without a model', () => {
    expect(() => prepare([], {})).toThrow('Pick a model for the sync first');
  });
});

describe("OpenCode's sync", () => {
  it('asks for JSON matching the schema after the shared prompt', () => {
    const step: SyncStep = { kind: 'discover' };
    const words = opencodeAgent.sync.words;
    expect(opencodeAgent.sync.prompt(step)).toBe(
      `${syncPrompt(step, words)}\n\nAnswer with one JSON object and nothing else, with no code fence. It must match this JSON Schema: ${SYNC_ANSWER_JSON}`,
    );
    expect(opencodeAgent.sync.prompt(step)).toContain(
      'the full names (as your tool list names them, such as tracker_get_card) of the tools',
    );
  });

  it('isOpencodeToolName', () => {
    expect(isOpencodeToolName('trello_trelloReadCard')).toBe(true);
    expect(isOpencodeToolName('read')).toBe(false);
    expect(isOpencodeToolName('opencode_shell')).toBe(false);
    expect(opencodeAgent.sync.isToolName).toBe(isOpencodeToolName);
  });

  it('afterRun deletes the run\'s session, standalone, and ignores a failure', () => {
    const run = vi.fn(async () => {
      throw new Error('gone');
    });
    const dir = '/data/todo/acme';
    makeOpencodeAgent({ run }).sync.afterRun({
      bin: 'oc',
      dir,
      env: { HOME: '/h' },
      stdout: lines('not an event', text('m1', 'x'), stepFinish('m1', 'stop')),
    });
    expect(run).toHaveBeenCalledWith(['oc', '--standalone', 'session', 'delete', SES], {
      cwd: join(dir, 'opencode-run'),
      env: { HOME: '/h' },
    });
  });

  it('afterRun runs nothing when no event names a session', () => {
    const run = vi.fn(async () => '');
    makeOpencodeAgent({ run }).sync.afterRun({ bin: 'oc', dir: '/d', env: {}, stdout: 'Error: no such model\n' });
    expect(run).not.toHaveBeenCalled();
  });
});
