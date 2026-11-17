import { posix, win32 } from 'node:path';
import { MIN_CODEX_VERSION, type ProgramCheck } from '../../shared/types';
import { findExecutable, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';
import { checkProgram, findProgram, type FindOptions, type VersionRunner } from '../setup/programChecks';
import type { AgentAdapter, SyncAdapter } from './agent';
import { agentsMdInstructions, mainframeWorktreeNote } from './opencode';

/** Keys Codex sets in the shells it runs. CODEX_HOME is the user's own setting, so it stays. */
export const CODEX_DROPPED_ENV: readonly string[] = [
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_SESSION_ID',
  'CODEX_THREAD_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
  'CODEX_VERSION',
  'CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS',
  'CODEX_MANAGED_BY_NPM',
  'CODEX_MANAGED_PACKAGE_ROOT',
];

/** No Codex setting is passed: the task runs in its worktree on the user's own config. */
export function codexStartArgv(o: { codexBin: string; prompt: string }): string[] {
  return [o.codexBin, o.prompt];
}

/** The worktree's latest Codex session, as Codex picks it from the folder it runs in. */
export function codexReopenArgv(o: { codexBin: string; prompt?: string }): string[] {
  return [o.codexBin, 'resume', '--last', ...(o.prompt ? [o.prompt] : [])];
}

// Only codex's own line counts, for the same reason as claude's; colour codes are stripped as for opencode.
export function parseCodexVersion(stdout: string): string | null {
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  return /^codex-cli (\d+\.\d+\.\d+)$/.exec(plain.trim())?.[1] ?? null;
}

const checkCodex = (path: string, run: VersionRunner, files: ExecutableFiles) =>
  checkProgram(path, parseCodexVersion, MIN_CODEX_VERSION, run, files);

/** Where codex may be: PATH, then its installer's folder, which the installer may not have put on PATH. */
export function codexPlaces(lookup: ExecutableLookup): string[] {
  const { env } = lookup;
  const places = [findExecutable('codex', lookup)];
  if (lookup.platform === 'win32') {
    if (env.LOCALAPPDATA) places.push(win32.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  } else if (env.HOME) {
    places.push(posix.join(env.HOME, '.local', 'bin', 'codex'));
  }
  return [...new Set(places.filter((place) => place !== null))];
}

export const findCodex = (o: FindOptions): Promise<ProgramCheck> => findProgram(o, codexPlaces, checkCodex);

const NO_SYNC = "The Todo sync doesn't run on Codex yet.";

const codexSync: SyncAdapter = {
  words: {
    sessions: 'coding agent sessions',
    instructions: agentsMdInstructions,
    toolNames: '(as your tool list names them)',
    noConnector: '',
  },
  prepare: () => {
    throw new Error(NO_SYNC);
  },
  prompt: () => '',
  readAnswer: () => {
    throw new Error(NO_SYNC);
  },
  isToolName: () => false,
  afterRun: () => {},
};

export const codexAgent: AgentAdapter = {
  name: 'codex',
  envVar: 'MAINFRAME_CODEX_BIN',
  find: findCodex,
  check: checkCodex,
  droppedEnv: CODEX_DROPPED_ENV,
  instructions: agentsMdInstructions,
  worktreeNote: mainframeWorktreeNote,
  mainframeAddsWorktree: true,
  worktreesDir: '.mainframe/worktrees',
  tracksBegan: true,
  needsNode: false,
  // Mainframe's own key for the task, never sent to Codex: a reopen resumes the worktree's latest session.
  newSessionId: (uuid) => uuid(),
  taskStart: (o) => ({ argv: codexStartArgv({ codexBin: o.bin, prompt: o.prompt }) }),
  taskReopen: (o) => ({ argv: codexReopenArgv({ codexBin: o.bin, prompt: o.prompt }) }),
  // Mainframe never reads Codex's own session store: the task's `began` says whether Codex took the brief.
  recordedSession: () => null,
  chatKept: () => true,
  began: (_taskDir, task) => task.began === true,
  forgetChat: () => {},
  managerChat: () => null,
  managerLaunch: () => Promise.reject(new Error("The manager doesn't run on Codex yet.")),
  sync: codexSync,
};
