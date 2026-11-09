import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  /** A folder the session may read without asking. `--add-dir` takes several values, so it goes before `--settings`, not before the prompt. */
  addDir?: string;
  prompt: string;
}): string[] {
  const addDir = o.addDir === undefined ? [] : ['--add-dir', o.addDir];
  return [o.claudeBin, '-w', o.slug, '-n', o.name, '--session-id', o.claudeSessionId, ...addDir, '--settings', o.settingsPath, o.prompt];
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

/** The file the SessionStart hook writes, in each task's folder and in the manager's. */
export const SESSION_START_FILE = 'session-start.json';

/**
 * Node's code for the SessionStart hook, run as `node -e <code> <file>` (the file is `process.argv[1]`): it saves stdin
 * to the file whole, through a temp file and a rename, so the reader never sees half of it.
 */
const SAVE_STDIN =
  "const fs=process.getBuiltinModule('node:fs'),t=process.argv[1],c=[];" +
  "process.stdin.on('data',(d)=>c.push(d)).on('end',()=>{fs.writeFileSync(t+'.tmp',Buffer.concat(c));fs.renameSync(t+'.tmp',t)})";

/**
 * The settings file of a session whose folder is `dir`: its SessionStart hook, and `allow` as permission rules. The hook
 * runs `nodeBin` with its arguments, no shell, so nothing is quoted and a path may hold any character.
 */
export function hookSettings(dir: string, nodeBin: string, allow: string[] = []): string {
  const hook = { type: 'command', command: nodeBin, args: ['-e', SAVE_STDIN, join(dir, SESSION_START_FILE)], timeout: 10 };
  return JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [hook] }],
    },
    ...(allow.length > 0 && { permissions: { allow } }),
  });
}

/** Writes `hookSettings` into the session's folder, making the folder if it has gone; returns the file's path. */
export function writeHookSettings(dir: string, nodeBin: string, allow: string[] = []): string {
  mkdirSync(dir, { recursive: true });
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, hookSettings(dir, nodeBin, allow));
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

/** What SessionStart last recorded in `dir`; null while it has never fired. */
export function readRecordedStart(dir: string): ReturnType<typeof readSessionStart> {
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
  return readRecordedStart(dir)?.id ?? null;
}
