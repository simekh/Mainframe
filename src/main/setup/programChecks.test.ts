import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_CLAUDE_VERSION } from '../../shared/types';
import { buildSpawnEnv } from '../pty/spawnEnv';
import { files, mac, win } from '../testing/lookups';
import {
  checkClaude,
  checkGit,
  claudePlaces,
  findClaude,
  isAtLeast,
  findOpencode,
  opencodePlaces,
  parseClaudeVersion,
  parseOpencodeVersion,
  runVersion,
  type VersionRunner,
} from './programChecks';

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
// A custom npm prefix (nvm-windows, fnm, Volta): claude.cmd on PATH there, the package beside it.
const PREFIX = 'D:\\nvm\\v26';
const PREFIX_CMD = `${PREFIX}\\claude.cmd`;
const PREFIX_EXE = `${PREFIX}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
const prefixEnv = { ...winEnv, Path: `C:\\bin;${PREFIX}` };

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

  it("win32: a PATH folder holding claude.cmd adds the package's claude.exe beside it, after the native one and before %APPDATA%'s", () => {
    expect(claudePlaces(win(prefixEnv, PREFIX_CMD))).toEqual([WIN_NATIVE, PREFIX_EXE, WIN_NPM]);
  });

  it('win32: a PATH folder without claude.cmd adds no npm place', () => {
    expect(claudePlaces(win(prefixEnv))).toEqual([WIN_NATIVE, WIN_NPM]);
  });

  it("win32: npm's own folder on PATH is listed once", () => {
    const npmFolder = 'C:\\Users\\x\\AppData\\Roaming\\npm';
    expect(claudePlaces(win({ ...winEnv, Path: npmFolder }, `${npmFolder}\\claude.cmd`))).toEqual([WIN_NATIVE, WIN_NPM]);
  });

  it('win32: reads PATH as the lookup does: quotes stripped, relative entries left out', () => {
    const quoted = { ...winEnv, Path: `"${PREFIX}";npm` };
    expect(claudePlaces(win(quoted, PREFIX_CMD, 'C:\\repo\\npm\\claude.cmd'))).toEqual([WIN_NATIVE, PREFIX_EXE, WIN_NPM]);
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
    expect(await findClaude({ fromEnv: '/env/claude', saved: ['/saved/claude'], lookup, run })).toEqual({
      state: 'found',
      path: '/env/claude',
      version: '2.1.319',
    });
    expect(run.calls).toEqual(['/env/claude']);
  });

  it('with fromEnv, a failure at that path is the answer, and nothing else is tried', async () => {
    const lookup = mac(mapPath, '/saved/claude', NATIVE);
    const run = fakeRun({ '/saved/claude': current, [NATIVE]: current });
    expect(await findClaude({ fromEnv: '/env/claude', saved: ['/saved/claude'], lookup, run })).toEqual({
      state: 'missing',
      path: '/env/claude',
    });
    expect(run.calls).toEqual([]);
  });

  it("with a relative fromEnv, checks and gives the absolute path sessions will run (from Mainframe's folder, once)", async () => {
    const lookup = mac(mapPath, '/claude-code/dist/claude');
    const run = fakeRun({ '/claude-code/dist/claude': current });
    expect(await findClaude({ fromEnv: '../claude-code/dist/claude', lookup, run })).toEqual({
      state: 'found',
      path: '/claude-code/dist/claude',
      version: '2.1.319',
    });
    expect(run.calls).toEqual(['/claude-code/dist/claude']);
  });

  it('with a bare fromEnv, looks the name up on PATH, as sessions do, and gives where it is', async () => {
    const lookup = mac(mapPath, '/usr/bin/claude-dev');
    const run = fakeRun({ '/usr/bin/claude-dev': current });
    expect(await findClaude({ fromEnv: 'claude-dev', lookup, run })).toEqual({
      state: 'found',
      path: '/usr/bin/claude-dev',
      version: '2.1.319',
    });
  });

  it("with a bare fromEnv, a file of that name in Mainframe's own folder is not run: only PATH is searched", async () => {
    const lookup = mac(mapPath, '/repo/claude-dev');
    const run = fakeRun({ '/repo/claude-dev': current });
    expect(await findClaude({ fromEnv: 'claude-dev', lookup, run })).toEqual({ state: 'missing', path: 'claude-dev' });
    expect(run.calls).toEqual([]);
  });

  it('win32: a bare fromEnv is looked up on PATH with its .exe', async () => {
    const lookup = win(winEnv, 'C:\\bin\\claude-dev.exe');
    const run = fakeRun({ 'C:\\bin\\claude-dev.exe': current });
    expect(await findClaude({ fromEnv: 'claude-dev', lookup, run })).toEqual({
      state: 'found',
      path: 'C:\\bin\\claude-dev.exe',
      version: '2.1.319',
    });
  });

  it('tries the saved path first', async () => {
    const lookup = mac(mapPath, '/saved/claude', '/usr/bin/claude', NATIVE);
    const run = fakeRun({ '/saved/claude': current, '/usr/bin/claude': current, [NATIVE]: current });
    expect(await findClaude({ saved: ['/saved/claude'], lookup, run })).toEqual({ state: 'found', path: '/saved/claude', version: '2.1.319' });
    expect(run.calls).toEqual(['/saved/claude']);
  });

  it('tries the saved paths in order, before the places', async () => {
    const lookup = mac(mapPath, '/first/claude', '/second/claude', '/usr/bin/claude', NATIVE);
    const run = fakeRun({ '/first/claude': null, '/second/claude': current, '/usr/bin/claude': current, [NATIVE]: current });
    expect(await findClaude({ saved: ['/first/claude', '/second/claude'], lookup, run })).toEqual({
      state: 'found',
      path: '/second/claude',
      version: '2.1.319',
    });
    expect(run.calls).toEqual(['/first/claude', '/second/claude']);
  });

  it('a saved path that is gone falls through to the native folder', async () => {
    const lookup = mac(mapPath, NATIVE);
    const run = fakeRun({ [NATIVE]: current });
    expect(await findClaude({ saved: ['/gone/claude'], lookup, run })).toEqual({ state: 'found', path: NATIVE, version: '2.1.319' });
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

  it("win32: finds the real claude.exe behind a claude.cmd in a custom npm prefix, and never runs the .cmd", async () => {
    const lookup = win(prefixEnv, PREFIX_CMD, PREFIX_EXE);
    const run = fakeRun({ [PREFIX_EXE]: current });
    expect(await findClaude({ lookup, run })).toEqual({ state: 'found', path: PREFIX_EXE, version: '2.1.319' });
    expect(run.calls).toEqual([PREFIX_EXE]);
  });

  it("win32: a claude.cmd with only npm's placeholder behind it is broken, and the placeholder's path is given", async () => {
    const lookup = win(prefixEnv, PREFIX_CMD, PREFIX_EXE);
    expect(await findClaude({ lookup, run: fakeRun({ [PREFIX_EXE]: null }) })).toEqual({ state: 'broken', path: PREFIX_EXE });
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
    expect(await findClaude({ saved: ['/gone/claude'], lookup, run: fakeRun({ '/usr/bin/claude': null, [NATIVE]: old }) })).toEqual({
      state: 'too-old',
      path: NATIVE,
      version: '2.1.100',
    });
    expect(await findClaude({ saved: ['/gone/claude'], lookup, run: fakeRun({ '/usr/bin/claude': null, [NATIVE]: null }) })).toEqual({
      state: 'broken',
      path: '/usr/bin/claude',
    });
  });

  it('with nothing anywhere, is missing and carries no path', async () => {
    const run = fakeRun({});
    expect(await findClaude({ saved: ['/gone/claude'], lookup: mac(mapPath), run })).toStrictEqual({ state: 'missing' });
    expect(run.calls).toEqual([]);
  });

  it('a saved path that is also on PATH is run once', async () => {
    const lookup = mac(mapPath, '/usr/bin/claude');
    const run = fakeRun({ '/usr/bin/claude': old });
    await findClaude({ saved: ['/usr/bin/claude'], lookup, run });
    expect(run.calls).toEqual(['/usr/bin/claude']);
  });
});

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
