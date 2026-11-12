import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { MIN_CLAUDE_VERSION, MIN_OPENCODE_VERSION, type ProgramCheck } from '../../shared/types';
import { findExecutable, searchDirs, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';

const execFileAsync = promisify(execFile);

/** What a program prints for `--version`, or null when it can't run, times out or fails. */
export type VersionRunner = (file: string, args: string[]) => Promise<string | null>;

/** Runs the file itself, never through a shell, so a `.cmd` launcher can't be run by mistake. */
export function runVersion(env: Record<string, string>): VersionRunner {
  return async (file, args) => {
    try {
      const { stdout } = await execFileAsync(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      return stdout;
    } catch {
      return null;
    }
  };
}

// Only claude's own line counts, so a wrong file picked by hand that prints some other version isn't taken for claude.
export function parseClaudeVersion(stdout: string): string | null {
  return /^(\d+\.\d+\.\d+) \(Claude Code\)$/.exec(stdout.trim())?.[1] ?? null;
}

// Only opencode's own line counts, for the same reason as claude's.
export function parseOpencodeVersion(stdout: string): string | null {
  return /^opencode v(\d+\.\d+\.\d+)$/.exec(stdout.trim())?.[1] ?? null;
}

export function isAtLeast(version: string, min: string): boolean {
  const have = version.split('.').map(Number);
  const need = min.split('.').map(Number);
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const difference = (have[i] ?? 0) - (need[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
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

async function checkProgram(
  path: string,
  parse: (stdout: string) => string | null,
  min: string,
  run: VersionRunner,
  files: ExecutableFiles,
): Promise<ProgramCheck> {
  if (!files.isExecutableFile(path)) return { state: 'missing', path };
  const stdout = await run(path, ['--version']);
  const version = stdout === null ? null : parse(stdout);
  if (version === null) return { state: 'broken', path };
  return { state: isAtLeast(version, min) ? 'found' : 'too-old', path, version };
}

export const checkClaude = (path: string, run: VersionRunner, files: ExecutableFiles) =>
  checkProgram(path, parseClaudeVersion, MIN_CLAUDE_VERSION, run, files);

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

/**
 * `fromEnv` (MAINFRAME_CLAUDE_BIN) is the only place looked at when set. Otherwise the saved paths in
 * order, then `claudePlaces`, and the first that works wins; an old claude on PATH doesn't hide a
 * current one beside it. When none works, the failure that helps most: too old, then broken, then missing.
 */
export async function findClaude(o: { fromEnv?: string; saved?: string[]; lookup: ExecutableLookup; run: VersionRunner }): Promise<ProgramCheck> {
  // An empty fromEnv counts as unset (config already throws on an empty MAINFRAME_CLAUDE_BIN). Looked
  // up as sessions look it up, so the absolute path that is checked is the one they will run.
  if (o.fromEnv) return checkClaude(findExecutable(o.fromEnv, o.lookup) ?? o.fromEnv, o.run, o.lookup.files);
  const failures: ProgramCheck[] = [];
  for (const path of new Set([...(o.saved ?? []), ...claudePlaces(o.lookup)])) {
    const check = await checkClaude(path, o.run, o.lookup.files);
    if (check.state === 'found') return check;
    failures.push(check);
  }
  return failures.find((check) => check.state === 'too-old') ?? failures.find((check) => check.state === 'broken') ?? { state: 'missing' };
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

export async function checkGit(lookup: ExecutableLookup, run: VersionRunner): Promise<ProgramCheck> {
  const path = findExecutable('git', lookup);
  if (path === null) return { state: 'missing' };
  const version = /git version (\S+)/.exec((await run(path, ['--version'])) ?? '')?.[1];
  return version === undefined ? { state: 'broken', path } : { state: 'found', path, version };
}
