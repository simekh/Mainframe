import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mac, win } from '../testing/lookups';
import type { ManagerLaunch } from './agent';
import { CODEX_CHAT_FILE, codexAgent, codexManagerArgv, codexPlaces, codexReopenArgv, codexStartArgv, codexTaskModels, parseCodexVersion } from './codex';
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

describe('the manager on Codex', () => {
  const ID = '01a1e9f7-dc3e-7483-81d3-5c390b1a5b42';
  const pairs = [
    'mcp_servers.mainframe.url="http://127.0.0.1:5/mcp"',
    'mcp_servers.mainframe.bearer_token_env_var="MAINFRAME_MCP_TOKEN"',
    'mcp_servers.mainframe.tool_timeout_sec=360',
    'mcp_servers.mainframe.tools.list_sessions.approval_mode="approve"',
    'mcp_servers.mainframe.tools.sync_todo.approval_mode="approve"',
    'mcp_servers.mainframe.tools.close_session.approval_mode="approve"',
    'mcp_servers.mainframe.tools.start_task.approval_mode="prompt"',
    'developer_instructions="Role.\\n\\nBefore your first answer in a chat, call list_sessions."',
  ].flatMap((v) => ['-c', v]);
  const base = { codexBin: 'codex', url: 'http://127.0.0.1:5/mcp', rolePrompt: 'Role.' };

  it('sets every key, before the positionals', () => {
    expect(codexManagerArgv({ ...base, resume: null })).toEqual(['codex', ...pairs]);
    expect(codexManagerArgv({ ...base, resume: ID, prompt: 'Continue where you left off.' })).toEqual([
      'codex', 'resume', ...pairs, ID, 'Continue where you left off.',
    ]);
  });

  it('writes the role prompt as a TOML basic string', () => {
    const argv = codexManagerArgv({ ...base, rolePrompt: 'a"b\\c\nd\x7fe', resume: null });
    expect(argv.at(-1)).toBe('developer_instructions="a\\"b\\\\c\\nd\\u007fe\\n\\nBefore your first answer in a chat, call list_sessions."');
  });

  const launch = (o: Partial<ManagerLaunch>): ManagerLaunch => ({
    bin: 'codex', nodeBin: null, env: {}, dir: '/d', projectDir: '/p', name: 'n',
    mcp: { url: base.url, token: 's3cret-value' }, rolePrompt: 'Role.', chat: ID, resume: true, setting: {}, ...o,
  });

  it('passes the token in the environment only', async () => {
    const { argv, env } = await codexAgent.managerLaunch(launch({}));
    expect(env).toEqual({ MAINFRAME_MCP_TOKEN: 's3cret-value' });
    expect(argv.some((a) => a.includes('s3cret-value'))).toBe(false);
    expect(argv).toContain('resume');
    expect(await codexAgent.managerLaunch(launch({ resume: false }))).toMatchObject({ argv: expect.not.arrayContaining(['resume']) });
  });

  describe('the chat record', () => {
    const dir = () => mkdtempSync(join(tmpdir(), 'mainframe-codex-chat-'));

    it('keeps the id noted, replaces it, and forgets it', () => {
      const d = dir();
      codexAgent.noteManagerChat?.(d, ID);
      expect(codexAgent.managerChat(d, 'saved-ignored')).toBe(ID);
      const other = '01a1e9f7-dc3e-7483-81d3-5c390b1a5b43';
      codexAgent.noteManagerChat?.(d, other);
      expect(codexAgent.managerChat(d, undefined)).toBe(other);
      codexAgent.forgetManagerChat?.(d);
      expect(codexAgent.managerChat(d, undefined)).toBeNull();
      expect(() => codexAgent.forgetManagerChat?.(d)).not.toThrow();
    });

    it('ignores a value that is not a session id', () => {
      const d = dir();
      codexAgent.noteManagerChat?.(d, ID);
      for (const bad of ['', '-x', 'not-a-uuid', `${ID} --x`]) {
        codexAgent.noteManagerChat?.(d, bad);
        expect(codexAgent.managerChat(d, undefined)).toBe(ID);
      }
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, CODEX_CHAT_FILE), JSON.stringify({ sessionId: '-x' }));
      expect(codexAgent.managerChat(d, undefined)).toBeNull();
    });
  });
});

describe("Codex's task models", () => {
  const catalog = readFileSync(join(__dirname, 'fixtures', 'codex-models.json'), 'utf8');

  it('lists the catalog models it shows, with each model\'s efforts', async () => {
    const run = vi.fn(async () => catalog);
    await expect(codexTaskModels({ bin: '/bin/codex', dataDir: '/data', env: { HOME: '/h' } }, run)).resolves.toEqual({
      models: [
        { id: 'gpt-6-sol', name: 'GPT-6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
        { id: 'gpt-5.5', name: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh'] },
      ],
      defaultEfforts: ['low', 'medium', 'high', 'xhigh'],
    });
    expect(run).toHaveBeenCalledWith(['/bin/codex', 'debug', 'models'], { cwd: '/data', env: { HOME: '/h' } });
  });

  it('a catalog that shows no model offers no efforts', async () => {
    const hidden = JSON.stringify({ models: JSON.parse(catalog).models.map((m: object) => ({ ...m, visibility: 'hide' })) });
    await expect(codexTaskModels({ bin: 'codex', dataDir: '/data', env: {} }, async () => hidden)).resolves.toEqual({ models: [], defaultEfforts: [] });
  });

  it('an unreadable catalog rejects', async () => {
    const o = { bin: 'codex', dataDir: '/data', env: {} };
    await expect(codexTaskModels(o, async () => 'not json {')).rejects.toThrow(/^Codex could not list its models: its answer was not JSON$/);
    await expect(codexTaskModels(o, async () => '{"models":[{"slug":1}]}')).rejects.toThrow(/^Codex could not list its models/);
    await expect(codexTaskModels(o, async () => { throw new Error('spawn failed'); })).rejects.toThrow('Codex could not list its models: spawn failed');
  });
});
