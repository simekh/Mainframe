import { AGENT_ORDER, type AgentName, type ProgramCheck } from '../../shared/types';
import type { AppSettings } from './settings';

type Checks = Record<AgentName, ProgramCheck>;

/** No saved choice counts as ticked once the agent works, so an upgrader's OpenCode shows whenever it is found. */
export function tickedAgents(settings: AppSettings, checks: Checks): AgentName[] {
  return AGENT_ORDER.filter((agent) => settings.agents?.[agent]?.enabled ?? checks[agent].state === 'found');
}

/** The agent to run by default: the saved one when it works, else the first ticked one that does; `null` when none does. */
export function runDefault(settings: AppSettings, checks: Checks): { agent: AgentName; fellBack: boolean } | null {
  const ticked = tickedAgents(settings, checks);
  const works = (agent: AgentName) => checks[agent].state === 'found';
  const wanted = settings.defaultAgent ?? ticked[0];
  if (wanted !== undefined && ticked.includes(wanted) && works(wanted)) return { agent: wanted, fellBack: false };
  const first = ticked.find(works);
  return first === undefined ? null : { agent: first, fellBack: settings.defaultAgent !== undefined };
}
