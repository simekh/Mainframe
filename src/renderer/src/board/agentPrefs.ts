import type { AgentName } from '../../../shared/types';

/** The agent the New task box last started in the project; each project keeps its own. */
const agentKey = (dir: string) => `mainframe.new-task-agent:${dir}`;

/** OpenCode only while it is still found; anything else is Claude Code. */
export const loadAgent = (storage: Pick<Storage, 'getItem'>, dir: string, opencodeFound: boolean): AgentName =>
  opencodeFound && storage.getItem(agentKey(dir)) === 'opencode' ? 'opencode' : 'claude';

/** A storage that refuses the write leaves the pick for this run only. */
export function saveAgent(storage: Pick<Storage, 'setItem'>, dir: string, agent: AgentName): void {
  try {
    storage.setItem(agentKey(dir), agent);
  } catch {
    // Nothing to do: the next New task box starts on Claude Code.
  }
}
