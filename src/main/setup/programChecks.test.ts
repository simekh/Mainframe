import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_CLAUDE_VERSION } from '../../shared/types';
import { buildSpawnEnv } from '../pty/spawnEnv';
import { fakeRun } from '../testing/fakeRun';
import { mac, win } from '../testing/lookups';
import { checkGit, isAtLeast, runVersion } from './programChecks';

const mapPath = { PATH: '/usr/bin', HOME: '/Users/x' };
const winEnv = { Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };

describe('isAtLeast', () => {
  it('compares each part as a number', () => {
    expect(isAtLeast('2.1.295', MIN_CLAUDE_VERSION)).toBe(true);
    expect(isAtLeast('2.1.319', MIN_CLAUDE_VERSION)).toBe(true);
    expect(isAtLeast('2.10.0', '2.9.9')).toBe(true);
    expect(isAtLeast('2.1.294', MIN_CLAUDE_VERSION)).toBe(false);
    expect(isAtLeast('1.9.999', MIN_CLAUDE_VERSION)).toBe(false);
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
