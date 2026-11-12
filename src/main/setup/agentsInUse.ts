import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_NAMES, MIN_AGENT_VERSION, type AgentName, type OpencodeChoices, type ProgramCheck, type SettingsView } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import type { AgentInUse, AgentSetting } from '../agents/agent';
import { NODE_NEEDED } from '../agents/claude';
import { makeOpencodeAgent, opencodeAgents, runOpencode } from '../agents/opencode';
import type { ExecutableLookup } from '../pty/findExecutable';
import { runDefault, tickedAgents } from './agentChoice';
import type { VersionRunner } from './programChecks';
import { writeSettings, type AppSettings } from './settings';

/** A change to an agent's setting: null deletes the key. */
export type AgentSettingPatch = { [K in keyof AgentSetting]?: AgentSetting[K] | null };

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
      /** The agents MAINFRAME_CLAUDE_BIN and MAINFRAME_OPENCODE_BIN name: nothing is saved about those. */
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
    },
  ) {
    // The setup starts the projects only once an agent works.
    if (this.current() === null) throw new Error('Mainframe found no coding agent it can run');
  }

  /** Never null after the constructor: no change leaves no ticked agent that works. */
  private current(): ReturnType<typeof runDefault> {
    return runDefault(this.deps.settings, this.deps.checks);
  }

  /** The default this run uses: `runDefault`'s agent. */
  defaultAgent(): AgentName {
    return this.current()!.agent;
  }

  /** The saved default doesn't work, so another ticked agent stands in. */
  fellBack(): boolean {
    return this.current()!.fellBack;
  }

  /** Ticked and found, in AGENT_ORDER. */
  ticked(): AgentName[] {
    return tickedAgents(this.deps.settings, this.deps.checks).filter((name) => this.bin(name) !== null);
  }

  /** What was last found of the agent. */
  check(name: AgentName): ProgramCheck {
    return this.deps.checks[name];
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
    const { settings, envBins } = this.deps;
    const ticked = tickedAgents(settings, this.deps.checks);
    const agentView = (name: AgentName) => {
      const { managerAgent, syncModel } = settings.agents?.[name] ?? {};
      return {
        check: this.check(name),
        fromEnv: Boolean(envBins[name]),
        ticked: ticked.includes(name),
        ...(managerAgent !== undefined && { managerAgent }),
        ...(syncModel !== undefined && { syncModel }),
      };
    };
    const runDefault = this.defaultAgent();
    return { agents: { claude: agentView('claude'), opencode: agentView('opencode') }, defaultAgent: settings.defaultAgent ?? runDefault, runDefault };
  }

  setTicked(name: AgentName, ticked: boolean): void {
    if (ticked) {
      if (this.bin(name) === null) throw new Error(`${AGENT_NAMES[name]} doesn't work, so it can't be ticked`);
      // The hooks Mainframe writes for Claude Code run node.
      if (name === 'claude' && this.deps.nodeBin === null) throw new Error(NODE_NEEDED);
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

  /**
   * OpenCode's primary agents and its models, listed in an empty folder of their own, so no project's config is read.
   * Only ids and the models' kept fields come back: the lists can hold API keys.
   */
  async opencodeChoices(): Promise<OpencodeChoices> {
    const bin = this.bin('opencode');
    if (bin === null) throw new Error(`${AGENT_NAMES.opencode} doesn't work`);
    const dir = join(this.deps.dataDir, 'opencode-lists');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const run = this.deps.runOpencode ?? runOpencode;
    const { env } = this.deps;
    const [agents, models] = await Promise.all([
      opencodeAgents({ bin, cwd: dir, env, run, noProjectConfig: true }),
      makeOpencodeAgent({ run }).sync.models!({ bin, dir, env }),
    ]);
    const primary = agents.filter((a) => a.primary);
    return { agents: primary.map((a, i) => ({ id: a.id, isDefault: i === 0 })), models };
  }

  private save(next: AppSettings): void {
    writeSettings(this.deps.dataDir, next);
    this.deps.settings = next;
    this.deps.onChange(this.view());
  }
}
