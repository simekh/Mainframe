import { expect, it } from 'vitest';
import { findExecutable, resolveExecutable, type ExecutableFiles } from './findExecutable';

const files = (...paths: string[]): ExecutableFiles => ({ isExecutableFile: (p) => paths.includes(p) });
const mac = (env: Record<string, string>, ...existing: string[]) =>
  ({ env, cwd: '/repo', platform: 'darwin' as const, files: files(...existing) });
const win = (env: Record<string, string>, ...existing: string[]) =>
  ({ env, cwd: 'C:\\repo', platform: 'win32' as const, files: files(...existing) });

it('darwin: finds a bare name in the PATH directory that has it', () => {
  expect(findExecutable('claude', mac({ PATH: '/a:/b' }, '/b/claude'))).toBe('/b/claude');
});

it('darwin: the first directory that has it wins', () => {
  expect(findExecutable('claude', mac({ PATH: '/a:/b' }, '/a/claude', '/b/claude'))).toBe('/a/claude');
});

it('darwin: an empty PATH entry is the folder it runs from', () => {
  expect(findExecutable('claude', mac({ PATH: ':/b' }, '/repo/claude'))).toBe('/repo/claude');
});

it('darwin: searches /usr/bin:/bin when there is no PATH', () => {
  expect(findExecutable('claude', mac({}, '/bin/claude'))).toBe('/bin/claude');
  expect(findExecutable('claude', mac({}, '/usr/local/bin/claude'))).toBeNull();
});

it('darwin: a name with a slash is a path, resolved against the folder it runs from', () => {
  expect(findExecutable('./bin/claude', mac({ PATH: '/a' }, '/repo/bin/claude'))).toBe('/repo/bin/claude');
});

it('darwin: a path that is missing is null', () => {
  expect(findExecutable('/nowhere/claude', mac({ PATH: '/a' }, '/a/claude'))).toBeNull();
});

it('darwin: a backslash is part of a bare name', () => {
  expect(findExecutable('a\\b', mac({ PATH: '/x' }, '/x/a\\b'))).toBe('/x/a\\b');
});

it('win32: finds claude.exe in the Path directory that has it', () => {
  expect(findExecutable('claude', win({ Path: 'C:\\a;C:\\b' }, 'C:\\b\\claude.exe'))).toBe('C:\\b\\claude.exe');
});

it('win32: .exe is tried before .com', () => {
  expect(findExecutable('claude', win({ Path: 'C:\\a' }, 'C:\\a\\claude.com', 'C:\\a\\claude.exe'))).toBe('C:\\a\\claude.exe');
  expect(findExecutable('claude', win({ Path: 'C:\\a' }, 'C:\\a\\claude.com'))).toBe('C:\\a\\claude.com');
});

it('win32: never picks a .cmd or .bat, which only a shell can run', () => {
  expect(findExecutable('claude', win({ Path: 'C:\\a' }, 'C:\\a\\claude.cmd', 'C:\\a\\claude.bat'))).toBeNull();
  expect(findExecutable('claude.cmd', win({ Path: 'C:\\a' }, 'C:\\a\\claude.cmd'))).toBeNull();
});

it('win32: searches a quoted Path entry without its quotes', () => {
  const exe = 'C:\\Program Files\\x\\claude.exe';
  expect(findExecutable('claude', win({ Path: '"C:\\Program Files\\x"' }, exe))).toBe(exe);
});

it('win32: an entry with forward slashes is searched, and the result has backslashes', () => {
  expect(findExecutable('claude', win({ Path: 'C:/a' }, 'C:\\a\\claude.exe'))).toBe('C:\\a\\claude.exe');
});

it('win32: an absolute path gets .exe when it has no extension, and is kept when it has .exe in any case', () => {
  const o = win({ Path: '' }, 'C:\\x\\claude.exe', 'C:\\x\\TOOL.EXE', 'C:\\x\\claude.cmd');
  expect(findExecutable('C:\\x\\claude', o)).toBe('C:\\x\\claude.exe');
  expect(findExecutable('C:\\x\\claude.exe', o)).toBe('C:\\x\\claude.exe');
  expect(findExecutable('C:\\x\\TOOL.EXE', o)).toBe('C:\\x\\TOOL.EXE');
  expect(findExecutable('C:\\x\\claude.cmd', o)).toBeNull();
});

it('win32: a relative path is resolved against the folder it runs from', () => {
  expect(findExecutable('bin\\claude', win({ Path: 'C:\\a' }, 'C:\\repo\\bin\\claude.exe'))).toBe('C:\\repo\\bin\\claude.exe');
});

it("win32: never looks in the folder it runs from, which the repo's own files could fill", () => {
  const o = (path: string) => win({ Path: path }, 'C:\\repo\\claude.exe');
  expect(findExecutable('claude', o(''))).toBeNull();
  expect(findExecutable('claude', o(';C:\\b'))).toBeNull();
});

it('win32: reads an upper case PATH too', () => {
  expect(findExecutable('claude', win({ PATH: 'C:\\a' }, 'C:\\a\\claude.exe'))).toBe('C:\\a\\claude.exe');
});

it('win32: with both Path and PATH, only the first key in the env is searched', () => {
  const exes = ['C:\\a\\claude.exe', 'C:\\b\\claude.exe'];
  expect(findExecutable('claude', win({ Path: 'C:\\a', PATH: 'C:\\b' }, ...exes))).toBe('C:\\a\\claude.exe');
  expect(findExecutable('claude', win({ Path: 'C:\\c', PATH: 'C:\\b' }, ...exes))).toBeNull();
});

it('resolveExecutable gives the path it finds', () => {
  expect(resolveExecutable('claude', mac({ PATH: '/a' }, '/a/claude'))).toBe('/a/claude');
});

it('resolveExecutable says a bare name was not found on PATH, and which PATH', () => {
  expect(() => resolveExecutable('claude', mac({ PATH: '/a:/b' }))).toThrow('claude was not found on PATH (/a:/b)');
});

it('resolveExecutable says a path was not found or is not executable, naming it as given', () => {
  expect(() => resolveExecutable('/nowhere/claude', mac({ PATH: '/a' }))).toThrow('/nowhere/claude was not found, or is not an executable file');
});
