import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { MIN_CLAUDE_VERSION, type ProgramCheck } from '../../shared/types';
import { findExecutable, searchDirs, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';
import { checkProgram, findProgram, type FindOptions, type VersionRunner } from '../setup/programChecks';
import { SYNC_TIMEOUT_MS, syncPrompt } from '../todo/syncRun';
import type { AgentAdapter, Instructions, LaunchArgs, ManagerLaunch, SyncWords } from './agent';
import { readResumableSession } from './claudeChat';
import { isMcpToolName, prepareClaudeSync, readSyncAnswer } from './claudeSync';

// Only claude's own line counts, so a wrong file picked by hand that prints some other version isn't taken for claude.
export function parseClaudeVersion(stdout: string): string | null {
  return /^(\d+\.\d+\.\d+) \(Claude Code\)$/.exec(stdout.trim())?.[1] ?? null;
}

/**
 * Where claude may be, after a saved path: PATH, the native installer's file, and on Windows npm's
 * real executable (npm's `claude.cmd` is a launcher script Mainframe never runs). That executable
 * is in the package beside `claude.cmd`, in the global folder of whichever npm prefix is on PATH
 * (a version manager's, say), or else of the default one in %APPDATA%. On macOS and Linux npm's
 * `claude` sits beside `node`, which is on PATH, so PATH covers it.
 */
export function claudePlaces(lookup: ExecutableLookup): string[] {
  const { env } = lookup;
  const places = [findExecutable('claude', lookup)];
  if (lookup.platform === 'win32') {
    if (env.USERPROFILE) places.push(win32.join(env.USERPROFILE, '.local', 'bin', 'claude.exe'));
    // On Windows a file is executable when it is there, so this asks whether claude.cmd is.
    const npmFolders = searchDirs(lookup).filter((dir) => lookup.files.isExecutableFile(win32.join(dir, 'claude.cmd')));
    if (env.APPDATA) npmFolders.push(win32.join(env.APPDATA, 'npm'));
    for (const dir of npmFolders) places.push(win32.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  } else if (env.HOME) {
    places.push(posix.join(env.HOME, '.local', 'bin', 'claude'));
  }
  return [...new Set(places.filter((place) => place !== null))];
}

export const checkClaude = (path: string, run: VersionRunner, files: ExecutableFiles) =>
  checkProgram(path, parseClaudeVersion, MIN_CLAUDE_VERSION, run, files);

export const findClaude = (o: FindOptions): Promise<ProgramCheck> => findProgram(o, claudePlaces, checkClaude);

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

/** Why a Claude Code launch can't go on without node: the hooks Mainframe writes for it run node, with no shell. */
export const NODE_NEEDED =
  'Mainframe needs Node.js, and found no node on PATH. Install the current Node.js LTS, then run npm start again from a new terminal.';

/** The node a Claude Code launch's hooks run; throws NODE_NEEDED when none was found. */
function needNode(nodeBin: string | null): string {
  if (nodeBin === null) throw new Error(NODE_NEEDED);
  return nodeBin;
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

/** How long `claude` waits on one of Mainframe's MCP tools, in ms: a minute past the sync run's time limit, which `sync_todo` waits out. */
const TOOL_TIMEOUT_MS = SYNC_TIMEOUT_MS + 60_000;

/** The `--mcp-config` entry that has `claude` call Mainframe's MCP server, as `mainframe`. */
export const mcpConfigJson = (url: string, token: string): string =>
  JSON.stringify({ mcpServers: { mainframe: { type: 'http', url, headers: { Authorization: `Bearer ${token}` }, timeout: TOOL_TIMEOUT_MS } } });

/**
 * What the manager may call without asking, as an allow rule names a tool: the read of the sessions, and a sync, whose
 * background run may use only the tools the owner confirmed. Starting a task goes through the owner's permission mode,
 * so the role prompt is not all that stands between the manager and a session.
 */
const MANAGER_ALLOWED_TOOLS = ['mcp__mainframe__list_sessions', 'mcp__mainframe__sync_todo'];

/** Writes the manager's settings.json and mcp.json into its folder, on every launch: the port and the token change with each run of the app. */
async function claudeManagerLaunch(o: ManagerLaunch): Promise<LaunchArgs> {
  const settingsPath = writeHookSettings(o.dir, needNode(o.nodeBin), MANAGER_ALLOWED_TOOLS);
  const mcpConfigPath = join(o.dir, 'mcp.json');
  // Made anew, as the mode is only for a file that is made here; one that was there would keep its own.
  rmSync(mcpConfigPath, { force: true });
  writeFileSync(mcpConfigPath, mcpConfigJson(o.mcp.url, o.mcp.token), { mode: 0o600 });
  return {
    argv: managerArgv({
      claudeBin: o.bin,
      name: o.name,
      claudeSessionId: o.chat,
      resume: o.resume,
      mcpConfigPath,
      settingsPath,
      rolePrompt: o.rolePrompt,
      prompt: o.prompt,
    }),
  };
}

const instructions: Instructions = {
  first: "this repo's CLAUDE.md",
  again: "this repo's CLAUDE.md",
  requires: "this repo's CLAUDE.md requires",
  integrates: 'this CLAUDE.md integrates',
};

const syncWords: SyncWords = { sessions: 'Claude Code sessions', instructions, toolNames: '(mcp__…)', noConnector: '' };

export const claudeAgent: AgentAdapter = {
  name: 'claude',
  envVar: 'MAINFRAME_CLAUDE_BIN',
  find: findClaude,
  check: checkClaude,
  // Keys that describe the Claude Code session the app was started from: a session that inherits them
  // behaves as a nested Claude Code session. Other CLAUDE_CODE_* keys are the owner's own settings and pass through.
  droppedEnv: [
    'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID',
  ],
  instructions,
  worktreeNote: ({ branch }) =>
    `Mainframe started you in this task's own worktree, on branch ${branch}, so don't call EnterWorktree. ` +
    'From inside a worktree, Claude Code refuses git commands aimed at the main checkout: when you need the main ' +
    'checkout, for example to merge, call ExitWorktree with action "keep" first.',
  // `claude -w` makes the task's worktree as it starts.
  mainframeAddsWorktree: false,
  // Where `claude -w` puts them.
  worktreesDir: '.claude/worktrees',
  needsNode: true,
  newSessionId: (uuid) => uuid(),
  taskStart: (o) => ({
    argv: startArgv({
      claudeBin: o.bin,
      slug: o.slug,
      name: o.name,
      claudeSessionId: o.sessionId,
      settingsPath: writeHookSettings(o.taskDir, needNode(o.nodeBin)),
      ...(o.addDir && { addDir: o.addDir }),
      prompt: o.prompt,
    }),
  }),
  taskReopen: (o) => ({
    argv: reopenArgv({
      claudeBin: o.bin,
      slug: o.slug,
      claudeSessionId: o.sessionId,
      settingsPath: writeHookSettings(o.taskDir, needNode(o.nodeBin)),
      branchExists: o.branchExists,
      prompt: o.prompt,
    }),
  }),
  recordedSession: readRecordedSession,
  // Claude Code's own record says which chat it was in; manager.json's saved id is not needed.
  managerChat: readResumableSession,
  managerLaunch: claudeManagerLaunch,
  sync: {
    words: syncWords,
    prepare: (o) => prepareClaudeSync({ ...o, nodeBin: needNode(o.nodeBin) }),
    prompt: (step) => syncPrompt(step, syncWords),
    readAnswer: readSyncAnswer,
    isToolName: isMcpToolName,
    afterRun: () => {},
  },
};
