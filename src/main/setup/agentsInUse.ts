import { AGENT_NAMES, MIN_AGENT_VERSION, TERMINAL_TEXT_DEFAULT, TERMINAL_TEXT_LIMITS, type AgentName, type OpencodeChoices, type ProgramCheck, type SettingsView, type TerminalText } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import type { AgentInUse, AgentSetting } from '../agents/agent';
import { NODE_NEEDED } from '../agents/claude';
import { codexConfigFile, codexMissesClaudeMd } from '../agents/codexInstructions';
import { opencodeChoices, type runOpencode } from '../agents/opencode';
import type { ExecutableLookup } from '../pty/findExecutable';
import { agentStatus, runDefault, tickedAgents, usableChecks } from './agentChoice';
import type { VersionRunner } from './programChecks';
import { writeSettings, type AppSettings } from './settings';

/** A change to an agent's setting: null deletes the key. */
export type AgentSettingPatch = { [K in keyof AgentSetting]?: AgentSetting[K] | null };

/** In range and on a step from the minimum; float steps compare with a tolerance. */
function inLimits(value: number, { min, max, step }: { min: number; max: number; step: number }): boolean {
  const steps = (value - min) / step;
  return value >= min && value <= max && Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** Why a file picked by hand can't be used. */
function whyNot(name: AgentName, path: string, check: ProgramCheck): string {
  if (check.state === 'too-old') return `${path} is v${check.version}, and Mainframe needs v${MIN_AGENT_VERSION[name]} or newer`;
  if (check.state === 'broken') return `${path} is there, but it didn't tell its version`;
  return `${path} isn't a program Mainframe can run`;
}

/**
 * Which agents this run of Mainframe uses and from which path. One object, made at start and shared by every open
 * project: a change here reaches each project's next task, manager start and sync alike. After start it alone writes
 * settings.json, and each change it saves is sent to the page (`onChange`).
 */
export class AgentsInUse {
  constructor(
    private readonly deps: {
      dataDir: string;
      settings: AppSettings;
      checks: Record<AgentName, ProgramCheck>;
      /** The agents MAINFRAME_CLAUDE_BIN, MAINFRAME_OPENCODE_BIN and MAINFRAME_CODEX_BIN name: nothing is saved about those. */
      envBins: Partial<Record<AgentName, string>>;
      run: VersionRunner;
      lookup: ExecutableLookup;
      /** Null when no node was found: Claude Code can't then be ticked. */
      nodeBin: string | null;
      /** The environment the agents' runs get. */
      env: Record<string, string>;
      onChange(view: SettingsView): void;
      /** Runs OpenCode's listing commands; tests hand it a fake. */
      runOpencode?: typeof runOpencode;
      /** Asks Codex what it would load for a project; tests hand it a fake. */
      codexMissesClaudeMd?: typeof codexMissesClaudeMd;
    },
  ) {
    // The setup starts the projects only once a ticked agent is found; one that needs node may still not run.
    if (this.current() === null) {
      throw new Error(runDefault(deps.settings, deps.checks) === null ? 'Mainframe found no coding agent it can run' : NODE_NEEDED);
    }
  }

  /** The checks this run goes by: an agent that needs node doesn't work without it, though Settings shows it found. */
  private usable(): Record<AgentName, ProgramCheck> {
    return usableChecks(this.deps.checks, this.deps.nodeBin);
  }

  /** Never null after the constructor: no change leaves no ticked agent that works. */
  private current(): AgentName | null {
    return runDefault(this.deps.settings, this.usable());
  }

  /** The default this run uses: `runDefault`'s agent. */
  defaultAgent(): AgentName {
    return this.current()!;
  }

  /** Ticked and working, in AGENT_ORDER. */
  ticked(): AgentName[] {
    const usable = this.usable();
    return tickedAgents(this.deps.settings, usable).filter((name) => usable[name].state === 'found');
  }

  /** The path of a found agent, ticked or not; null when it isn't found. */
  bin(name: AgentName): string | null {
    const check = this.deps.checks[name];
    return check.state === 'found' ? check.path : null;
  }

  /** The default agent with its adapter, path and setting. */
  inUse(): AgentInUse {
    const agent = this.defaultAgent();
    return { adapter: ADAPTERS[agent], bin: this.bin(agent)!, setting: this.deps.settings.agents?.[agent] ?? {} };
  }

  view(): SettingsView {
    const { settings, checks, envBins } = this.deps;
    const status = agentStatus(settings, checks, envBins);
    const agentView = (name: AgentName) => {
      const { managerAgent, syncModel } = settings.agents?.[name] ?? {};
      return { ...status[name], ...(managerAgent !== undefined && { managerAgent }), ...(syncModel !== undefined && { syncModel }) };
    };
    const inUse = this.defaultAgent();
    return { agents: { claude: agentView('claude'), opencode: agentView('opencode'), codex: agentView('codex') }, defaultAgent: settings.defaultAgent ?? inUse, runDefault: inUse, terminalText: settings.terminalText ?? TERMINAL_TEXT_DEFAULT };
  }

  setTicked(name: AgentName, ticked: boolean): void {
    if (ticked) {
      if (this.bin(name) === null) throw new Error(`${AGENT_NAMES[name]} doesn't work, so it can't be ticked`);
      // The hooks Mainframe writes for Claude Code run node.
      if (ADAPTERS[name].needsNode && this.deps.nodeBin === null) throw new Error(NODE_NEEDED);
    } else {
      if (this.view().defaultAgent === name) throw new Error('Make another agent the default first');
      if (this.ticked().every((other) => other === name)) throw new Error('At least one agent must stay ticked');
    }
    this.saveAgentSetting(name, { enabled: ticked });
  }

  setDefault(name: AgentName): void {
    if (!this.ticked().includes(name)) throw new Error(`${AGENT_NAMES[name]} must be ticked and work to be the default`);
    this.save({ ...this.deps.settings, defaultAgent: name });
  }

  /** Uses the file at `path` for the agent when it works; its path is saved unless the agent's env var names it. */
  async find(name: AgentName, path: string): Promise<void> {
    const check = await ADAPTERS[name].check(path, this.deps.run, this.deps.lookup.files);
    if (check.state !== 'found') throw new Error(whyNot(name, path, check));
    this.deps.checks = { ...this.deps.checks, [name]: check };
    this.saveAgentSetting(name, this.deps.envBins[name] ? {} : { bin: check.path });
  }

  /** Merges `patch` into the agent's setting and writes settings.json at once; every project's next `inUse()` has it. */
  saveAgentSetting(name: AgentName, patch: AgentSettingPatch): void {
    const { settings } = this.deps;
    const setting: Record<string, unknown> = { ...settings.agents?.[name], ...patch };
    for (const key of Object.keys(setting)) if (setting[key] === null) delete setting[key];
    this.save({ ...settings, agents: { ...settings.agents, [name]: setting as AgentSetting } });
  }

  /** Merges `patch` onto the saved text settings; a value outside the limits or off its step is refused. */
  setTerminalText(patch: Partial<TerminalText>): void {
    const next = { ...(this.deps.settings.terminalText ?? TERMINAL_TEXT_DEFAULT), ...patch };
    const { fontSize, lineHeight } = TERMINAL_TEXT_LIMITS;
    if (!inLimits(next.fontSize, fontSize)) throw new Error('Terminal text size must be 10 to 20 px');
    if (!inLimits(next.lineHeight, lineHeight)) throw new Error('Line height must be 1.0 to 1.6');
    this.save({ ...this.deps.settings, terminalText: next });
  }

  /** OpenCode's primary agents and its models, for Settings. */
  async opencodeChoices(): Promise<OpencodeChoices> {
    const bin = this.bin('opencode');
    if (bin === null) throw new Error(`${AGENT_NAMES.opencode} doesn't work`);
    return opencodeChoices({ bin, dataDir: this.deps.dataDir, env: this.deps.env, run: this.deps.runOpencode });
  }

  /**
   * The Codex config file where the user can list CLAUDE.md, when Codex is found and would not read the project's.
   * Null otherwise. Asked afresh each time: nothing is cached, so the note goes once the user has added the line.
   */
  async codexClaudeMdNote(projectDir: string): Promise<string | null> {
    const bin = this.bin('codex');
    if (bin === null) return null;
    const missed = await (this.deps.codexMissesClaudeMd ?? codexMissesClaudeMd)({ bin, projectDir, env: this.deps.env });
    return missed ? codexConfigFile(this.deps.env, this.deps.lookup.platform) : null;
  }

  private save(next: AppSettings): void {
    writeSettings(this.deps.dataDir, next);
    this.deps.settings = next;
    this.deps.onChange(this.view());
  }
}
