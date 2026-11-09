import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_CLAUDE_VERSION } from '../../shared/types';
import type { ExecutableFiles } from '../pty/findExecutable';
import { buildSpawnEnv } from '../pty/spawnEnv';
import {
  checkClaude,
  checkGit,
  claudePlaces,
  findClaude,
  isAtLeast,
  parseClaudeVersion,
  runVersion,
  type VersionRunner,
} from './programChecks';

const files = (...paths: string[]): ExecutableFiles => ({ isExecutableFile: (p) => paths.includes(p) });
const mac = (env: Record<string, string>, ...existing: string[]) =>
  ({ env, cwd: '/repo', platform: 'darwin' as const, files: files(...existing) });
const win = (env: Record<string, string>, ...existing: string[]) =>
  ({ env, cwd: 'C:\\repo', platform: 'win32' as const, files: files(...existing) });

/** A fake `run`: each file's stdout, or null for a file that can't run. It records what it was asked to run. */
function fakeRun(outputs: Record<string, string | null>): VersionRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = async (file: string, args: string[]) => {
    calls.push(file);
    expect(args).toEqual(['--version']);
    return outputs[file] ?? null;
  };
  return Object.assign(run, { calls });
}

const claudeOutput = (version: string) => `${version} (Claude Code)\n`;
const NATIVE = '/Users/x/.local/bin/claude';
const mapPath = { PATH: '/usr/bin', HOME: '/Users/x' };

const WIN_NATIVE = 'C:\\Users\\x\\.local\\bin\\claude.exe';
const WIN_NPM = 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
const winEnv = { Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };

describe('parseClaudeVersion', () => {
  it("reads the version from claude's own line", () => {
    expect(parseClaudeVersion('2.1.319 (Claude Code)\n')).toBe('2.1.319');
  });

  it("takes nothing else for claude's version", () => {
    expect(parseClaudeVersion('nope')).toBeNull();
    expect(parseClaudeVersion('v26.1.0')).toBeNull();
    expect(parseClaudeVersion('1.2.3')).toBeNull();
    expect(parseClaudeVersion('')).toBeNull();
  });
});

describe('isAtLeast', () => {
  it('compares each part as a number', () => {
    expect(isAtLeast('2.1.295', MIN_CLAUDE_VERSION)).toBe(true);
    expect(isAtLeast('2.1.319', MIN_CLAUDE_VERSION)).toBe(true);
    expect(isAtLeast('2.10.0', '2.9.9')).toBe(true);
    expect(isAtLeast('2.1.294', MIN_CLAUDE_VERSION)).toBe(false);
    expect(isAtLeast('1.9.999', MIN_CLAUDE_VERSION)).toBe(false);
  });
});

describe('claudePlaces', () => {
  it('darwin: the native installer folder, when PATH has no claude', () => {
    expect(claudePlaces(mac(mapPath))).toEqual([NATIVE]);
  });

  it("darwin: PATH's claude comes first", () => {
    expect(claudePlaces(mac(mapPath, '/usr/bin/claude'))).toEqual(['/usr/bin/claude', NATIVE]);
  });

  it('darwin: a claude found on PATH that is the native one is listed once', () => {
    expect(claudePlaces(mac({ PATH: '/Users/x/.local/bin', HOME: '/Users/x' }, NATIVE))).toEqual([NATIVE]);
  });

  it('darwin: with no HOME there is no native place', () => {
    expect(claudePlaces(mac({ PATH: '/usr/bin' }))).toEqual([]);
  });

  it('darwin: never lists the Windows places', () => {
    expect(claudePlaces(mac({ ...mapPath, APPDATA: '/appdata', USERPROFILE: '/profile' }))).toEqual([NATIVE]);
  });

  it("win32: PATH's claude.exe, the native installer's file, then npm's real executable", () => {
    expect(claudePlaces(win(winEnv))).toEqual([WIN_NATIVE, WIN_NPM]);
    expect(claudePlaces(win(winEnv, 'C:\\bin\\claude.exe'))).toEqual(['C:\\bin\\claude.exe', WIN_NATIVE, WIN_NPM]);
  });

  it('win32: a place whose env key is missing is left out', () => {
    expect(claudePlaces(win({ Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\x' }))).toEqual([WIN_NATIVE]);
    expect(claudePlaces(win({ Path: 'C:\\bin', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }))).toEqual([WIN_NPM]);
  });

  it('win32: never lists claude.cmd', () => {
    expect(claudePlaces(win(winEnv, 'C:\\bin\\claude.cmd')).some((place) => place.endsWith('.cmd'))).toBe(false);
  });
});

describe('checkClaude', () => {
  const okFiles = files('/a/claude');

  it('is missing when the path is not an executable file, and says which path', async () => {
    const run = fakeRun({});
    expect(await checkClaude('/nowhere/claude', run, okFiles)).toEqual({ state: 'missing', path: '/nowhere/claude' });
    expect(run.calls).toEqual([]);
  });

  it('is broken when the file prints no version', async () => {
    expect(await checkClaude('/a/claude', fakeRun({ '/a/claude': null }), okFiles)).toEqual({ state: 'broken', path: '/a/claude' });
  });

  it("is broken when the file prints something that isn't claude's line", async () => {
    expect(await checkClaude('/a/claude', fakeRun({ '/a/claude': 'v26.1.0\n' }), okFiles)).toEqual({ state: 'broken', path: '/a/claude' });
  });

  it('is too old below the minimum, and says its version', async () => {
    expect(await checkClaude('/a/claude', fakeRun({ '/a/claude': claudeOutput('2.1.294') }), okFiles)).toEqual({
      state: 'too-old',
      path: '/a/claude',
      version: '2.1.294',
    });
  });

  it('is found at the minimum and above', async () => {
    expect(await checkClaude('/a/claude', fakeRun({ '/a/claude': claudeOutput(MIN_CLAUDE_VERSION) }), okFiles)).toEqual({
      state: 'found',
      path: '/a/claude',
      version: MIN_CLAUDE_VERSION,
    });
    expect(await checkClaude('/a/claude', fakeRun({ '/a/claude': claudeOutput('2.1.319') }), okFiles)).toEqual({
      state: 'found',
      path: '/a/claude',
      version: '2.1.319',
    });
  });
});

describe('findClaude', () => {
  const current = claudeOutput('2.1.319');
  const old = claudeOutput('2.1.100');

  it('with fromEnv, looks only at that path, even when the saved one and PATH are good', async () => {
    const lookup = mac(mapPath, '/env/claude', '/saved/claude', '/usr/bin/claude', NATIVE);
    const run = fakeRun({ '/env/claude': current, '/saved/claude': current, '/usr/bin/claude': current, [NATIVE]: current });
    expect(await findClaude({ fromEnv: '/env/claude', saved: '/saved/claude', lookup, run })).toEqual({
      state: 'found',
      path: '/env/claude',
      version: '2.1.319',
    });
    expect(run.calls).toEqual(['/env/claude']);
  });

  it('with fromEnv, a failure at that path is the answer, and nothing else is tried', async () => {
    const lookup = mac(mapPath, '/saved/claude', NATIVE);
    const run = fakeRun({ '/saved/claude': current, [NATIVE]: current });
    expect(await findClaude({ fromEnv: '/env/claude', saved: '/saved/claude', lookup, run })).toEqual({
      state: 'missing',
      path: '/env/claude',
    });
    expect(run.calls).toEqual([]);
  });

  it('tries the saved path first', async () => {
    const lookup = mac(mapPath, '/saved/claude', '/usr/bin/claude', NATIVE);
    const run = fakeRun({ '/saved/claude': current, '/usr/bin/claude': current, [NATIVE]: current });
    expect(await findClaude({ saved: '/saved/claude', lookup, run })).toEqual({ state: 'found', path: '/saved/claude', version: '2.1.319' });
    expect(run.calls).toEqual(['/saved/claude']);
  });

  it('a saved path that is gone falls through to the native folder', async () => {
    const lookup = mac(mapPath, NATIVE);
    const run = fakeRun({ [NATIVE]: current });
    expect(await findClaude({ saved: '/gone/claude', lookup, run })).toEqual({ state: 'found', path: NATIVE, version: '2.1.319' });
  });

  it("an old claude on PATH does not hide a current one in the native folder", async () => {
    const lookup = mac(mapPath, '/usr/bin/claude', NATIVE);
    const run = fakeRun({ '/usr/bin/claude': old, [NATIVE]: current });
    expect(await findClaude({ lookup, run })).toEqual({ state: 'found', path: NATIVE, version: '2.1.319' });
  });

  it("win32: npm's placeholder that doesn't run is broken, and its path is given", async () => {
    const lookup = win(winEnv, WIN_NPM);
    const run = fakeRun({ [WIN_NPM]: null });
    expect(await findClaude({ lookup, run })).toEqual({ state: 'broken', path: WIN_NPM });
  });

  it('win32: finds the native installer when PATH has nothing', async () => {
    const lookup = win(winEnv, WIN_NATIVE, WIN_NPM);
    const run = fakeRun({ [WIN_NATIVE]: current, [WIN_NPM]: null });
    expect(await findClaude({ lookup, run })).toEqual({ state: 'found', path: WIN_NATIVE, version: '2.1.319' });
  });

  it('with only an old one, is too old, with its path and version', async () => {
    const lookup = mac(mapPath, '/usr/bin/claude');
    const run = fakeRun({ '/usr/bin/claude': old });
    expect(await findClaude({ lookup, run })).toEqual({ state: 'too-old', path: '/usr/bin/claude', version: '2.1.100' });
  });

  it('with several failures, too old is more useful than broken, and broken than missing', async () => {
    const lookup = mac(mapPath, '/usr/bin/claude', NATIVE);
    expect(await findClaude({ saved: '/gone/claude', lookup, run: fakeRun({ '/usr/bin/claude': null, [NATIVE]: old }) })).toEqual({
      state: 'too-old',
      path: NATIVE,
      version: '2.1.100',
    });
    expect(await findClaude({ saved: '/gone/claude', lookup, run: fakeRun({ '/usr/bin/claude': null, [NATIVE]: null }) })).toEqual({
      state: 'broken',
      path: '/usr/bin/claude',
    });
  });

  it('with nothing anywhere, is missing and carries no path', async () => {
    const run = fakeRun({});
    expect(await findClaude({ saved: '/gone/claude', lookup: mac(mapPath), run })).toStrictEqual({ state: 'missing' });
    expect(run.calls).toEqual([]);
  });

  it('a saved path that is also on PATH is run once', async () => {
    const lookup = mac(mapPath, '/usr/bin/claude');
    const run = fakeRun({ '/usr/bin/claude': old });
    await findClaude({ saved: '/usr/bin/claude', lookup, run });
    expect(run.calls).toEqual(['/usr/bin/claude']);
  });
});

describe('checkGit', () => {
  it('is found with its path and version', async () => {
    const run = fakeRun({ '/usr/bin/git': 'git version 2.56.0\n' });
    expect(await checkGit(mac(mapPath, '/usr/bin/git'), run)).toEqual({ state: 'found', path: '/usr/bin/git', version: '2.56.0' });
  });

  it("keeps Windows' whole version token", async () => {
    const run = fakeRun({ 'C:\\bin\\git.exe': 'git version 2.56.0.windows.1\n' });
    expect(await checkGit(win(winEnv, 'C:\\bin\\git.exe'), run)).toEqual({
      state: 'found',
      path: 'C:\\bin\\git.exe',
      version: '2.56.0.windows.1',
    });
  });

  it('is missing when PATH has no git, and runs nothing', async () => {
    const run = fakeRun({});
    expect(await checkGit(mac(mapPath), run)).toStrictEqual({ state: 'missing' });
    expect(run.calls).toEqual([]);
  });

  it("is broken when git doesn't run or doesn't say its version", async () => {
    expect(await checkGit(mac(mapPath, '/usr/bin/git'), fakeRun({ '/usr/bin/git': null }))).toEqual({ state: 'broken', path: '/usr/bin/git' });
    expect(await checkGit(mac(mapPath, '/usr/bin/git'), fakeRun({ '/usr/bin/git': 'hello\n' }))).toEqual({ state: 'broken', path: '/usr/bin/git' });
  });
});

describe('runVersion', () => {
  const env = buildSpawnEnv(process.env, process.platform);

  it("runs a real program with its arguments and gives its stdout", async () => {
    expect((await runVersion(env)(process.execPath, ['--version']))?.trim()).toBe(process.version);
  });

  it("gives null for a file that isn't there", async () => {
    expect(await runVersion(env)(join(tmpdir(), 'mainframe-no-such-program'), ['--version'])).toBeNull();
  });
});
