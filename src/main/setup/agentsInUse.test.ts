import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentName, ProgramCheck, SettingsView } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import { NODE_NEEDED } from '../agents/claude';
import type { runOpencode } from '../agents/opencode';
import { AgentsInUse } from './agentsInUse';
import { readSettings, type AppSettings } from './settings';

const C = '/bin/claude';
const O = '/bin/opencode';
const found = (path: string): ProgramCheck => ({ state: 'found', path, version: '9.9.9' });
const missing: ProgramCheck = { state: 'missing' };
const both = { claude: found(C), opencode: found(O) };

/** The files on this computer, each with what it prints for `--version`. */
const programs: Record<string, string> = {
  '/new/claude': '2.1.319 (Claude Code)\n',
  '/old/claude': '2.0.1 (Claude Code)\n',
};
const deps = {
  run: async (file: string) => programs[file] ?? null,
  lookup: { env: {}, cwd: '/', platform: 'darwin' as const, files: { isExecutableFile: (path: string) => path in programs } },
  nodeBin: '/bin/node' as string | null,
  env: { HOME: '/h' },
};

const agents = (settings: AppSettings, checks: Record<AgentName, ProgramCheck>) =>
  new AgentsInUse({ dataDir: '/data', settings, checks, envBins: {}, ...deps, onChange: () => {} });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An AgentsInUse on a data folder of its own, with what it saved (null for nothing) and the views it sent. */
function onDisk(
  settings: AppSettings,
  checks: Record<AgentName, ProgramCheck>,
  more: { nodeBin?: string | null; envBins?: Partial<Record<AgentName, string>>; runOpencode?: typeof runOpencode } = {},
) {
  const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-agents-'));
  dirs.push(dataDir);
  const sent: SettingsView[] = [];
  const a = new AgentsInUse({ dataDir, settings, checks, envBins: {}, ...deps, ...more, onChange: (view) => sent.push(view) });
  const saved = () => (existsSync(join(dataDir, 'settings.json')) ? readSettings(dataDir, () => {}) : null);
  return { a, dataDir, sent, saved };
}

describe('AgentsInUse', () => {
  it('runs on the saved default while it works', () => {
    const a = agents({ defaultAgent: 'opencode' }, { claude: found(C), opencode: found(O) });
    expect(a.defaultAgent()).toBe('opencode');
  });

  it('falls back to another ticked agent when the saved default does not work', () => {
    const a = agents({ defaultAgent: 'claude', agents: { claude: { enabled: true } } }, { claude: missing, opencode: found(O) });
    expect(a.defaultAgent()).toBe('opencode');
  });

  it('ticked() leaves out an agent that is not found', () => {
    const a = agents({ agents: { claude: { enabled: true }, opencode: { enabled: true } } }, { claude: missing, opencode: found(O) });
    expect(a.ticked()).toEqual(['opencode']);
  });

  it('bin() is the found path, ticked or not, and null otherwise', () => {
    const a = agents({ agents: { opencode: { enabled: false } } }, { claude: found(C), opencode: found(O) });
    expect(a.ticked()).toEqual(['claude']);
    expect(a.bin('claude')).toBe(C);
    expect(a.bin('opencode')).toBe(O);
    expect(agents({}, { claude: found(C), opencode: missing }).bin('opencode')).toBeNull();
  });

  it('inUse() is the default agent with its adapter, path and setting', () => {
    const setting = { enabled: true, syncModel: 'm' };
    const a = agents({ defaultAgent: 'opencode', agents: { opencode: setting } }, { claude: found(C), opencode: found(O) });
    expect(a.inUse()).toEqual({ adapter: ADAPTERS.opencode, bin: O, setting });
    expect(agents({}, { claude: found(C), opencode: missing }).inUse()).toEqual({ adapter: ADAPTERS.claude, bin: C, setting: {} });
  });

  it('saveAgentSetting writes settings.json and inUse() sees it', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-agents-'));
    try {
      const settings: AppSettings = { defaultAgent: 'opencode', agents: { opencode: { enabled: true, syncModel: 'p/old' } }, welcomeSeen: true };
      const a = new AgentsInUse({ dataDir, settings, checks: { claude: found(C), opencode: found(O) }, envBins: {}, ...deps, onChange: () => {} });

      a.saveAgentSetting('opencode', { syncModel: 'p/new' });

      const setting = { enabled: true, syncModel: 'p/new' };
      expect(a.inUse().setting).toEqual(setting);
      expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))).toEqual({
        version: 2,
        defaultAgent: 'opencode',
        agents: { opencode: setting },
        welcomeSeen: true,
      });
      expect(readSettings(dataDir, () => {})).toEqual({ defaultAgent: 'opencode', agents: { opencode: setting }, welcomeSeen: true });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("setTicked refuses an agent that doesn't work, the saved default and the last tick, and Claude Code without Node", () => {
    const notFound = onDisk({ defaultAgent: 'opencode' }, { claude: missing, opencode: found(O) });
    expect(() => notFound.a.setTicked('claude', true)).toThrow("Claude Code doesn't work, so it can't be ticked");

    const savedDefault = onDisk({ defaultAgent: 'claude' }, both);
    expect(() => savedDefault.a.setTicked('claude', false)).toThrow('Make another agent the default first');

    // Claude Code is the saved default but missing, so OpenCode, which stands in, is the last one that works.
    const last = onDisk({ defaultAgent: 'claude', agents: { claude: { enabled: true } } }, { claude: missing, opencode: found(O) });
    expect(() => last.a.setTicked('opencode', false)).toThrow('At least one agent must stay ticked');

    const noNode = onDisk({ defaultAgent: 'opencode', agents: { claude: { enabled: false } } }, both, { nodeBin: null });
    expect(() => noNode.a.setTicked('claude', true)).toThrow(NODE_NEEDED);

    for (const h of [notFound, savedDefault, last, noNode]) {
      expect(h.saved()).toBeNull();
      expect(h.sent).toEqual([]);
    }
  });

  it("unticking a ticked agent that isn't the default saves enabled false; ticking it back saves true", () => {
    const h = onDisk({ defaultAgent: 'claude', agents: { opencode: { enabled: true, syncModel: 'p/m' } } }, both);
    h.a.setTicked('opencode', false);
    expect(h.saved()?.agents?.opencode).toEqual({ enabled: false, syncModel: 'p/m' });
    expect(h.a.ticked()).toEqual(['claude']);
    expect(h.sent.at(-1)?.agents.opencode.ticked).toBe(false);

    h.a.setTicked('opencode', true);
    expect(h.saved()?.agents?.opencode).toEqual({ enabled: true, syncModel: 'p/m' });
    expect(h.a.ticked()).toEqual(['claude', 'opencode']);
    expect(h.sent).toHaveLength(2);
  });

  it('setDefault saves the default and runDefault follows', () => {
    const h = onDisk({ defaultAgent: 'claude', agents: { opencode: { syncModel: 'p/m' } } }, both);
    h.a.setDefault('opencode');
    expect(h.saved()).toEqual({ defaultAgent: 'opencode', agents: { opencode: { syncModel: 'p/m' } } });
    expect(h.a.defaultAgent()).toBe('opencode');
    expect(h.a.inUse().adapter).toBe(ADAPTERS.opencode);
    expect(h.sent.at(-1)).toMatchObject({ defaultAgent: 'opencode', runDefault: 'opencode' });

    const unticked = onDisk({ defaultAgent: 'claude', agents: { opencode: { enabled: false } } }, both);
    expect(() => unticked.a.setDefault('opencode')).toThrow('OpenCode must be ticked and work to be the default');
    const notFound = onDisk({ defaultAgent: 'opencode' }, { claude: missing, opencode: found(O) });
    expect(() => notFound.a.setDefault('claude')).toThrow('Claude Code must be ticked and work to be the default');
    expect(unticked.saved()).toBeNull();
    expect(notFound.saved()).toBeNull();
  });

  it('find saves the path of a file that works and its new check, and leaves a bad file unsaved', async () => {
    const h = onDisk({ defaultAgent: 'claude', agents: { opencode: { syncModel: 'p/m' } } }, both);
    await expect(h.a.find('claude', '/old/claude')).rejects.toThrow('/old/claude is v2.0.1');
    await expect(h.a.find('claude', '/nowhere/claude')).rejects.toThrow("/nowhere/claude isn't a program Mainframe can run");
    expect(h.saved()).toBeNull();
    expect(h.a.bin('claude')).toBe(C);

    await h.a.find('claude', '/new/claude');
    expect(h.saved()?.agents).toEqual({ claude: { bin: '/new/claude' }, opencode: { syncModel: 'p/m' } });
    expect(h.a.bin('claude')).toBe('/new/claude');
    expect(h.sent.at(-1)?.agents.claude.check).toEqual({ state: 'found', path: '/new/claude', version: '2.1.319' });

    // While its env var names it, the new check is used but no path is saved.
    const env = onDisk({ defaultAgent: 'claude' }, both, { envBins: { claude: C } });
    await env.a.find('claude', '/new/claude');
    expect(env.a.bin('claude')).toBe('/new/claude');
    expect(env.saved()?.agents?.claude?.bin).toBeUndefined();
  });

  it('view lists both agents with their checks, ticks and options', () => {
    const settings: AppSettings = {
      defaultAgent: 'claude',
      agents: { claude: { enabled: true, bin: C }, opencode: { enabled: true, managerAgent: 'plan', syncModel: 'p/m' } },
    };
    const a = new AgentsInUse({ dataDir: '/data', settings, checks: { claude: missing, opencode: found(O) }, envBins: { opencode: O }, ...deps, onChange: () => {} });
    expect(a.view()).toEqual({
      agents: {
        claude: { check: missing, fromEnv: false, ticked: true },
        opencode: { check: found(O), fromEnv: true, ticked: true, managerAgent: 'plan', syncModel: 'p/m' },
      },
      defaultAgent: 'claude',
      runDefault: 'opencode',
    });
  });

  it('saveAgentSetting with null deletes the key, and a saved syncModel survives tick and default changes', () => {
    const h = onDisk({ defaultAgent: 'claude', agents: { opencode: { managerAgent: 'plan' } } }, both);
    h.a.saveAgentSetting('opencode', { syncModel: 'p/m' });
    h.a.saveAgentSetting('opencode', { managerAgent: null });
    expect(h.saved()?.agents?.opencode).toEqual({ syncModel: 'p/m' });
    h.a.setDefault('opencode');
    h.a.setTicked('claude', false);
    expect(h.saved()?.agents?.opencode).toEqual({ syncModel: 'p/m' });
    expect(h.sent).toHaveLength(4);
  });

  it('opencodeChoices keeps no secrets', async () => {
    // The fixtures of opencode.test.ts and opencodeSync.test.ts, each with its secret.
    const agentList = JSON.stringify({
      data: [
        { id: 'build', mode: 'primary', hidden: false, request: { headers: { Authorization: 'Bearer SECRET-1' } } },
        { id: 'plan', mode: 'all', hidden: false },
        { id: 'general', mode: 'subagent', hidden: false },
        { id: 'title', mode: 'primary', hidden: true },
      ],
    });
    const cost = (input: number, output: number) => ({ input, output, cache: { read: 0, write: 0 } });
    const modelList = JSON.stringify({
      data: [
        { id: 'dear', providerID: 'prov', name: 'Model dear', status: 'active', enabled: true, cost: [cost(2.4, 12)] },
        {
          id: 'cheap', providerID: 'prov', name: 'Model cheap', status: 'beta', cost: [cost(0.11, 0.55)],
          settings: { apiKey: 'sk-SECRET-2' }, headers: { Authorization: 'Bearer sk-SECRET-2' },
        },
        { id: 'unknown', providerID: 'prov', name: 'Model unknown', status: 'active', cost: [] },
      ],
    });
    const run = vi.fn(async (argv: string[], _o: { cwd: string; env: Record<string, string> }) =>
      argv.includes('agent.list') ? agentList : modelList,
    );
    const h = onDisk({ defaultAgent: 'claude' }, both, { runOpencode: run });
    const lists = join(h.dataDir, 'opencode-lists');

    const choices = await h.a.opencodeChoices();

    expect(choices).toEqual({
      agents: [
        { id: 'build', isDefault: true },
        { id: 'plan', isDefault: false },
      ],
      models: [
        { id: 'prov/cheap', name: 'Model cheap', status: 'beta', price: { input: 0.11, output: 0.55 } },
        { id: 'prov/dear', name: 'Model dear', status: 'active', price: { input: 2.4, output: 12 } },
        { id: 'prov/unknown', name: 'Model unknown', status: 'active', price: null },
      ],
    });
    const json = JSON.stringify(choices);
    expect(json).not.toContain('SECRET-1');
    expect(json).not.toContain('sk-SECRET-2');
    // Both run OpenCode's binary in the lists' own folder, with the same environment but for PWD: the project's config
    // is off for the agents as it is for the models.
    expect(run).toHaveBeenCalledTimes(2);
    const envs = run.mock.calls.map(([argv, o]) => {
      expect(argv[0]).toBe(O);
      expect(o.cwd.startsWith(lists)).toBe(true);
      return { ...o.env, PWD: undefined };
    });
    expect(envs[0]).toEqual(envs[1]);
    expect(envs[0]).toMatchObject({ HOME: '/h' });
    expect(h.saved()).toBeNull();
  });
});
