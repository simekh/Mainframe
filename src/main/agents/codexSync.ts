import { parseSyncAnswer, SYNC_ANSWER_JSON, type SyncAnswer } from '../todo/todoSchema';
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
  const failed = all.find((e) => e.type === 'turn.failed' || e.type === 'error');
  if (failed) throw new Error(`The sync run failed: ${failed.error?.message ?? failed.message ?? 'unknown error'}`);
  for (const { type, item } of all) {
    if (type !== 'item.completed' || item?.type !== 'mcp_tool_call' || item.status !== 'completed') continue;
    const name = `mcp__${codexNamespace(String(item.server))}__${String(item.tool)}`;
    if (!tools.includes(name)) throw new Error(`The sync used a tool that wasn't allowed: ${name}`);
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
