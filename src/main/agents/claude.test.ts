import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MIN_CLAUDE_VERSION } from '../../shared/types';
import { fakeRun } from '../testing/fakeRun';
import { files, mac, NODE, win } from '../testing/lookups';
import {
  checkClaude,
  claudePlaces,
  findClaude,
  hookSettings,
  managerArgv,
  mcpConfigJson,
  parseClaudeVersion,
  readRecordedSession,
  readSessionStart,
  reopenArgv,
  SESSION_START_FILE,
  startArgv,
} from './claude';
import { rolePrompt } from '../manager/rolePrompt';
import { ADAPTERS } from './adapters';

const U = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';
const S = '/data/tasks/t1/settings.json';
const MCP = '/data/managers/acme-0a1b2c3d/mcp.json';
const MS = '/data/managers/acme-0a1b2c3d/settings.json';
const M = { claudeBin: 'claude', name: 'acme-manager', claudeSessionId: U, mcpConfigPath: MCP, settingsPath: MS, rolePrompt: 'ROLE' };

it('starts claude in a named worktree with a fixed session id, the hooks file and the prompt', () => {
  expect(startArgv({ claudeBin: 'claude', slug: 'fix-login', name: 'acme-fix-login', claudeSessionId: U, settingsPath: S, prompt: 'P' }))
    .toEqual(['claude', '-w', 'fix-login', '-n', 'acme-fix-login', '--session-id', U, '--settings', S, 'P']);
});

it('gives claude an extra folder right before --settings, so the prompt stays last', () => {
  expect(
    startArgv({ claudeBin: 'claude', slug: 'fix-login', name: 'acme-fix-login', claudeSessionId: U, settingsPath: S, addDir: '/b', prompt: 'P' }),
  ).toEqual(['claude', '-w', 'fix-login', '-n', 'acme-fix-login', '--session-id', U, '--add-dir', '/b', '--settings', S, 'P']);
});

it('reopens in the worktree while its branch exists, and in the main checkout once it is gone', () => {
  const o = { claudeBin: 'claude', slug: 'fix-login', claudeSessionId: U, settingsPath: S };
  expect(reopenArgv({ ...o, branchExists: true })).toEqual(['claude', '--worktree', 'fix-login', '--resume', U, '--settings', S]);
  expect(reopenArgv({ ...o, branchExists: false })).toEqual(['claude', '--resume', U, '--settings', S]);
});

it('reopens with a prompt as the last argument when given one', () => {
  const o = { claudeBin: 'claude', slug: 'fix-login', claudeSessionId: U, settingsPath: S, prompt: 'P' };
  expect(reopenArgv({ ...o, branchExists: true })).toEqual(['claude', '--worktree', 'fix-login', '--resume', U, '--settings', S, 'P']);
  expect(reopenArgv({ ...o, branchExists: false })).toEqual(['claude', '--resume', U, '--settings', S, 'P']);
});

it('refuses to resume an id that is not a UUID', () => {
  expect(() => reopenArgv({ claudeBin: 'claude', slug: 's', claudeSessionId: '--evil', settingsPath: S, branchExists: false })).toThrow('--evil');
});

it('starts the manager in the main checkout, named, with a fixed session id, its MCP config, hooks file and role prompt', () => {
  expect(managerArgv({ ...M, resume: false })).toEqual([
    'claude', '-n', 'acme-manager', '--session-id', U, '--mcp-config', MCP, '--settings', MS, '--append-system-prompt', 'ROLE',
  ]);
});

it('resumes the manager with the same config, hooks file and role prompt', () => {
  expect(managerArgv({ ...M, resume: true })).toEqual([
    'claude', '--resume', U, '--mcp-config', MCP, '--settings', MS, '--append-system-prompt', 'ROLE',
  ]);
});

it.each([false, true])('the manager carry-on prompt comes last, and --mcp-config never directly before it (resume %s)', (resume) => {
  // --mcp-config takes several values, so a positional prompt after it would be read as a config file.
  const argv = managerArgv({ ...M, resume, prompt: 'P' });
  expect(argv.at(-1)).toBe('P');
  expect(argv.at(-2)).toBe('ROLE');
});

it('refuses to resume the manager on an id that is not a UUID', () => {
  expect(() => managerArgv({ ...M, resume: true, claudeSessionId: 'not-a-uuid' })).toThrow('not-a-uuid');
});

it('mcpConfigJson is the entry claude --mcp-config takes for an HTTP server', () => {
  expect(mcpConfigJson('http://127.0.0.1:5000/mcp', 'abc123')).toBe(
    '{"mcpServers":{"mainframe":{"type":"http","url":"http://127.0.0.1:5000/mcp","headers":{"Authorization":"Bearer abc123"},"timeout":360000}}}',
  );
});

it("rolePrompt with Claude's words is today's role prompt", () => {
  expect(rolePrompt(ADAPTERS.claude.instructions)).toBe(
    [
      "You are the manager in Mainframe, the app the owner uses to run several agent sessions, each running Claude Code or OpenCode, on this project at once, one per task. You run in the project's main checkout; each task runs in a worktree of its own and shows on Mainframe's board.",
      "The owner talks to you about their to-do list, about the work in progress, and about work that has no task yet. Mainframe's tools (mainframe) let you list the task sessions, start new ones, and sync the Todo panel's list. Start a session only when the owner asks you to.",
      "You may make small changes yourself, following this repo's CLAUDE.md. Work that needs a branch of its own should become a task, so that it shows on the board.",
    ].join('\n\n'),
  );
});

it("a task's SessionStart hook runs node with no shell", () => {
  for (const settings of [hookSettings('/d/t1', NODE), hookSettings('/d/t1', NODE, [])]) {
    const parsed = JSON.parse(settings);
    expect(Object.keys(parsed)).toEqual(['hooks']);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks).toEqual([
      { type: 'command', command: NODE, args: ['-e', expect.any(String), join('/d/t1', 'session-start.json')], timeout: 10 },
    ]);
  }
});

it('adds the allow rules it is given as permissions.allow, beside the hook', () => {
  const settings = JSON.parse(hookSettings('/d/m', NODE, ['mcp__mainframe__*']));
  expect(settings.permissions).toEqual({ allow: ['mcp__mainframe__*'] });
  expect(Object.keys(settings.hooks)).toEqual(['SessionStart']);
});

it("the node path is the hook's command as it is, spaces and all", () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  expect(JSON.parse(hookSettings('/d', node)).hooks.SessionStart[0].hooks[0].command).toBe(node);
});

it('the hook command saves its input silently, also in a folder whose path has a space, a quote and non-ASCII letters', () => {
  const dir = mkdtempSync(join(tmpdir(), "hook dir 'q' åäö "));
  const hook = JSON.parse(hookSettings(dir, process.execPath)).hooks.SessionStart[0].hooks[0];
  const first = `{"session_id":"${U}","source":"clear"}`;
  expect(execFileSync(hook.command, hook.args, { input: first }).toString()).toBe('');
  expect(readFileSync(join(dir, 'session-start.json'), 'utf8')).toBe(first);
  // The second run replaces the file the first left, as the rename must on Windows too.
  const second = `{"session_id":"${U}","source":"compact"}`;
  expect(execFileSync(hook.command, hook.args, { input: second }).toString()).toBe('');
  expect(readFileSync(join(dir, 'session-start.json'), 'utf8')).toBe(second);
  expect(readdirSync(dir)).toEqual(['session-start.json']);
});

it.each([
  [`{"session_id":"${U}","source":"startup","transcript_path":"/t/${U}.jsonl"}`, { id: U, source: 'startup', transcriptPath: `/t/${U}.jsonl` }],
  [`{"session_id":"${U}"}`, { id: U }],
  [`{"session_id":"${U}","source":1,"transcript_path":7}`, { id: U }],
  [null, null],
  ['{', null],
  ['{"session_id":"--evil","source":"startup"}', null],
  ['[]', null],
])('readSessionStart(%j) is %j', (text, start) => {
  expect(readSessionStart(text)).toEqual(start);
});

it('the recorded session is the id SessionStart gave, whether or not Claude Code has saved the chat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mainframe-recorded-'));
  const unsaved = join(dir, 'projects', '-main', `${U}.jsonl`);
  writeFileSync(join(dir, SESSION_START_FILE), JSON.stringify({ session_id: U, source: 'startup', transcript_path: unsaved }));
  expect(readRecordedSession(dir)).toBe(U);
});

it('there is no recorded session while SessionStart has not fired', () => {
  expect(readRecordedSession(mkdtempSync(join(tmpdir(), 'mainframe-recorded-')))).toBeNull();
});

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
