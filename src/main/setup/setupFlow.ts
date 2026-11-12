import { AGENT_ORDER, type AgentChoice, type AgentName, type ProgramCheck, type SetupView } from '../../shared/types';
import type { ExecutableLookup } from '../pty/findExecutable';
import { hasProjectsFile, rememberedProjects } from '../projects';
import { ADAPTERS } from '../agents/adapters';
import type { AgentSetting } from '../agents/agent';
import { runDefault } from './agentChoice';
import { checkGit, type VersionRunner } from './programChecks';
import { readSettings, writeSettings, type AppSettings } from './settings';

export interface SetupDeps {
  dataDir: string;
  /** MAINFRAME_CLAUDE_BIN and MAINFRAME_OPENCODE_BIN: each is the only place looked for its agent, and nothing is saved about it. */
  envBins: Partial<Record<AgentName, string>>;
  lookup: ExecutableLookup;
  run: VersionRunner;
  /** Asks for the agent's program file; undefined when the user cancels. */
  pickAgent(name: AgentName): Promise<string | undefined>;
  /** Asks for a project folder; undefined when the user cancels. */
  pickFolder(): Promise<string | undefined>;
  /** The setup screen to show, or null when it is to go. */
  onChange(view: SetupView | null): void;
  /** Starts Mainframe on these projects with what was found, and settles once they have answered. */
  start(found: { settings: AppSettings; checks: Record<AgentName, ProgramCheck> }, projectDirs: string[]): Promise<void>;
  warn(msg: string): void;
}

type Checks = Record<AgentName, ProgramCheck>;

/**
 * Decides at start whether Mainframe can open the board without a word or needs the setup screen,
 * and what each answer on that screen does. It knows nothing of Electron: `start`, the dialogs and
 * the screen are handed to it.
 */
export class SetupFlow {
  private settings: AppSettings = {};
  /** No projects remembered and no welcome seen. Any other start is a later one. */
  private firstStart = false;
  private lookedAgain = false;
  // Nothing has been looked at before `begin`, so its first pass runs every check.
  private git: ProgramCheck = { state: 'missing' };
  private agents: Checks = { claude: { state: 'missing' }, opencode: { state: 'missing' } };
  private current: SetupView | null = null;
  /** The action in progress, so a second click while it waits on a dialog or a check starts nothing new. */
  private pending: Promise<void> | null = null;
  private started = false;

  constructor(private readonly deps: SetupDeps) {}

  /** Null while no screen is needed: before this settles, and once the projects have started. */
  view(): SetupView | null {
    return this.current;
  }

  /** With everything found at a later start, the projects have started when this settles, and no view was published. */
  begin(): Promise<void> {
    return this.once(async () => {
      this.settings = readSettings(this.deps.dataDir, this.deps.warn);
      this.firstStart = !hasProjectsFile(this.deps.dataDir) && !this.settings.welcomeSeen;
      await this.recheck();
      await this.proceed();
    });
  }

  lookAgain(): Promise<void> {
    return this.once(async () => {
      await this.recheck();
      this.lookedAgain = this.ready() === null;
      await this.proceed();
    });
  }

  /** Not offered while the agent's env var names it: that path wins, and nothing is saved. */
  findAgent(name: AgentName): Promise<void> {
    return this.once(async () => {
      if (this.deps.envBins[name]) return;
      const picked = await this.deps.pickAgent(name);
      if (picked === undefined) return;
      this.agents = { ...this.agents, [name]: await ADAPTERS[name].check(picked, this.deps.run, this.deps.lookup.files) };
      this.rememberBins([name]);
      await this.proceed();
    });
  }

  /** The welcome counts as seen only here, so quitting before a project is chosen shows it again. */
  chooseProject(choice: AgentChoice): Promise<void> {
    return this.once(async () => {
      if (this.ready() === null) return;
      const found = AGENT_ORDER.filter((name) => this.agents[name].state === 'found');
      if (choice.ticked.length === 0 || !choice.ticked.every((name) => found.includes(name)) || !choice.ticked.includes(choice.defaultAgent)) {
        throw new Error("That choice of agents can't be used");
      }
      const dir = await this.deps.pickFolder();
      if (dir === undefined) return;
      const bins = this.foundBins(found);
      const agents = Object.fromEntries(found.map((name) => [name, { enabled: choice.ticked.includes(name), ...bins[name] }]));
      this.save({ welcomeSeen: true, defaultAgent: choice.defaultAgent, agents });
      await this.startProjects([dir]);
      this.publish(null);
    });
  }

  /**
   * One action at a time: a call made while another is pending gets that one's promise, so no second
   * dialog, check or start. Once the projects have started there is nothing left to do.
   */
  private once(action: () => Promise<void>): Promise<void> {
    if (this.pending) return this.pending;
    if (this.started) return Promise.resolve();
    this.pending = action().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async startProjects(projectDirs: string[]): Promise<void> {
    // Set before `start` runs and kept when it fails: a failed start is final. Main shows "Mainframe
    // could not start" and ends the app, so no further action follows.
    this.started = true;
    await this.deps.start({ settings: this.settings, checks: this.agents }, projectDirs);
  }

  /**
   * Looks again at what is not found. A failing agent is tried at its own path first, since a file
   * picked by hand may have been updated, and then at the saved one, which may have failed only for a moment.
   */
  private async recheck(): Promise<void> {
    const { envBins, lookup, run } = this.deps;
    const look = (name: AgentName): ProgramCheck | Promise<ProgramCheck> => {
      const check = this.agents[name];
      if (check.state === 'found') return check;
      const saved = [check.path, this.settings.agents?.[name]?.bin].filter((path) => path !== undefined);
      return ADAPTERS[name].find({ fromEnv: envBins[name], saved, lookup, run });
    };
    const [git, agents] = await Promise.all([
      this.git.state === 'found' ? this.git : checkGit(lookup, run),
      Promise.all(AGENT_ORDER.map(look)),
    ]);
    this.git = git;
    this.agents = Object.fromEntries(AGENT_ORDER.map((name, i) => [name, agents[i]])) as Checks;
  }

  /** The agent to run by default, once git works and so does a ticked agent. */
  private ready(): ReturnType<typeof runDefault> {
    return this.git.state === 'found' ? runDefault(this.settings, this.agents) : null;
  }

  private async proceed(): Promise<void> {
    const run = this.ready();
    if (run === null) {
      this.show(null);
    } else if (this.firstStart) {
      this.show({ ticked: AGENT_ORDER.filter((name) => this.agents[name].state === 'found'), defaultAgent: run.agent });
    } else {
      this.rememberBins(AGENT_ORDER);
      await this.startProjects(rememberedProjects(this.deps.dataDir, this.deps.warn));
      if (this.current !== null) this.publish(null);
    }
  }

  /** The paths to save of the found agents among `names`: none for an agent its env var names. */
  private foundBins(names: readonly AgentName[]): Partial<Record<AgentName, AgentSetting>> {
    const bins: Partial<Record<AgentName, AgentSetting>> = {};
    for (const name of names) {
      const check = this.agents[name];
      if (check.state === 'found' && !this.deps.envBins[name]) bins[name] = { bin: check.path };
    }
    return bins;
  }

  /** Saves the paths of the found agents among `names`, when one differs from the saved one. */
  private rememberBins(names: readonly AgentName[]): void {
    const bins = this.foundBins(names);
    if (AGENT_ORDER.some((name) => bins[name] !== undefined && bins[name].bin !== this.settings.agents?.[name]?.bin)) this.save({ agents: bins });
  }

  /** Each agent in the patch is merged into its saved entry. */
  private save(patch: AppSettings): void {
    const agents = { ...this.settings.agents };
    for (const name of AGENT_ORDER) if (patch.agents?.[name]) agents[name] = { ...agents[name], ...patch.agents[name] };
    this.settings = { ...this.settings, ...patch, ...(patch.agents && { agents }) };
    writeSettings(this.deps.dataDir, this.settings);
  }

  private show(ask: AgentChoice | null): void {
    const agentView = (name: AgentName) => ({ check: this.agents[name], fromEnv: Boolean(this.deps.envBins[name]) });
    this.publish({
      intro: this.firstStart ? 'welcome' : 'moved',
      git: this.git,
      agents: { claude: agentView('claude'), opencode: agentView('opencode') },
      // The hint is for what is still missing; an agent picked by hand since may have fixed it.
      lookedAgain: this.lookedAgain && ask === null,
      ask,
    });
  }

  private publish(view: SetupView | null): void {
    this.current = view;
    this.deps.onChange(view);
  }
}
