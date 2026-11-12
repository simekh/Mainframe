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

export async function checkGit(lookup: ExecutableLookup, run: VersionRunner): Promise<ProgramCheck> {
  const path = findExecutable('git', lookup);
  if (path === null) return { state: 'missing' };
  const version = /git version (\S+)/.exec((await run(path, ['--version'])) ?? '')?.[1];
  return version === undefined ? { state: 'broken', path } : { state: 'found', path, version };
}
