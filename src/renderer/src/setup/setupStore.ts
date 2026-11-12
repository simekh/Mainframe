import { createSignal } from 'solid-js';
import { AGENT_ORDER, type AgentChoice, type AgentName, type SetupView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { loadProjects } from '../projects/projectsStore';

/** What the window shows: undefined until main has answered, null once the board can appear. */
const [view, setView] = createSignal<SetupView | null | undefined>(undefined);
export const setupView = view;

const [looking, setLooking] = createSignal(false);
/** Look again is running: the checks that fail read "looking…" until the new view comes in. */
export const isLooking = looking;

/** The agents ticked so far and the default, from each view's question; null while none is asked. */
const [choice, setChoice] = createSignal<AgentChoice | null>(null);
export const agentChoice = choice;

function show(next: SetupView | null): void {
  setLooking(false);
  // Before the view, so the screen never reads a new view with the last one's choice. A new view comes after an agent
  // was found by hand, and starts again from what main found.
  setChoice(next?.ask ?? null);
  setView(next);
  // Main registers the project calls only once the projects have started.
  if (next === null) loadProjects().catch((err: unknown) => console.error('[projects] could not list the open projects', err));
}

window.mainframe.onSetup(show);

/** Asks main for the first view; it answers once it has checked git and the agents, and started the projects if nothing is missing. */
export const loadSetup = (): Promise<void> =>
  window.mainframe.getSetup().then(show, (err: unknown) => console.error(`[setup] could not get the setup: ${errorMessage(err)}`));

/** Ticks or unticks an agent. The last tick can't be cleared; unticking the default moves it to the other ticked agent. */
export function toggleAgent(name: AgentName): void {
  const now = choice();
  if (now === null) return;
  if (!now.ticked.includes(name)) {
    setChoice({ ...now, ticked: AGENT_ORDER.filter((agent) => agent === name || now.ticked.includes(agent)) });
    return;
  }
  const ticked = now.ticked.filter((agent) => agent !== name);
  if (ticked.length === 0) return;
  setChoice({ ticked, defaultAgent: now.defaultAgent === name ? ticked[0] : now.defaultAgent });
}

export function setDefaultAgent(name: AgentName): void {
  const now = choice();
  if (now?.ticked.includes(name)) setChoice({ ...now, defaultAgent: name });
}

// Main shows its own box and ends the app when an action fails, so the page only logs it.
const run = (what: string, action: () => Promise<void>): Promise<void> =>
  action().catch((err: unknown) => console.error(`[setup] could not ${what}: ${errorMessage(err)}`));

export async function lookAgain(): Promise<void> {
  setLooking(true);
  await run('look again', () => window.mainframe.setupLookAgain());
  setLooking(false);
}

export const findAgent = (name: AgentName) => run(`use that ${name}`, () => window.mainframe.setupFindAgent(name));

export const chooseProject = () => {
  const now = choice();
  return now === null ? Promise.resolve() : run('start the project', () => window.mainframe.setupChooseProject(now));
};
