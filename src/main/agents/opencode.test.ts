import { describe, expect, it } from 'vitest';
import { fakeRun } from '../testing/fakeRun';
import { mac, win } from '../testing/lookups';
import {
  findOpencode,
  isOpencodeSessionId,
  newOpencodeSessionId,
  OPENCODE_ENV,
  opencodeReopenArgv,
  opencodePlaces,
  opencodeStartArgv,
  parseOpencodeVersion,
} from './opencode';

const id = 'ses_' + 'a'.repeat(28);

it('starts a session under the given id with the prompt, standalone', () => {
  expect(opencodeStartArgv({ opencodeBin: 'oc', sessionId: id, prompt: 'P' })).toEqual([
    'oc', '--standalone', '-s', id, '--prompt', 'P',
  ]);
});

it('reopens a session without a prompt, or with one', () => {
  expect(opencodeReopenArgv({ opencodeBin: 'oc', sessionId: id })).toEqual(['oc', '--standalone', '-s', id]);
  expect(opencodeReopenArgv({ opencodeBin: 'oc', sessionId: id, prompt: 'P' })).toEqual([
    'oc', '--standalone', '-s', id, '--prompt', 'P',
  ]);
});

it('refuses to reopen a session whose id is not an OpenCode id', () => {
  expect(() => opencodeReopenArgv({ opencodeBin: 'oc', sessionId: 'ses_x' })).toThrow('not a session id: ses_x');
});

it('makes distinct ids that pass the check', () => {
  const ids = Array.from({ length: 100 }, newOpencodeSessionId);
  expect(ids.every(isOpencodeSessionId)).toBe(true);
  expect(new Set(ids).size).toBe(100);
});

it('turns OpenCode tabs off in its environment', () => {
  expect(OPENCODE_ENV).toEqual({ OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"}}' });
});

const mapPath = { PATH: '/usr/bin', HOME: '/Users/x' };
const winEnv = { Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };
const OC = '/Users/x/.opencode/bin/opencode';
const WIN_OC = 'C:\\Users\\x\\.opencode\\bin\\opencode.exe';
const opencodeOutput = (version: string) => `opencode v${version}\n`;

describe('parseOpencodeVersion', () => {
  it("reads the version from opencode's own line", () => {
    expect(parseOpencodeVersion('opencode v2.2.7\n')).toBe('2.2.7');
  });

  it('reads the line when FORCE_COLOR makes opencode print colour codes', () => {
    expect(parseOpencodeVersion('\x1b[1mopencode\x1b[0m \x1b[2mv\x1b[0m\x1b[1m2.2.7\x1b[0m\n')).toBe('2.2.7');
  });

  it('takes nothing else for the version', () => {
    expect(parseOpencodeVersion('2.2.7 (Claude Code)')).toBeNull();
    expect(parseOpencodeVersion('2.2.7')).toBeNull();
    expect(parseOpencodeVersion('')).toBeNull();
  });
});

describe('opencodePlaces', () => {
  it("darwin: PATH's opencode, then the installer's file, once each", () => {
    expect(opencodePlaces(mac(mapPath))).toEqual([OC]);
    expect(opencodePlaces(mac(mapPath, '/usr/bin/opencode'))).toEqual(['/usr/bin/opencode', OC]);
    expect(opencodePlaces(mac({ PATH: '/Users/x/.opencode/bin', HOME: '/Users/x' }, OC))).toEqual([OC]);
  });

  it('darwin: with no HOME there is no installer place', () => {
    expect(opencodePlaces(mac({ PATH: '/usr/bin' }))).toEqual([]);
  });

  it("win32: the installer's opencode.exe, under USERPROFILE", () => {
    expect(opencodePlaces(win(winEnv))).toEqual([WIN_OC]);
    expect(opencodePlaces(win({ Path: 'C:\\bin' }))).toEqual([]);
  });
});

describe('findOpencode', () => {
  const current = opencodeOutput('2.2.7');

  it('with an old one on PATH, is too old, with its path and version', async () => {
    const lookup = mac(mapPath, '/usr/bin/opencode');
    const run = fakeRun({ '/usr/bin/opencode': opencodeOutput('1.18.35') });
    expect(await findOpencode({ lookup, run })).toEqual({ state: 'too-old', path: '/usr/bin/opencode', version: '1.18.35' });
  });

  it('with nothing anywhere, is missing and carries no path', async () => {
    const run = fakeRun({});
    expect(await findOpencode({ lookup: mac(mapPath), run })).toStrictEqual({ state: 'missing' });
    expect(run.calls).toEqual([]);
  });

  it("finds the installer's opencode when PATH has none", async () => {
    expect(await findOpencode({ lookup: mac(mapPath, OC), run: fakeRun({ [OC]: current }) })).toEqual({
      state: 'found',
      path: OC,
      version: '2.2.7',
    });
  });

  it("win32: finds the installer's opencode.exe when PATH has none", async () => {
    expect(await findOpencode({ lookup: win(winEnv, WIN_OC), run: fakeRun({ [WIN_OC]: current }) })).toEqual({
      state: 'found',
      path: WIN_OC,
      version: '2.2.7',
    });
  });

  it('an old opencode on PATH does not hide a current one in the installer folder', async () => {
    const lookup = mac(mapPath, '/usr/bin/opencode', OC);
    const run = fakeRun({ '/usr/bin/opencode': opencodeOutput('1.18.35'), [OC]: current });
    expect(await findOpencode({ lookup, run })).toEqual({ state: 'found', path: OC, version: '2.2.7' });
  });

  it('with fromEnv, looks only at that path', async () => {
    const lookup = mac(mapPath, '/env/opencode', '/usr/bin/opencode', OC);
    const run = fakeRun({ '/env/opencode': current, '/usr/bin/opencode': current, [OC]: current });
    expect(await findOpencode({ fromEnv: '/env/opencode', lookup, run })).toEqual({ state: 'found', path: '/env/opencode', version: '2.2.7' });
    expect(run.calls).toEqual(['/env/opencode']);
    expect(await findOpencode({ fromEnv: '/gone/opencode', lookup, run: fakeRun({}) })).toEqual({ state: 'missing', path: '/gone/opencode' });
  });

  it('tries the saved path first, and falls through to the places when it is gone', async () => {
    const lookup = mac(mapPath, '/saved/opencode', OC);
    const run = fakeRun({ '/saved/opencode': current, [OC]: current });
    expect(await findOpencode({ saved: ['/saved/opencode'], lookup, run })).toEqual({ state: 'found', path: '/saved/opencode', version: '2.2.7' });
    expect(await findOpencode({ saved: ['/gone/opencode'], lookup, run })).toEqual({ state: 'found', path: OC, version: '2.2.7' });
  });
});
