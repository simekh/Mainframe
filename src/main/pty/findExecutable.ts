import { posix, win32 } from 'node:path';
import { pathKey } from './spawnEnv';

/** What the lookup asks of the file system. */
export interface ExecutableFiles {
  isExecutableFile(path: string): boolean;
}

export interface ExecutableLookup {
  env: Record<string, string>;
  /** Relative paths, and on POSIX an empty PATH entry, are taken from here. */
  cwd: string;
  platform: NodeJS.Platform;
  files: ExecutableFiles;
}

// What execvp searches when PATH is unset (macOS's _PATH_DEFPATH).
const DEFAULT_PATH = '/usr/bin:/bin';

const isPathName = (name: string, platform: NodeJS.Platform) =>
  name.includes('/') || (platform === 'win32' && (name.includes('\\') || win32.isAbsolute(name)));

// Windows runs a .exe or .com directly; any other extension (.cmd, .bat) needs a shell, which Mainframe never uses.
function executableNames(name: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [name];
  const extension = win32.extname(name).toLowerCase();
  if (extension === '.exe' || extension === '.com') return [name];
  return extension === '' ? [`${name}.exe`, `${name}.com`] : [];
}

function pathValue({ env, platform }: ExecutableLookup): string {
  const key = pathKey(env, platform);
  if (key !== undefined) return env[key];
  return platform === 'win32' ? '' : DEFAULT_PATH;
}

function searchDirs(o: ExecutableLookup): string[] {
  const dirs = pathValue(o).split(o.platform === 'win32' ? win32.delimiter : posix.delimiter);
  if (o.platform !== 'win32') return dirs.map((dir) => dir || '.');
  // An empty entry is skipped, so that a claude.exe planted in a repo is not run; entries may be quoted.
  return dirs.map((dir) => dir.replaceAll('"', '')).filter((dir) => dir !== '');
}

/**
 * Where `name` would be run from, as an absolute path in the platform's own form, or null. A name
 * with a separator is a path; any other is searched in the PATH value. Symlinks are not resolved:
 * `~/.local/bin/claude` stays that path, so `claude update` keeps working.
 */
export function findExecutable(name: string, o: ExecutableLookup): string | null {
  const path = o.platform === 'win32' ? win32 : posix;
  const names = executableNames(name, o.platform);
  const candidates = isPathName(name, o.platform)
    ? names.map((file) => path.resolve(o.cwd, file))
    : searchDirs(o).flatMap((dir) => names.map((file) => path.resolve(o.cwd, dir, file)));
  return candidates.find((candidate) => o.files.isExecutableFile(candidate)) ?? null;
}

/** node-pty's helper ends without a word when it can't run the binary, so say which one is wrong. */
export function resolveExecutable(name: string, o: ExecutableLookup): string {
  const found = findExecutable(name, o);
  if (found !== null) return found;
  throw new Error(
    isPathName(name, o.platform)
      ? `${name} was not found, or is not an executable file`
      : `${name} was not found on PATH (${pathValue(o)})`,
  );
}
