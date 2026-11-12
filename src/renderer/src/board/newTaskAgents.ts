import { AGENT_NAMES, AGENT_ORDER, MIN_AGENT_VERSION, type AgentName, type SettingsView } from '../../../shared/types';

/** What the New task box offers: the ticked, working agents, the one it starts on, and why a ticked one is left out. */
export function newTaskAgents(view: SettingsView): { options: AgentName[]; start: AgentName; hints: string[] } {
  const ticked = AGENT_ORDER.filter((name) => view.agents[name].ticked);
  const hints = ticked.flatMap((name) => {
    const { check } = view.agents[name];
    if (check.state === 'too-old') return [`${AGENT_NAMES[name]} ${check.version} is installed. Mainframe needs ${MIN_AGENT_VERSION[name]} or later.`];
    if (check.state === 'broken') return [`The ${name} at ${check.path} didn't say its version, so Mainframe can't use it.`];
    return [];
  });
  return { options: ticked.filter((name) => view.agents[name].check.state === 'found'), start: view.runDefault, hints };
}
