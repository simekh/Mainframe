import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChoice, AgentName, ProgramCheck, SetupView } from '../../shared/types';
import { writeOpenProjects } from '../projects';
import { tickedAgents } from './agentChoice';
import type { VersionRunner } from './programChecks';
import { readSettings, writeSettings, type AppSettings } from './settings';
import { SetupFlow } from './setupFlow';

const GIT = '/usr/bin/git';
const NATIVE = '/Users/x/.local/bin/claude';
const PICKED = '/picked/claude';
const CURRENT = '2.1.319 (Claude Code)\n';
const OLD = '2.1.100 (Claude Code)\n';

const OC = '/Users/x/.opencode/bin/opencode';
const OC_CURRENT = 'opencode v2.2.7\n';

const foundGit: ProgramCheck = { state: 'found', path: GIT, version: '2.56.0' };
const foundClaude = (path = NATIVE): ProgramCheck => ({ state: 'found', path, version: '2.1.319' });
const foundOpencode = (path = OC): ProgramCheck => ({ state: 'found', path, version: '2.2.7' });
/** The question at a first start with only Claude Code found. */
const CLAUDE_ONLY: AgentChoice = { ticked: ['claude'], defaultAgent: 'claude' };
const OPENCODE_ONLY: AgentChoice = { ticked: ['opencode'], defaultAgent: 'opencode' };
/** With nothing saved an agent is ticked when it is found; `ticked` says otherwise. */
const expectedView = (
  o: Partial<Omit<SetupView, 'agents'>> & {
    claude?: ProgramCheck;
    claudeFromEnv?: boolean;
    opencode?: ProgramCheck;
    ticked?: Partial<Record<AgentName, boolean>>;
  } = {},
): SetupView => {
  const { claude = foundClaude(), claudeFromEnv = false, opencode = { state: 'missing' }, ticked = {}, ...rest } = o;
  return {
    intro: 'welcome',
    git: foundGit,
    agents: {
      claude: { check: claude, fromEnv: claudeFromEnv, ticked: ticked.claude ?? claude.state === 'found' },
      opencode: { check: opencode, fromEnv: false, ticked: ticked.opencode ?? opencode.state === 'found' },
    },
    lookedAgain: false,
    ask: null,
    ...rest,
  };
};
/** What `start` is handed when it runs on this claude. */
const startedOn = (claude: string) =>
  expect.objectContaining({ checks: expect.objectContaining({ claude: expect.objectContaining({ state: 'found', path: claude }) }) });

let root: string;
let dataDir: string;
let acme: string;
let globex: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mainframe-setup-flow-'));
  dataDir = join(root, 'data');
  acme = join(root, 'acme');
  globex = join(root, 'globex');
  for (const dir of [dataDir, acme, globex]) mkdirSync(dir);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const settingsFile = () => join(dataDir, 'settings.json');
const settings = () => readSettings(dataDir, () => {});

/**
 * A computer with git and the native claude on it. `programs` maps each program that exists to what it
 * prints for `--version`; change it between calls to install or fix one. The platform is passed in, so
 * this runs the same on every system.
 */
function harness(o: { envClaudeBin?: string; envOpencodeBin?: string; programs?: Record<string, string>; nodeBin?: string | null } = {}) {
  const programs: Record<string, string> = o.programs ?? { [GIT]: 'git version 2.56.0\n', [NATIVE]: CURRENT };
  const picks: { claude?: string; opencode?: string; folder?: string } = {};
  const ran: string[] = [];
  const events: string[] = [];
  const views: (SetupView | null)[] = [];
  const run: VersionRunner = async (file) => {
    ran.push(file);
    return programs[file] ?? null;
  };
  const start = vi.fn(async (_found: { settings: AppSettings; checks: Record<AgentName, ProgramCheck> }, _projectDirs: string[]) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push('start finished');
  });
  const pickAgent = vi.fn(async (name: AgentName) => picks[name]);
  const pickFolder = vi.fn(async () => picks.folder);
  const flow = new SetupFlow({
    dataDir,
    envBins: { claude: o.envClaudeBin, opencode: o.envOpencodeBin },
    lookup: {
      env: { PATH: '/usr/bin', HOME: '/Users/x' },
      cwd: '/repo',
      platform: 'darwin',
      files: { isExecutableFile: (path) => path in programs },
    },
    run,
    nodeBin: o.nodeBin === undefined ? '/usr/bin/node' : o.nodeBin,
    pickAgent,
    pickFolder,
    onChange: (view) => {
      views.push(view);
      events.push(view === null ? 'view cleared' : 'view shown');
    },
    start,
    warn: () => {},
  });
  return { flow, programs, picks, ran, events, views, start, pickAgent, pickFolder };
}

/** An install that has run Mainframe before: its projects are remembered. */
const existingInstall = () => writeOpenProjects(dataDir, [acme, globex]);

describe('first start (no projects.json, no welcomeSeen)', () => {
  it('shows the welcome and asks for a project when everything is found, and starts nothing', async () => {
    const h = harness();
    expect(h.flow.view()).toBeNull();
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ ask: CLAUDE_ONLY }));
    expect(h.views).toHaveLength(1);
    expect(h.start).not.toHaveBeenCalled();
    expect(existsSync(settingsFile())).toBe(false);
  });

  it('shows what is missing when git is not found', async () => {
    const h = harness({ programs: { [NATIVE]: CURRENT } });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ git: { state: 'missing' }, ask: null }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('chooseProject writes the settings, starts the project, and only then clears the view', async () => {
    const h = harness();
    await h.flow.begin();
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(settings()).toStrictEqual({ agents: { claude: { enabled: true, bin: NATIVE } }, defaultAgent: 'claude', welcomeSeen: true });
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme]);
    expect(h.events).toEqual(['view shown', 'start finished', 'view cleared']);
    expect(h.flow.view()).toBeNull();
  });

  it('chooseProject leaves everything as it is when the folder dialog is cancelled', async () => {
    const h = harness();
    await h.flow.begin();
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.pickFolder).toHaveBeenCalledOnce();
    expect(existsSync(settingsFile())).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.views).toHaveLength(1);
    expect(h.flow.view()).toEqual(expectedView({ ask: CLAUDE_ONLY }));
  });

  it('chooseProject does nothing, and asks nothing, while a check is still failing', async () => {
    const h = harness({ programs: { [NATIVE]: CURRENT } });
    await h.flow.begin();
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.pickFolder).not.toHaveBeenCalled();
    expect(existsSync(settingsFile())).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('quitting before a project is chosen leaves nothing behind, so the welcome shows again', async () => {
    const first = harness();
    await first.flow.begin();
    expect(existsSync(settingsFile())).toBe(false);
    const second = harness();
    await second.flow.begin();
    expect(second.flow.view()).toEqual(expectedView({ ask: CLAUDE_ONLY }));
  });

  it('takes a claude from the native folder it finds when the saved path is gone, and saves it with the project', async () => {
    writeSettings(dataDir, { agents: { claude: { bin: '/gone/claude' } } });
    const h = harness();
    await h.flow.begin();
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(settings()).toStrictEqual({ agents: { claude: { enabled: true, bin: NATIVE } }, defaultAgent: 'claude', welcomeSeen: true });
  });
});

describe('a later start', () => {
  it('starts the remembered projects, silently, and has done so by the time begin resolves', async () => {
    existingInstall();
    const h = harness();
    await h.flow.begin();
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme, globex]);
    expect(h.events).toEqual(['start finished']);
    expect(h.flow.view()).toBeNull();
    expect(h.views).toEqual([]);
  });

  it('saves the claude path it found, and not that the welcome was seen', async () => {
    existingInstall();
    await harness().flow.begin();
    expect(settings()).toStrictEqual({ agents: { claude: { bin: NATIVE } } });
  });

  it('does not rewrite settings that already hold the claude path', async () => {
    existingInstall();
    const text = JSON.stringify({ version: 2, agents: { claude: { bin: NATIVE } }, welcomeSeen: true });
    writeFileSync(settingsFile(), text);
    await harness().flow.begin();
    expect(readFileSync(settingsFile(), 'utf8')).toBe(text);
  });

  it('counts a seen welcome with no projects.json as a later start, and starts with no project', async () => {
    writeSettings(dataDir, { agents: { claude: { bin: NATIVE } }, welcomeSeen: true });
    const h = harness();
    await h.flow.begin();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), []);
    expect(h.views).toEqual([]);
  });

  it('leaves out a remembered folder that has gone', async () => {
    writeOpenProjects(dataDir, [join(root, 'gone'), acme]);
    const h = harness();
    await h.flow.begin();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme]);
  });

  it('with the saved claude gone but one in the native folder, starts with that one, saves it, and shows nothing', async () => {
    existingInstall();
    writeSettings(dataDir, { agents: { claude: { bin: '/gone/claude' } }, welcomeSeen: true });
    const h = harness();
    await h.flow.begin();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme, globex]);
    expect(settings()).toStrictEqual({ agents: { claude: { bin: NATIVE } }, welcomeSeen: true });
    expect(h.views).toEqual([]);
  });

  it('with claude missing, says something moved, before anything starts', async () => {
    existingInstall();
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n' } });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ intro: 'moved', claude: { state: 'missing' } }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('with git missing, says something moved', async () => {
    existingInstall();
    const h = harness({ programs: { [NATIVE]: CURRENT } });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ intro: 'moved', git: { state: 'missing' } }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('with only an old claude, says so, with its version', async () => {
    existingInstall();
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [NATIVE]: OLD } });
    await h.flow.begin();
    expect(h.flow.view()?.agents.claude.check).toEqual({ state: 'too-old', path: NATIVE, version: '2.1.100' });
  });

  it('refuses settings from a newer Mainframe, and starts nothing', async () => {
    existingInstall();
    writeFileSync(settingsFile(), JSON.stringify({ version: 3 }));
    const h = harness();
    await expect(h.flow.begin()).rejects.toThrow('newer Mainframe');
    expect(h.start).not.toHaveBeenCalled();
  });
});

describe('with MAINFRAME_CLAUDE_BIN set', () => {
  const ENV = '/env/claude';
  const envPrograms = { [GIT]: 'git version 2.56.0\n', [ENV]: CURRENT, '/saved/claude': CURRENT, [NATIVE]: CURRENT };

  it('checks only that path, starts with it, and leaves a saved path as it was', async () => {
    existingInstall();
    writeSettings(dataDir, { agents: { claude: { bin: '/saved/claude' } }, welcomeSeen: true });
    const h = harness({ envClaudeBin: ENV, programs: envPrograms });
    await h.flow.begin();
    expect(h.ran.filter((file) => file !== GIT)).toEqual([ENV]);
    expect(h.start).toHaveBeenCalledWith(startedOn(ENV), [acme, globex]);
    expect(settings()).toStrictEqual({ agents: { claude: { bin: '/saved/claude' } }, welcomeSeen: true });
    expect(h.views).toEqual([]);
  });

  it('writes no claude path at first start either, and keeps a saved one as it was', async () => {
    writeSettings(dataDir, { agents: { claude: { bin: '/saved/claude' } } });
    const h = harness({ envClaudeBin: ENV, programs: envPrograms });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ claude: foundClaude(ENV), claudeFromEnv: true, ask: CLAUDE_ONLY }));
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.start).toHaveBeenCalledWith(startedOn(ENV), [acme]);
    expect(settings()).toStrictEqual({ agents: { claude: { enabled: true, bin: '/saved/claude' } }, defaultAgent: 'claude', welcomeSeen: true });
  });

  it('records only that the welcome was seen when nothing was saved', async () => {
    const h = harness({ envClaudeBin: ENV, programs: envPrograms });
    await h.flow.begin();
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(settings()).toStrictEqual({ welcomeSeen: true, defaultAgent: 'claude', agents: { claude: { enabled: true } } });
  });

  it('when that path is no good, says so with its path, and does not fall back to another claude', async () => {
    existingInstall();
    const h = harness({ envClaudeBin: '/nowhere/claude', programs: envPrograms });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(
      expectedView({ intro: 'moved', claude: { state: 'missing', path: '/nowhere/claude' }, claudeFromEnv: true }),
    );
    expect(h.start).not.toHaveBeenCalled();
  });

  it('does not offer to find claude by hand', async () => {
    const h = harness({ envClaudeBin: '/nowhere/claude', programs: envPrograms });
    await h.flow.begin();
    h.picks.claude = NATIVE;
    await h.flow.findAgent('claude');
    expect(h.pickAgent).not.toHaveBeenCalled();
    expect(h.flow.view()?.agents.claude.check).toEqual({ state: 'missing', path: '/nowhere/claude' });
    expect(existsSync(settingsFile())).toBe(false);
  });
});

describe('lookAgain', () => {
  it('says it has looked again, and shows the checks again, when one is still failing', async () => {
    existingInstall();
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n' } });
    await h.flow.begin();
    expect(h.flow.view()?.lookedAgain).toBe(false);
    await h.flow.lookAgain();
    expect(h.flow.view()).toEqual(expectedView({ intro: 'moved', claude: { state: 'missing' }, lookedAgain: true }));
    expect(h.views).toHaveLength(2);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('looks again only at what is failing', async () => {
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n' } });
    await h.flow.begin();
    h.ran.length = 0;
    await h.flow.lookAgain();
    expect(h.ran).toEqual([]);
  });

  it('on a later start, starts the projects once what was failing is fixed, and clears the view', async () => {
    existingInstall();
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n' } });
    await h.flow.begin();
    h.programs[NATIVE] = CURRENT;
    await h.flow.lookAgain();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme, globex]);
    expect(settings()).toStrictEqual({ agents: { claude: { bin: NATIVE } } });
    expect(h.events).toEqual(['view shown', 'start finished', 'view cleared']);
    expect(h.flow.view()).toBeNull();
  });

  it('at first start, asks for a project once what was failing is fixed', async () => {
    const h = harness({ programs: { [NATIVE]: CURRENT } });
    await h.flow.begin();
    h.programs[GIT] = 'git version 2.56.0\n';
    await h.flow.lookAgain();
    expect(h.flow.view()).toEqual(expectedView({ ask: CLAUDE_ONLY }));
    expect(h.start).not.toHaveBeenCalled();
    expect(existsSync(settingsFile())).toBe(false);
  });

  it('still looks at a claude the user picked that was too old, once they have updated it', async () => {
    existingInstall();
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [PICKED]: OLD } });
    await h.flow.begin();
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(h.flow.view()?.agents.claude.check).toEqual({ state: 'too-old', path: PICKED, version: '2.1.100' });
    h.programs[PICKED] = CURRENT;
    await h.flow.lookAgain();
    expect(h.start).toHaveBeenCalledWith(startedOn(PICKED), [acme, globex]);
  });

  it('tries the saved claude again after a claude picked by hand has failed', async () => {
    const SAVED = '/saved/claude';
    writeSettings(dataDir, { agents: { claude: { bin: SAVED } } });
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [SAVED]: 'hello\n' } });
    await h.flow.begin();
    expect(h.flow.view()?.agents.claude.check).toEqual({ state: 'broken', path: SAVED });
    h.programs[PICKED] = 'hello\n';
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(h.flow.view()?.agents.claude.check).toEqual({ state: 'broken', path: PICKED });
    h.programs[SAVED] = CURRENT;
    await h.flow.lookAgain();
    expect(h.flow.view()?.agents.claude.check).toEqual(foundClaude(SAVED));
  });
});

describe('findClaude', () => {
  const gitOnly = { [GIT]: 'git version 2.56.0\n' };

  it('on a later start, a file that works is saved and the projects start, as after lookAgain', async () => {
    existingInstall();
    const h = harness({ programs: { ...gitOnly, [PICKED]: CURRENT } });
    await h.flow.begin();
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(settings()).toStrictEqual({ agents: { claude: { bin: PICKED } } });
    expect(h.start).toHaveBeenCalledWith(startedOn(PICKED), [acme, globex]);
    expect(h.events).toEqual(['view shown', 'start finished', 'view cleared']);
    expect(h.flow.view()).toBeNull();
  });

  it('at first start, a file that works is saved and the project question comes next', async () => {
    const h = harness({ programs: { ...gitOnly, [PICKED]: CURRENT } });
    await h.flow.begin();
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(settings()).toStrictEqual({ agents: { claude: { bin: PICKED } } });
    expect(h.flow.view()).toEqual(expectedView({ claude: foundClaude(PICKED), ask: CLAUDE_ONLY }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('a file that works, after looking again found nothing, drops the new-terminal hint along with the problem', async () => {
    const h = harness({ programs: gitOnly });
    await h.flow.begin();
    await h.flow.lookAgain();
    expect(h.flow.view()?.lookedAgain).toBe(true);
    h.programs[PICKED] = CURRENT;
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(h.flow.view()).toEqual(expectedView({ claude: foundClaude(PICKED), ask: CLAUDE_ONLY, lookedAgain: false }));
  });

  it('a file that works is shown, and saved, while git is still missing', async () => {
    const h = harness({ programs: { [PICKED]: CURRENT } });
    await h.flow.begin();
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(settings()).toStrictEqual({ agents: { claude: { bin: PICKED } } });
    expect(h.flow.view()).toEqual(expectedView({ git: { state: 'missing' }, claude: foundClaude(PICKED), ask: null }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('a file that is too old is shown as too old, with its version, and not saved', async () => {
    existingInstall();
    const h = harness({ programs: { ...gitOnly, [PICKED]: OLD } });
    await h.flow.begin();
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(h.flow.view()).toEqual(
      expectedView({ intro: 'moved', claude: { state: 'too-old', path: PICKED, version: '2.1.100' } }),
    );
    expect(existsSync(settingsFile())).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('a file that is not claude is shown as broken, with its path', async () => {
    const h = harness({ programs: { ...gitOnly, [PICKED]: 'hello\n' } });
    await h.flow.begin();
    h.picks.claude = PICKED;
    await h.flow.findAgent('claude');
    expect(h.flow.view()?.agents.claude.check).toEqual({ state: 'broken', path: PICKED });
    expect(existsSync(settingsFile())).toBe(false);
  });

  it('changes nothing when the file dialog is cancelled', async () => {
    const h = harness({ programs: gitOnly });
    await h.flow.begin();
    const before = h.flow.view();
    await h.flow.findAgent('claude');
    expect(h.pickAgent).toHaveBeenCalledOnce();
    expect(h.flow.view()).toBe(before);
    expect(h.views).toHaveLength(1);
    expect(existsSync(settingsFile())).toBe(false);
  });
});

describe('one action at a time', () => {
  const gitOnly = { [GIT]: 'git version 2.56.0\n' };

  it('a second lookAgain while the first is pending gets the first, and the projects start once', async () => {
    existingInstall();
    const h = harness({ programs: gitOnly });
    await h.flow.begin();
    h.programs[NATIVE] = CURRENT;
    const first = h.flow.lookAgain();
    const second = h.flow.lookAgain();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.ran.filter((file) => file === NATIVE)).toHaveLength(1);
  });

  it('another action while one is pending gets that one, and asks nothing', async () => {
    existingInstall();
    const h = harness({ programs: gitOnly });
    await h.flow.begin();
    h.programs[NATIVE] = CURRENT;
    h.picks.claude = PICKED;
    h.picks.folder = globex;
    const first = h.flow.lookAgain();
    await Promise.all([first, h.flow.findAgent('claude'), h.flow.chooseProject(CLAUDE_ONLY)]);
    expect(h.pickAgent).not.toHaveBeenCalled();
    expect(h.pickFolder).not.toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme, globex]);
  });

  it('a second chooseProject while the first is pending asks for a folder and starts once', async () => {
    const h = harness();
    await h.flow.begin();
    h.picks.folder = acme;
    const first = h.flow.chooseProject(CLAUDE_ONLY);
    const second = h.flow.chooseProject(CLAUDE_ONLY);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(h.pickFolder).toHaveBeenCalledOnce();
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme]);
  });

  it('after chooseProject has started the project, every action does nothing', async () => {
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [NATIVE]: CURRENT, [PICKED]: CURRENT } });
    await h.flow.begin();
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    h.ran.length = 0;
    h.picks.claude = PICKED;
    h.picks.folder = globex;
    await h.flow.lookAgain();
    await h.flow.findAgent('claude');
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.pickAgent).not.toHaveBeenCalled();
    expect(h.pickFolder).toHaveBeenCalledOnce();
    expect(h.ran).toEqual([]);
    expect(h.start).toHaveBeenCalledOnce();
    expect(settings()).toStrictEqual({ agents: { claude: { enabled: true, bin: NATIVE } }, defaultAgent: 'claude', welcomeSeen: true });
    expect(h.flow.view()).toBeNull();
    expect(h.views).toEqual([expectedView({ ask: CLAUDE_ONLY }), null]);
  });

  it('after a silent start, every action does nothing', async () => {
    existingInstall();
    const h = harness();
    await h.flow.begin();
    h.picks.claude = PICKED;
    h.picks.folder = globex;
    await h.flow.lookAgain();
    await h.flow.findAgent('claude');
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.pickAgent).not.toHaveBeenCalled();
    expect(h.pickFolder).not.toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.views).toEqual([]);
  });

  it('after one that failed, the next action runs', async () => {
    const h = harness();
    await h.flow.begin();
    h.pickFolder.mockRejectedValueOnce(new Error('dialog failed'));
    await expect(h.flow.chooseProject(CLAUDE_ONLY)).rejects.toThrow('dialog failed');
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.start).toHaveBeenCalledWith(startedOn(NATIVE), [acme]);
  });
});

describe('the agents', () => {
  const both = { [GIT]: 'git version 2.56.0\n', [NATIVE]: CURRENT, [OC]: OC_CURRENT };

  it('an OpenCode-only first start asks with OpenCode ticked and the default', async () => {
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [OC]: OC_CURRENT } });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ claude: { state: 'missing' }, opencode: foundOpencode(), ask: OPENCODE_ONLY }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('with both found both start ticked, and Claude Code is the default', async () => {
    const h = harness({ programs: both });
    await h.flow.begin();
    expect(h.flow.view()?.ask).toEqual({ ticked: ['claude', 'opencode'], defaultAgent: 'claude' });
  });

  it('with no agent working the screen shows and nothing starts', async () => {
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n' } });
    await h.flow.begin();
    expect(h.flow.view()).toEqual(expectedView({ claude: { state: 'missing' } }));
    h.picks.folder = acme;
    await h.flow.chooseProject(CLAUDE_ONLY);
    expect(h.pickFolder).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });

  it('choosing a project saves the choice', async () => {
    const h = harness({ programs: both });
    await h.flow.begin();
    h.picks.folder = acme;
    await h.flow.chooseProject(OPENCODE_ONLY);
    const saved = { welcomeSeen: true, defaultAgent: 'opencode', agents: { claude: { enabled: false, bin: NATIVE }, opencode: { enabled: true, bin: OC } } };
    expect(settings()).toStrictEqual(saved);
    expect(h.start).toHaveBeenCalledWith({ settings: saved, checks: { claude: foundClaude(), opencode: foundOpencode() } }, [acme]);
  });

  it("a choice that can't be used is refused", async () => {
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [NATIVE]: CURRENT } });
    await h.flow.begin();
    h.picks.folder = acme;
    const choices: AgentChoice[] = [
      { ticked: [], defaultAgent: 'claude' },
      { ticked: ['claude', 'opencode'], defaultAgent: 'claude' },
      { ticked: ['claude'], defaultAgent: 'opencode' },
    ];
    for (const choice of choices) await expect(h.flow.chooseProject(choice)).rejects.toThrow("That choice of agents can't be used");
    expect(h.pickFolder).not.toHaveBeenCalled();
    expect(existsSync(settingsFile())).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('an upgrade starts at once', async () => {
    existingInstall();
    writeFileSync(settingsFile(), JSON.stringify({ version: 1, claudeBin: NATIVE, welcomeSeen: true }));
    const h = harness({ programs: both });
    await h.flow.begin();
    expect(h.views).toEqual([]);
    expect(h.start).toHaveBeenCalledOnce();
    const [found, dirs] = h.start.mock.calls[0];
    expect(dirs).toEqual([acme, globex]);
    expect(found.checks).toEqual({ claude: foundClaude(), opencode: foundOpencode() });
    expect(tickedAgents(found.settings, found.checks)).toEqual(['claude', 'opencode']);
  });

  it("an upgrade's first save writes version 2, keeping Claude Code's tick, path and default and the welcome", async () => {
    existingInstall();
    writeFileSync(settingsFile(), JSON.stringify({ version: 1, claudeBin: NATIVE, welcomeSeen: true }));
    const h = harness({ programs: both });
    await h.flow.begin();
    // OpenCode's path is new, so it is saved; nothing ticks it, so it counts as ticked only while it is found.
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8'))).toEqual({
      version: 2,
      welcomeSeen: true,
      defaultAgent: 'claude',
      agents: { claude: { enabled: true, bin: NATIVE }, opencode: { bin: OC } },
    });
  });

  it('a later start with no ticked agent working shows Something moved', async () => {
    existingInstall();
    writeSettings(dataDir, { agents: { claude: { enabled: true }, opencode: { enabled: false } }, defaultAgent: 'claude', welcomeSeen: true });
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [OC]: OC_CURRENT } });
    await h.flow.begin();
    // Claude Code is ticked though missing, OpenCode found though unticked: the screen is told both.
    expect(h.flow.view()).toEqual(
      expectedView({ intro: 'moved', claude: { state: 'missing' }, opencode: foundOpencode(), ticked: { claude: true, opencode: false } }),
    );
    expect(h.start).not.toHaveBeenCalled();
  });

  it('a later start whose only ticked agent has moved shows it as ticked, beside a found agent that is not', async () => {
    existingInstall();
    writeSettings(dataDir, {
      agents: { claude: { enabled: false, bin: NATIVE }, opencode: { enabled: true, bin: '/gone/opencode' } },
      defaultAgent: 'opencode',
      welcomeSeen: true,
    });
    const h = harness();
    await h.flow.begin();
    expect(h.flow.view()).toEqual(
      expectedView({ intro: 'moved', claude: foundClaude(), opencode: { state: 'missing' }, ticked: { claude: false, opencode: true } }),
    );
    expect(h.start).not.toHaveBeenCalled();
  });

  it('a later start whose ticked agent is gone: Use OpenCode ticks the found one, makes it the default, and starts', async () => {
    existingInstall();
    writeSettings(dataDir, { agents: { claude: { enabled: true }, opencode: { enabled: false, bin: OC } }, defaultAgent: 'claude', welcomeSeen: true });
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [OC]: OC_CURRENT } });
    await h.flow.begin();
    await h.flow.useAgent('opencode');
    const saved = { agents: { claude: { enabled: true }, opencode: { enabled: true, bin: OC } }, defaultAgent: 'opencode', welcomeSeen: true };
    expect(settings()).toStrictEqual(saved);
    expect(h.start).toHaveBeenCalledWith({ settings: saved, checks: { claude: { state: 'missing' }, opencode: foundOpencode() } }, [acme, globex]);
    expect(h.flow.view()).toBeNull();
  });

  it('Use does nothing for an agent that is not found', async () => {
    existingInstall();
    writeSettings(dataDir, { agents: { claude: { enabled: true }, opencode: { enabled: false } }, defaultAgent: 'claude', welcomeSeen: true });
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n' } });
    await h.flow.begin();
    await h.flow.useAgent('opencode');
    expect(settings().defaultAgent).toBe('claude');
    expect(h.start).not.toHaveBeenCalled();
  });

  it('a first start without node asks with Claude Code left out while another agent is found', async () => {
    const h = harness({ programs: both, nodeBin: null });
    await h.flow.begin();
    expect(h.flow.view()?.ask).toEqual(OPENCODE_ONLY);
    // With only Claude Code found it is still asked, and the start says Node is needed.
    const alone = harness({ nodeBin: null });
    await alone.flow.begin();
    expect(alone.flow.view()?.ask).toEqual(CLAUDE_ONLY);
  });

  it('MAINFRAME_OPENCODE_BIN is the only opencode looked at, and its path is not saved', async () => {
    const ENV_OC = '/env/opencode';
    const h = harness({ envOpencodeBin: ENV_OC, programs: { [GIT]: 'git version 2.56.0\n', [ENV_OC]: OC_CURRENT, [OC]: OC_CURRENT } });
    await h.flow.begin();
    expect(h.ran.filter((file) => file !== GIT)).toEqual([ENV_OC]);
    expect(h.flow.view()?.agents.opencode).toEqual({ check: foundOpencode(ENV_OC), fromEnv: true, ticked: true });
    h.picks.folder = acme;
    await h.flow.chooseProject(OPENCODE_ONLY);
    expect(settings()).toStrictEqual({ welcomeSeen: true, defaultAgent: 'opencode', agents: { opencode: { enabled: true } } });
  });

  it('Find opencode asks for an opencode file and saves it once it works', async () => {
    const PICKED_OC = '/picked/opencode';
    const h = harness({ programs: { [GIT]: 'git version 2.56.0\n', [PICKED_OC]: OC_CURRENT } });
    await h.flow.begin();
    h.picks.opencode = PICKED_OC;
    await h.flow.findAgent('opencode');
    expect(h.pickAgent).toHaveBeenCalledWith('opencode');
    expect(settings()).toStrictEqual({ agents: { opencode: { bin: PICKED_OC } } });
    expect(h.flow.view()?.ask).toEqual(OPENCODE_ONLY);
  });
});
