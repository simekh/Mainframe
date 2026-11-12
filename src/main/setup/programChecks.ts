import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProgramCheck } from '../../shared/types';
import { findExecutable, type ExecutableFiles, type ExecutableLookup } from '../pty/findExecutable';

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

export function isAtLeast(version: string, min: string): boolean {
  const have = version.split('.').map(Number);
  const need = min.split('.').map(Number);
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const difference = (have[i] ?? 0) - (need[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export async function checkProgram(
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

export type FindOptions = { fromEnv?: string; saved?: string[]; lookup: ExecutableLookup; run: VersionRunner };

/**
 * `fromEnv` (the agent's MAINFRAME_*_BIN) is the only place looked at when set. Otherwise the saved paths in order,
 * then `places`, and the first that works wins; an old one on PATH doesn't hide a current one beside it. When none
 * works, the failure that helps most: too old, then broken, then missing.
 */
export async function findProgram(
  o: FindOptions,
  places: (lookup: ExecutableLookup) => string[],
  check: (path: string, run: VersionRunner, files: ExecutableFiles) => Promise<ProgramCheck>,
): Promise<ProgramCheck> {
  // An empty fromEnv counts as unset (config already throws on an empty one). Looked up as sessions look it up,
  // so the absolute path that is checked is the one they will run.
  if (o.fromEnv) return check(findExecutable(o.fromEnv, o.lookup) ?? o.fromEnv, o.run, o.lookup.files);
  const failures: ProgramCheck[] = [];
  for (const path of new Set([...(o.saved ?? []), ...places(o.lookup)])) {
    const result = await check(path, o.run, o.lookup.files);
    if (result.state === 'found') return result;
    failures.push(result);
  }
  return failures.find((f) => f.state === 'too-old') ?? failures.find((f) => f.state === 'broken') ?? { state: 'missing' };
}

export async function checkGit(lookup: ExecutableLookup, run: VersionRunner): Promise<ProgramCheck> {
  const path = findExecutable('git', lookup);
  if (path === null) return { state: 'missing' };
  const version = /git version (\S+)/.exec((await run(path, ['--version'])) ?? '')?.[1];
  return version === undefined ? { state: 'broken', path } : { state: 'found', path, version };
}
