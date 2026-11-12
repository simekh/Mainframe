import { AGENT_ORDER, type AgentName, type SettingsView } from '../../../shared/types';

export const works = (view: SettingsView, name: AgentName) => view.agents[name].check.state === 'found';

/**
 * The agents the Default agent choice offers, in AGENT_ORDER; none while there is nothing to choose. It shows while two
 * ticked agents work, and while another agent stands in for the saved default: the saved one is then listed but can't be
 * chosen (`works: false`), so the stand-in can be made the default.
 */
export function defaultChoice(view: SettingsView): { name: AgentName; works: boolean }[] {
  const working = AGENT_ORDER.filter((name) => view.agents[name].ticked && works(view, name));
  const fellBack = view.runDefault !== view.defaultAgent;
  if (!fellBack && working.length < 2) return [];
  return AGENT_ORDER.filter((name) => working.includes(name) || (fellBack && name === view.defaultAgent)).map((name) => ({
    name,
    works: working.includes(name),
  }));
}
