import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncPrompt, type SyncStep } from '../todo/syncRun';
import { parseSyncAnswer, SYNC_ANSWER_JSON, type SyncAnswer } from '../todo/todoSchema';
import type { SyncAdapter, SyncWords } from './agent';
import { isMcpToolName } from './claudeSync';
import { CODEX_TIMEOUT_MS, runCodex, type Run } from './codexInstructions';
import { agentsMdInstructions } from './opencode';
import { jsonLines } from './opencodeSync';

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `--output-schema` takes only strict JSON Schema: every property required, no extra keys. An optional property
 * becomes one that may be null. Returns a copy.
 */
export function strictJsonSchema(schema: unknown): unknown {
  if (!isNode(schema)) return schema;
  const out: Node = { ...schema };
  if (isNode(schema.properties)) {
    const was = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, prop]) => {
        const strict = strictJsonSchema(prop);
        return [name, was.includes(name) ? strict : { anyOf: [strict, { type: 'null' }] }];
      }),
    );
    out.required = Object.keys(schema.properties);
    out.additionalProperties = false;
  }
  if (schema.items !== undefined) out.items = strictJsonSchema(schema.items);
  if (Array.isArray(schema.anyOf)) out.anyOf = schema.anyOf.map(strictJsonSchema);
  return out;
}

export const CODEX_SYNC_SCHEMA_JSON = JSON.stringify(strictJsonSchema(JSON.parse(SYNC_ANSWER_JSON)));

/** The name Codex gives an MCP server in a tool's name: anything but letters, digits and `_` becomes `_`. */
export const codexNamespace = (server: string): string => server.replace(/[^A-Za-z0-9_]/g, '_');

type Item = { type?: string; text?: string; server?: string; tool?: string; status?: string };
type Event = { type?: string; message?: string; error?: { message?: string }; item?: Item };

/**
 * The run's answer from `codex exec --json`: the text of its last agent message, checked against SYNC_ANSWER. A run
 * that failed, or that completed a tool outside `tools`, has no answer. Throws an Error whose message is for the panel.
 */
export function readCodexAnswer(stdout: string, tools: string[]): SyncAnswer {
  const all = jsonLines<Event>(stdout);
  // Codex prints an error for a dropped stream, then reconnects and may still complete the turn: an error counts
  // only when no turn completed.
  const completed = all.some((e) => e.type === 'turn.completed');
  const failed = all.find((e) => e.type === 'turn.failed' || (e.type === 'error' && !completed));
  if (failed) throw new Error(`The sync run failed: ${failed.error?.message ?? failed.message ?? 'unknown error'}`);
  // Codex shows a tool `get-card` as `get_card`, so the confirmed names are compared as it spells them; its event keeps `get-card`.
  const allowed = new Set(tools.map(codexNamespace));
  for (const { type, item } of all) {
    if (type !== 'item.completed' || item?.type !== 'mcp_tool_call' || item.status !== 'completed') continue;
    const prefix = `mcp__${codexNamespace(`${item.server}`)}__`;
    if (!allowed.has(prefix + codexNamespace(`${item.tool}`))) throw new Error(`The sync used a tool that wasn't allowed: ${prefix}${item.tool}`);
  }
  const text = all.findLast((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')?.item?.text;
  if (text === undefined) throw new Error('The sync run ended without an answer');
  let printed: unknown;
  try {
    printed = JSON.parse(text);
  } catch {
    throw new Error("The sync run's answer wasn't JSON");
  }
  // The strict schema makes the model print null for what it leaves out; SYNC_ANSWER wants those absent.
  if (isNode(printed)) printed = Object.fromEntries(Object.entries(printed).filter(([, v]) => v !== null));
  return parseSyncAnswer(printed);
}

/** Codex's `-c` takes TOML, and a dotted name can't be addressed by it: only these characters pass. */
const passable = (name: string): boolean => /^[A-Za-z0-9_-]+$/.test(name);

/** The servers' names from what `mcp list --json` printed; throws saying what was wrong with it. */
function serverNames(stdout: string): string[] {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    // Not JSON.parse's own message, which quotes the output.
    throw new Error('its answer was not JSON');
  }
  if (!Array.isArray(rows)) throw new Error('its answer held no list of servers');
  return rows.map((row) => {
    const name = isNode(row) ? row.name : undefined;
    if (typeof name !== 'string') throw new Error('a server in its answer had no name');
    return name;
  });
}

/** The names of the MCP servers Codex has for the project: `mcp list` reads the project's config from where it runs. */
export async function listCodexServers(o: { bin: string; projectDir: string; env: Record<string, string>; run?: Run }): Promise<string[]> {
  const { bin, projectDir, env, run = runCodex } = o;
  try {
    return serverNames(await run([bin, 'mcp', 'list', '--json'], { cwd: projectDir, env }));
  } catch (err) {
    // A run the timeout killed says only "Command failed".
    const why = (err as { killed?: boolean }).killed ? `it took longer than ${CODEX_TIMEOUT_MS / 1000} seconds` : (err as Error).message;
    throw new Error(`Codex could not list its MCP servers: ${why}`);
  }
}

/** A TOML basic string: JSON's escapes, plus DEL, which JSON leaves bare and TOML forbids. */
export const tomlString = (text: string): string => JSON.stringify(text).replace(/\x7f/g, '\\u007f');

const toml = (key: string, value: string | string[]): string =>
  `${key}=${typeof value === 'string' ? tomlString(value) : `[${value.map(tomlString).join(',')}]`}`;

/**
 * The run's `-c` values. Its own tools that act are switched off. Discover sees every server, but a call to any tool
 * needs an approval that a `codex exec` can't give. A read leaves only the confirmed tools callable and the other
 * servers off. Every listed server's name is checked, so a renamed one can't slip past. A confirmed `get_card` may be
 * the server's `get-card`, which Codex shows by the same name, so both spellings are allowed.
 */
export function codexSyncConfig(step: SyncStep, tools: string[], servers: string[]): string[] {
  for (const server of servers) {
    if (!passable(server)) throw new Error(`Codex's MCP server "${server}" has a name Mainframe can't pass to Codex`);
  }
  const allowedOf = new Map<string, string[]>();
  const prefixOf = (s: string) => `mcp__${codexNamespace(s)}__`;
  for (const name of step.kind === 'read' ? tools : []) {
    const owners = servers.filter((s) => name.startsWith(prefixOf(s)));
    if (owners.length !== 1) throw new Error(`Set up the sync again to find the tools: "${name}" doesn't match one of Codex's MCP servers`);
    const tool = name.slice(prefixOf(owners[0]).length);
    if (!passable(tool)) throw new Error(`Codex's MCP tool "${name}" has a name Mainframe can't pass to Codex`);
    const spellings = tool.includes('_') ? [tool, tool.replace(/_/g, '-')] : [tool];
    allowedOf.set(owners[0], [...(allowedOf.get(owners[0]) ?? []), ...spellings]);
  }
  const config = ['features.shell_tool=false', toml('web_search', 'disabled'), 'agents.enabled=false', 'features.apps=false', 'features.goals=false'];
  for (const server of servers) {
    const allowed = allowedOf.get(server);
    const prefix = `mcp_servers.${server}`;
    if (step.kind === 'read' && !allowed) {
      config.push(`${prefix}.enabled=false`);
      continue;
    }
    if (allowed) config.push(toml(`${prefix}.enabled_tools`, allowed));
    config.push(toml(`${prefix}.default_tools_approval_mode`, 'prompt'));
    for (const tool of allowed ?? []) config.push(toml(`${prefix}.tools.${tool}.approval_mode`, 'approve'));
  }
  return config;
}

/** Read-only, with nothing saved; the prompt comes on stdin (`-`). */
export const codexSyncArgv = (o: { bin: string; projectDir: string; schemaFile: string; config: string[] }): string[] => [
  o.bin, 'exec', '--json', '--ephemeral', '-s', 'read-only', '-C', o.projectDir, '--output-schema', o.schemaFile,
  ...o.config.flatMap((c) => ['-c', c]),
  '-',
];

/** Codex's sync. `run` lists the MCP servers; tests hand it a fake. */
export function makeCodexSync({ run }: { run?: Run } = {}): SyncAdapter {
  const words: SyncWords = {
    sessions: 'coding agent sessions',
    instructions: agentsMdInstructions,
    toolNames: '(as mcp__<server>__<tool>, such as mcp__tracker__get_card)',
    noConnector: "Mainframe looked in Codex's MCP servers: set your tracker up there (codex mcp add), then sync again.",
  };
  return {
    words,
    prepare: async ({ bin, dir, projectDir, env, step, tools }) => {
      const servers = await listCodexServers({ bin, projectDir, env, run });
      const config = codexSyncConfig(step, tools, servers);
      const schemaFile = join(dir, 'codex-sync-schema.json');
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(schemaFile, CODEX_SYNC_SCHEMA_JSON);
      } catch (err) {
        throw new Error(`Could not write the sync's answer schema: ${(err as Error).message}`);
      }
      return { argv: codexSyncArgv({ bin, projectDir, schemaFile, config }), cwd: projectDir, env };
    },
    prompt: (step) => syncPrompt(step, words),
    readAnswer: readCodexAnswer,
    isToolName: isMcpToolName,
    afterRun: () => {},
  };
}
