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

/** What a SessionStart payload says of its conversation: the id, and the source and transcript path where it gives them; null without an id. */
export function readSessionStart(text: string | null): { id: string; source?: string; transcriptPath?: string } | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const { session_id: id, source, transcript_path: transcriptPath } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || !isUuid(id)) return null;
  return {
    id,
    ...(typeof source === 'string' && { source }),
    ...(typeof transcriptPath === 'string' && { transcriptPath }),
  };
}

function readStart(dir: string): ReturnType<typeof readSessionStart> {
  try {
    return readSessionStart(readFileSync(join(dir, SESSION_START_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The conversation SessionStart last recorded in `dir`, which `/clear` and compaction change; null while
 * it has never fired.
 */
export function readRecordedSession(dir: string): string | null {
  return readStart(dir)?.id ?? null;
}

/**
 * The recorded conversation, when `claude --resume` can open it, for a session that may never have been
 * typed to: Claude Code writes a chat's transcript with its first message, and cannot resume one without.
 */
export function readResumableSession(dir: string): string | null {
  const start = readStart(dir);
  if (start === null) return null;
  // Only a chat that has just begun (startup) or been cleared (clear) can be unsaved. Any other source
  // (resume, compact, fork) continues one that has been, so it is resumed without a look at Claude Code's files.
  if (start.source !== 'startup' && start.source !== 'clear') return start.id;
  if (start.transcriptPath === undefined) return null;
  // Any project folder under Claude Code's projects folder may hold the chat, not only the one the payload
  // names: a chat resumed from the main checkout, as when a task's worktree branch is gone, names the main
  // checkout's folder while it stays in the worktree's. Ids are UUIDs, so a file of that name elsewhere is it.
  const projects = dirname(dirname(start.transcriptPath));
  try {
    return readdirSync(projects).some((folder) => existsSync(join(projects, folder, `${start.id}.jsonl`))) ? start.id : null;
  } catch {
    return null;
  }
}
