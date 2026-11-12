import type { AgentName, ProgramCheck } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import type { AgentInUse } from '../agents/agent';
import { runDefault, tickedAgents } from './agentChoice';
import type { AppSettings } from './settings';

/**
 * Which agents this run of Mainframe uses and from which path, as the start found them. One object, made at start and
 * shared by every open project: a change here reaches each project's next task, manager start and sync alike.
 */
export class AgentsInUse {
  private readonly run: { agent: AgentName; fellBack: boolean };

  constructor(
    private readonly deps: {
      dataDir: string;
      settings: AppSettings;
      checks: Record<AgentName, ProgramCheck>;
      /** The agents MAINFRAME_CLAUDE_BIN and MAINFRAME_OPENCODE_BIN name: nothing is saved about those. */
      envBins: Partial<Record<AgentName, string>>;
    },
  ) {
    const run = runDefault(deps.settings, deps.checks);
    // The setup starts the projects only once an agent works.
    if (run === null) throw new Error('Mainframe found no coding agent it can run');
    this.run = run;
  }

  /** The default this run uses: `runDefault`'s agent. */
  defaultAgent(): AgentName {
    return this.run.agent;
  }

  /** The saved default didn't work at start, so another ticked agent stands in. */
  fellBack(): boolean {
    return this.run.fellBack;
  }

  /** Ticked and found, in AGENT_ORDER. */
  ticked(): AgentName[] {
    return tickedAgents(this.deps.settings, this.deps.checks).filter((name) => this.bin(name) !== null);
  }

  /** What the start found of the agent. */
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
    const agent = this.run.agent;
    return { adapter: ADAPTERS[agent], bin: this.bin(agent)!, setting: this.deps.settings.agents?.[agent] ?? {} };
  }
}
