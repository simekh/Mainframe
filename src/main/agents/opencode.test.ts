import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rolePrompt } from '../manager/rolePrompt';
import { fakeRun } from '../testing/fakeRun';
import { mac, win } from '../testing/lookups';
import {
  findOpencode,
  isOpencodeSessionId,
  makeOpencodeAgent,
  managerConfig,
  newOpencodeSessionId,
  OPENCODE_ENV,
  opencodeAgent,
  opencodeAgents,
  opencodeReopenArgv,
  opencodePlaces,
  opencodeStartArgv,
  parseOpencodeVersion,
  runOpencode,
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

const RULES = [
  { action: 'mainframe_list_sessions', resource: '*', effect: 'allow' },
  { action: 'mainframe_sync_todo', resource: '*', effect: 'allow' },
  { action: 'mainframe_start_task', resource: '*', effect: 'ask' },
];

it("managerConfig is Mainframe's server, its rules at the top and under every agent, and the role prompt's file", () => {
  const o = { url: 'http://127.0.0.1:5555/mcp', token: 'token-1', rolesFile: '/data/m/role-prompt.md', agentIds: ['build', 'plan'] };
  expect(JSON.parse(managerConfig(o))).toEqual({
    mcp: { servers: { mainframe: { type: 'remote', url: o.url, headers: { Authorization: 'Bearer token-1' }, oauth: false } } },
    permissions: RULES,
    agents: { build: { permissions: RULES }, plan: { permissions: RULES } },
    instructions: ['/data/m/role-prompt.md'],
  });
  expect(JSON.parse(managerConfig({ ...o, defaultAgent: 'plan' }))).toMatchObject({ default_agent: 'plan' });
});

const AGENT_LIST = JSON.stringify({
  location: { directory: '/p' },
  data: [
    { id: 'build', mode: 'primary', hidden: false, request: { headers: { Authorization: 'Bearer SECRET-1' } } },
    { id: 'plan', mode: 'all', hidden: false },
    { id: 'general', mode: 'subagent', hidden: false },
    { id: 'title', mode: 'primary', hidden: true },
  ],
});

describe('opencodeAgents', () => {
  it('keeps only ids, default first, and no secrets', async () => {
    const run = vi.fn(async () => AGENT_LIST);
    const result = await opencodeAgents({ bin: 'oc', cwd: '/p', env: { HOME: '/h', PWD: '/elsewhere' }, run });
    expect(result).toEqual([
      { id: 'build', primary: true },
      { id: 'plan', primary: true },
      { id: 'general', primary: false },
      { id: 'title', primary: false },
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET-1');
    expect(run).toHaveBeenCalledWith(['oc', '--standalone', 'api', 'agent.list'], { cwd: '/p', env: { HOME: '/h', PWD: '/p' } });
  });

  it('a failed run says OpenCode could not list its agents, and why', async () => {
    const run = async () => {
      throw new Error('no provider');
    };
    await expect(opencodeAgents({ bin: 'oc', cwd: '/p', env: {}, run })).rejects.toThrow('OpenCode could not list its agents: no provider');
  });
});

describe("the manager's launch on OpenCode", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const launch = async (o: { prompt?: string; managerAgent?: string } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'mainframe-oc-manager-'));
    dirs.push(dir);
    const run = vi.fn(async () => AGENT_LIST);
    const args = await makeOpencodeAgent({ run }).managerLaunch({
      bin: 'oc',
      nodeBin: null,
      env: { HOME: '/h' },
      dir,
      projectDir: '/p',
      name: 'acme-manager',
      mcp: { url: 'http://127.0.0.1:5555/mcp', token: 'token-1' },
      rolePrompt: rolePrompt(opencodeAgent.instructions),
      chat: id,
      resume: o.prompt !== undefined,
      prompt: o.prompt,
      setting: o.managerAgent === undefined ? {} : { managerAgent: o.managerAgent },
    });
    const config = JSON.parse(args.env!.OPENCODE_CONFIG_CONTENT);
    return { dir, run, args, config };
  };

  it('a new chat runs -s with its id, standalone, with OpenCode\'s env and the config', async () => {
    const { args, dir, config } = await launch();
    expect(args.argv).toEqual(['oc', '--standalone', '-s', id]);
    expect(Object.keys(args.env!).sort()).toEqual([...Object.keys(OPENCODE_ENV), 'OPENCODE_CONFIG_CONTENT'].sort());
    expect(args.env).toMatchObject(OPENCODE_ENV);
    const role = readFileSync(join(dir, 'role-prompt.md'), 'utf8');
    expect(role).toContain('AGENTS.md');
    expect(role).not.toContain("this repo's CLAUDE.md");
    expect(config.instructions).toEqual([join(dir, 'role-prompt.md')]);
    expect(config.mcp.servers.mainframe.headers).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('a carry-on ends with its prompt', async () => {
    const { args } = await launch({ prompt: 'Continue where you left off.' });
    expect(args.argv).toEqual(['oc', '--standalone', '-s', id, '--prompt', 'Continue where you left off.']);
  });

  it('the rules sit under every agent OpenCode lists, and with none named the chat is left on its default', async () => {
    const { config, run } = await launch();
    expect(run).toHaveBeenCalledWith(['oc', '--standalone', 'api', 'agent.list'], { cwd: '/p', env: { HOME: '/h', PWD: '/p' } });
    expect(Object.keys(config.agents)).toEqual(['build', 'plan', 'general', 'title']);
    expect(config).not.toHaveProperty('default_agent');
  });

  it('with an agent named in Settings it still lists them all, and makes the named one the default', async () => {
    const { config, run } = await launch({ managerAgent: 'plan' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(Object.keys(config.agents)).toEqual(['build', 'plan', 'general', 'title']);
    expect(config.default_agent).toBe('plan');
  });

  it("a named agent OpenCode no longer lists is not made up: the chat starts on OpenCode's default", async () => {
    const { config } = await launch({ managerAgent: 'gone' });
    expect(Object.keys(config.agents)).toEqual(['build', 'plan', 'general', 'title']);
    expect(config).not.toHaveProperty('default_agent');
  });

  it('a failed lookup fails the launch with its message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mainframe-oc-manager-'));
    dirs.push(dir);
    const run = async (): Promise<string> => {
      throw new Error('opencode exited with code 1');
    };
    const agent = makeOpencodeAgent({ run });
    await expect(
      agent.managerLaunch({
        bin: 'oc', nodeBin: null, env: {}, dir, projectDir: '/p', name: 'm', mcp: { url: 'u', token: 't' },
        rolePrompt: 'R', chat: id, resume: false, setting: {},
      }),
    ).rejects.toThrow('OpenCode could not list its agents: opencode exited with code 1');
  });

  it('carries on the chat manager.json saved, or starts a new one', () => {
    expect(opencodeAgent.managerChat('/d', id)).toBe(id);
    expect(opencodeAgent.managerChat('/d', undefined)).toBeNull();
  });
});

describe('runOpencode', () => {
  const node = (script: string) => runOpencode([process.execPath, '-e', script], { cwd: tmpdir(), env: {} });

  it('resolves with what the program printed', async () => {
    await expect(node('process.stdout.write("out")')).resolves.toBe('out');
  });

  it('takes far more output than the default 1 MiB', async () => {
    await expect(node('process.stdout.write("x".repeat(3 * 1024 * 1024))')).resolves.toHaveLength(3 * 1024 * 1024);
  });

  it("rejects with stderr's last line, or the exit code when stderr is empty", async () => {
    await expect(node('process.stdout.write("secret"); process.stderr.write("first\\nlast line\\n"); process.exit(3)')).rejects.toThrow(
      /^last line$/,
    );
    await expect(node('process.exit(2)')).rejects.toThrow(/^opencode exited with code 2$/);
  });
});
