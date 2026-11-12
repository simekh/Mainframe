import { randomBytes } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { MIN_OPENCODE_VERSION, type ProgramCheck } from '../../shared/types';
import { findExecutable, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';
import { checkProgram, type VersionRunner } from '../setup/programChecks';
import type { AgentAdapter } from './agent';

/** OpenCode's own tabs would sit inside Mainframe's terminal: switched off for the session. */
export const OPENCODE_ENV: Record<string, string> = { OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"}}' };

const SESSION_ID = /^ses_[0-9a-f]{28}$/;

export function newOpencodeSessionId(): string {
  return `ses_${randomBytes(14).toString('hex')}`;
}

export function isOpencodeSessionId(s: string): boolean {
  return SESSION_ID.test(s);
}

export function opencodeStartArgv(o: { opencodeBin: string; sessionId: string; prompt: string }): string[] {
  return [o.opencodeBin, '--standalone', '-s', o.sessionId, '--prompt', o.prompt];
}

export function opencodeReopenArgv(o: { opencodeBin: string; sessionId: string; prompt?: string }): string[] {
  if (!isOpencodeSessionId(o.sessionId)) throw new Error(`not a session id: ${o.sessionId}`);
  return [o.opencodeBin, '--standalone', '-s', o.sessionId, ...(o.prompt === undefined ? [] : ['--prompt', o.prompt])];
}

// Only opencode's own line counts, for the same reason as claude's. It colours that line when FORCE_COLOR is set.
export function parseOpencodeVersion(stdout: string): string | null {
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  return /^opencode v(\d+\.\d+\.\d+)$/.exec(plain.trim())?.[1] ?? null;
}

const checkOpencode = (path: string, run: VersionRunner, files: ExecutableFiles) =>
  checkProgram(path, parseOpencodeVersion, MIN_OPENCODE_VERSION, run, files);

/** Where opencode may be: PATH, then its installer's folder (`~/.opencode/bin`, which the installer may not have put on PATH). */
export function opencodePlaces(lookup: ExecutableLookup): string[] {
  const { env } = lookup;
  const places = [findExecutable('opencode', lookup)];
  if (lookup.platform === 'win32') {
    if (env.USERPROFILE) places.push(win32.join(env.USERPROFILE, '.opencode', 'bin', 'opencode.exe'));
  } else if (env.HOME) {
    places.push(posix.join(env.HOME, '.opencode', 'bin', 'opencode'));
  }
  return [...new Set(places.filter((place) => place !== null))];
}

/** Like `findClaude`, with no saved paths: `fromEnv` (MAINFRAME_OPENCODE_BIN) alone when set, else `opencodePlaces`. */
export async function findOpencode(o: { fromEnv?: string; lookup: ExecutableLookup; run: VersionRunner }): Promise<ProgramCheck> {
  if (o.fromEnv) return checkOpencode(findExecutable(o.fromEnv, o.lookup) ?? o.fromEnv, o.run, o.lookup.files);
  const failures: ProgramCheck[] = [];
  for (const path of opencodePlaces(o.lookup)) {
    const check = await checkOpencode(path, o.run, o.lookup.files);
    if (check.state === 'found') return check;
    failures.push(check);
  }
  return failures.find((check) => check.state === 'too-old') ?? failures.find((check) => check.state === 'broken') ?? { state: 'missing' };
}

export const opencodeAgent: AgentAdapter = {
  name: 'opencode',
  envVar: 'MAINFRAME_OPENCODE_BIN',
  find: findOpencode,
  check: checkOpencode,
  // OpenCode sets these in the shells it runs.
  droppedEnv: ['OPENCODE_TERMINAL', 'OPENCODE_PTY_HANDOFF'],
  instructions: {
    first: "this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)",
    again: 'those instructions',
    requires: 'those instructions require',
    integrates: 'those instructions integrate',
  },
  worktreeNote: ({ branch, worktreePath, projectDir }) =>
    `Mainframe started you in this task's own worktree, ${worktreePath}, on branch ${branch}. The main checkout is ${projectDir}: when you need it, for example to merge, run git there with git -C ${projectDir}.`,
  makesWorktree: true,
  newSessionId: () => newOpencodeSessionId(),
  // No `addDir`: OpenCode reads outside the project by default.
  taskStart: (o) => ({ argv: opencodeStartArgv({ opencodeBin: o.bin, sessionId: o.sessionId, prompt: o.prompt }), env: OPENCODE_ENV }),
  taskReopen: (o) => ({ argv: opencodeReopenArgv({ opencodeBin: o.bin, sessionId: o.sessionId, prompt: o.prompt }), env: OPENCODE_ENV }),
  // OpenCode has no SessionStart hook: its task keeps the session Mainframe started.
  recordedSession: () => null,
  managerChat: () => {
    throw new Error('The manager does not run on OpenCode yet');
  },
  managerLaunch: () => Promise.reject(new Error('The manager does not run on OpenCode yet')),
};
