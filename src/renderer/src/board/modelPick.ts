import type { AgentName, ModelChoices } from '../../../shared/types';

/** The efforts on offer: the agent's default ones for Default (no model), else the model's own; none while loading. */
export function effortsFor(choices: ModelChoices | undefined, model: string | undefined): string[] {
  if (!choices) return [];
  if (model === undefined) return choices.defaultEfforts;
  return choices.models.find((m) => m.id === model)?.efforts ?? [];
}

/** The effort if it is still on offer, else Default. */
export const keptEffort = (efforts: string[], effort: string | undefined): string | undefined =>
  effort !== undefined && efforts.includes(effort) ? effort : undefined;

/**
 * How to switch in a running session, per agent. Claude Code and Codex are passed the pick again when a task reopens;
 * OpenCode resumes a session on that session's own model, so its line promises the pick only at the start.
 */
export const SWITCH_HELP: Record<AgentName, string> = {
  claude: 'In a running session, /model switches the model and /effort the effort. A reopen starts on the pick made here.',
  codex: 'In a running session, /model switches the model and its reasoning effort. A reopen starts on the pick made here.',
  opencode: 'In a running session, /models switches the model and Ctrl+T cycles its variants. The pick here applies when the task starts.',
};
