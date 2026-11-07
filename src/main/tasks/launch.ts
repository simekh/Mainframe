import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

export function startArgv(o: {
  claudeBin: string;
  slug: string;
  name: string;
  claudeSessionId: string;
  settingsPath: string;
  prompt: string;
}): string[] {
  return [o.claudeBin, '-w', o.slug, '-n', o.name, '--session-id', o.claudeSessionId, '--settings', o.settingsPath, o.prompt];
}

export function reopenArgv(o: {
  claudeBin: string;
  slug: string;
  claudeSessionId: string;
  settingsPath: string;
  branchExists: boolean;
  /** Sent to the resumed conversation as its next prompt: Claude starts no turn of its own after a resume. */
  prompt?: string;
}): string[] {
  if (!isUuid(o.claudeSessionId)) throw new Error(`not a session id: ${o.claudeSessionId}`);
  const worktree = o.branchExists ? ['--worktree', o.slug] : [];
  const prompt = o.prompt === undefined ? [] : [o.prompt];
  return [o.claudeBin, ...worktree, '--resume', o.claudeSessionId, '--settings', o.settingsPath, ...prompt];
}

/**
 * The manager's launch, in the main checkout. `--mcp-config` takes several values, so nothing positional
 * may follow it: the carry-on prompt comes last, after the role prompt.
 */
export function managerArgv(o: {
  claudeBin: string;
  name: string;
  claudeSessionId: string;
  /** Resumes the conversation `claudeSessionId` rather than beginning it. */
  resume: boolean;
  mcpConfigPath: string;
  settingsPath: string;
  rolePrompt: string;
  /** Sent to the resumed conversation as its next prompt: Claude starts no turn of its own after a resume. */
  prompt?: string;
}): string[] {
  if (o.resume && !isUuid(o.claudeSessionId)) throw new Error(`not a session id: ${o.claudeSessionId}`);
  const conversation = o.resume ? ['--resume', o.claudeSessionId] : ['-n', o.name, '--session-id', o.claudeSessionId];
  const prompt = o.prompt === undefined ? [] : [o.prompt];
  return [
    o.claudeBin, ...conversation, '--mcp-config', o.mcpConfigPath, '--settings', o.settingsPath,
    '--append-system-prompt', o.rolePrompt, ...prompt,
  ];
}

function shQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** The file the SessionStart hook writes, in each task's folder and in the manager's. */
export const SESSION_START_FILE = 'session-start.json';

/** The settings file of a session whose folder is `dir`: its SessionStart hook, and `allow` as permission rules. */
export function hookSettings(dir: string, allow: string[] = []): string {
  const target = shQuote(`${dir}/${SESSION_START_FILE}`);
  const tmp = shQuote(`${dir}/${SESSION_START_FILE}.tmp`);
  const command = `cat > ${tmp} && mv ${tmp} ${target}`;
  return JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command, timeout: 10 }] }],
    },
    ...(allow.length > 0 && { permissions: { allow } }),
  });
}

/** Writes `hookSettings` into the session's folder, making the folder if it has gone; returns the file's path. */
export function writeHookSettings(dir: string, allow: string[] = []): string {
  mkdirSync(dir, { recursive: true });
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, hookSettings(dir, allow));
  return settingsPath;
}

/** The conversation a SessionStart payload names, and the transcript path it gives; null when it gives either badly. */
export function readSessionStart(text: string | null): { id: string; transcriptPath: string } | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const { session_id: id, transcript_path: transcriptPath } = (parsed ?? {}) as { session_id?: unknown; transcript_path?: unknown };
  return typeof id === 'string' && isUuid(id) && typeof transcriptPath === 'string' ? { id, transcriptPath } : null;
}

/**
 * The conversation SessionStart last recorded in `dir`, which `/clear` and compaction change, provided Claude
 * Code saved it: it writes a transcript only once the chat has a message, and cannot resume one without. Null
 * while SessionStart has never fired, and while nothing has been said in the conversation it recorded.
 */
export function readRecordedSession(dir: string): string | null {
  try {
    const start = readSessionStart(readFileSync(join(dir, SESSION_START_FILE), 'utf8'));
    if (start === null) return null;
    // Any project folder under Claude Code's projects folder may hold the chat, not only the one the payload
    // names: a task resumed from the main checkout, its worktree branch gone, names the main checkout's folder,
    // while the chat stays in the worktree's. Ids are UUIDs, so a file of that name elsewhere is the same chat.
    const projects = dirname(dirname(start.transcriptPath));
    return readdirSync(projects).some((folder) => existsSync(join(projects, folder, `${start.id}.jsonl`))) ? start.id : null;
  } catch {
    return null;
  }
}
