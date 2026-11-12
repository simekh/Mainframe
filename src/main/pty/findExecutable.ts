import { posix, win32 } from 'node:path';

/**
 * The key a program's search path is under: PATH on POSIX; on Windows, whichever key spells it in
 * any case (the first, as `Path` is what Windows itself uses).
 */
export function pathKey(env: Record<string, string | undefined>, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env.PATH === undefined ? undefined : 'PATH';
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
}

/** The path module for the platform's own paths: Windows' backslashes and `;`, or POSIX's. */
export const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);

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

/** The folders a bare name is searched in, in PATH's order. */
export function searchDirs(o: ExecutableLookup): string[] {
  const dirs = pathValue(o).split(pathFor(o.platform).delimiter);
  if (o.platform !== 'win32') return dirs.map((dir) => dir || '.');
  // Entries may be quoted. Only an absolute one is searched: an empty or relative entry
  // (`.`, `bin`) is the session's folder, where a planted claude.exe would be run.
  return dirs.map((dir) => dir.replaceAll('"', '')).filter((dir) => win32.isAbsolute(dir));
}

/**
 * Where `name` would be run from, as an absolute path in the platform's own form, or null. A name
 * with a separator is a path; any other is searched in the PATH value. Symlinks are not resolved:
 * `~/.local/bin/claude` stays that path, so `claude update` keeps working.
 */
export function findExecutable(name: string, o: ExecutableLookup): string | null {
  const path = pathFor(o.platform);
  const names = executableNames(name, o.platform);
  const candidates = isPathName(name, o.platform)
    ? names.map((file) => path.resolve(o.cwd, file))
    : searchDirs(o).flatMap((dir) => names.map((file) => path.resolve(o.cwd, dir, file)));
  return candidates.find((candidate) => o.files.isExecutableFile(candidate)) ?? null;
}

/** `findExecutable`, but throws `<name> was not found …` (naming the PATH searched) when there is none. */
export function resolveExecutable(name: string, o: ExecutableLookup): string {
  const found = findExecutable(name, o);
  if (found !== null) return found;
  throw new Error(
    isPathName(name, o.platform)
      ? `${name} was not found, or is not an executable file`
      : `${name} was not found on PATH (${pathValue(o)})`,
  );
}
