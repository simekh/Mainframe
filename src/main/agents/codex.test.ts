import { describe, expect, it } from 'vitest';
import { mac, win } from '../testing/lookups';
import type { ManagerLaunch } from './agent';
import { codexAgent, codexPlaces, codexReopenArgv, codexStartArgv, parseCodexVersion } from './codex';
import { opencodeAgent } from './opencode';

describe('parseCodexVersion', () => {
  it('reads the version only from a line that is exactly codex-cli X.Y.Z', () => {
    expect(parseCodexVersion('codex-cli 0.169.0\n')).toBe('0.169.0');
    expect(parseCodexVersion('codex-cli 0.169.0-alpha.1')).toBeNull();
    expect(parseCodexVersion('codex 0.169.0')).toBeNull();
    expect(parseCodexVersion('warning: something\ncodex-cli 0.169.0')).toBeNull();
    expect(parseCodexVersion('')).toBeNull();
  });

  it('reads the line when it comes in colour', () => {
    expect(parseCodexVersion('\x1b[1mcodex-cli 0.169.0\x1b[0m')).toBe('0.169.0');
  });
});

describe('codexPlaces', () => {
  const CODEX = '/home/u/.local/bin/codex';
  const WIN_CODEX = 'C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';

  it("posix: PATH's codex, then the installer's file under HOME, once each", () => {
    expect(codexPlaces(mac({ PATH: '/usr/bin', HOME: '/home/u' }))).toEqual([CODEX]);
    expect(codexPlaces(mac({ PATH: '/usr/bin', HOME: '/home/u' }, '/usr/bin/codex'))).toEqual(['/usr/bin/codex', CODEX]);
    expect(codexPlaces(mac({ PATH: '/home/u/.local/bin', HOME: '/home/u' }, CODEX))).toEqual([CODEX]);
    expect(codexPlaces(mac({ PATH: '/usr/bin' }))).toEqual([]);
  });

  it("win32: the installer's codex.exe under LOCALAPPDATA", () => {
    expect(codexPlaces(win({ Path: 'C:\\bin', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }))).toEqual([WIN_CODEX]);
    expect(codexPlaces(win({ Path: 'C:\\bin', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\bin\\codex.exe'))).toEqual([
      'C:\\bin\\codex.exe',
      WIN_CODEX,
    ]);
    expect(codexPlaces(win({ Path: 'C:\\bin' }))).toEqual([]);
  });
});

it('a task starts as `codex <prompt>` and reopens as `codex resume --last [prompt]`', () => {
  expect(codexStartArgv({ codexBin: '/b/codex', prompt: 'Do it' })).toEqual(['/b/codex', 'Do it']);
  expect(codexReopenArgv({ codexBin: '/b/codex' })).toEqual(['/b/codex', 'resume', '--last']);
  expect(codexReopenArgv({ codexBin: '/b/codex', prompt: '' })).toEqual(['/b/codex', 'resume', '--last']);
  expect(codexReopenArgv({ codexBin: '/b/codex', prompt: 'Carry on' })).toEqual(['/b/codex', 'resume', '--last', 'Carry on']);
});

it('the adapter: Mainframe adds the worktree, records no session, needs no node', () => {
  expect(codexAgent).toMatchObject({ name: 'codex', envVar: 'MAINFRAME_CODEX_BIN', mainframeAddsWorktree: true, worktreesDir: '.mainframe/worktrees', needsNode: false });
  expect(codexAgent.recordedSession('/any')).toBeNull();
  expect(codexAgent.chatKept('/any')).toBe(true);
  expect(codexAgent.began('/any', { began: true })).toBe(true);
  expect(codexAgent.began('/any', {})).toBe(false);
  expect(codexAgent.taskStart({ bin: '/b/codex', nodeBin: null, taskDir: '/t', slug: 's', name: 'n', sessionId: 'x', prompt: 'P' })).toEqual({ argv: ['/b/codex', 'P'] });
  expect(codexAgent.taskReopen({ bin: '/b/codex', nodeBin: null, taskDir: '/t', slug: 's', sessionId: 'x' })).toEqual({ argv: ['/b/codex', 'resume', '--last'] });
  expect(codexAgent.newSessionId(() => 'u-1')).toBe('u-1');
});

it("names the repo's instructions and the worktree as OpenCode does", () => {
  expect(codexAgent.instructions).toBe(opencodeAgent.instructions);
  const where = { branch: 'worktree-s', worktreePath: '/p/.mainframe/worktrees/s', projectDir: '/p' };
  expect(codexAgent.worktreeNote(where)).toBe(opencodeAgent.worktreeNote(where));
});

it("Codex's shell variables are dropped, the user's CODEX_HOME is not", () => {
  expect(codexAgent.droppedEnv).toEqual(
    expect.arrayContaining([
      'CODEX_SANDBOX',
      'CODEX_SANDBOX_NETWORK_DISABLED',
      'CODEX_SESSION_ID',
      'CODEX_THREAD_ID',
      'CODEX_TOOL_CALL_ID',
      'CODEX_CI',
      'CODEX_PERMISSION_PROFILE',
      'CODEX_VERSION',
      'CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS',
      'CODEX_MANAGED_BY_NPM',
      'CODEX_MANAGED_PACKAGE_ROOT',
    ]),
  );
  expect(codexAgent.droppedEnv).not.toContain('CODEX_HOME');
});

it('the manager and the Todo sync refuse until they run on Codex', async () => {
  await expect(codexAgent.managerLaunch({} as ManagerLaunch)).rejects.toThrow("The manager doesn't run on Codex yet.");
  expect(codexAgent.managerChat('/any', 'saved')).toBeNull();
  const prepare = { bin: '/b/codex', nodeBin: null, dir: '/d', projectDir: '/p', env: {}, step: 'discover', tools: [], setting: {} } as unknown as Parameters<
    typeof codexAgent.sync.prepare
  >[0];
  expect(() => codexAgent.sync.prepare(prepare)).toThrow("The Todo sync doesn't run on Codex yet.");
  expect(() => codexAgent.sync.readAnswer('{}', [])).toThrow("The Todo sync doesn't run on Codex yet.");
  expect(codexAgent.sync.isToolName('tracker_get_card')).toBe(false);
  expect(codexAgent.sync.models).toBeUndefined();
});
