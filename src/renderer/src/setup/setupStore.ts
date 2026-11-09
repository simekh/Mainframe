import { createSignal } from 'solid-js';
import type { SetupView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { loadProjects } from '../projects/projectsStore';

/** What the window shows: undefined until main has answered, null once the board can appear. */
const [view, setView] = createSignal<SetupView | null | undefined>(undefined);
export const setupView = view;

const [looking, setLooking] = createSignal(false);
/** Look again is running: the checks that fail read "looking…" until the new view comes in. */
export const isLooking = looking;

function show(next: SetupView | null): void {
  setLooking(false);
  setView(next);
  // Main registers the project calls only once the projects have started.
  if (next === null) loadProjects().catch((err: unknown) => console.error('[projects] could not list the open projects', err));
}

window.mainframe.onSetup(show);

/** Asks main for the first view; it answers once it has checked git and claude, and started the projects if nothing is missing. */
export const loadSetup = (): Promise<void> =>
  window.mainframe.getSetup().then(show, (err: unknown) => console.error(`[setup] could not get the setup: ${errorMessage(err)}`));

// Main shows its own box and ends the app when an action fails, so the page only logs it.
const run = (what: string, action: () => Promise<void>): Promise<void> =>
  action().catch((err: unknown) => console.error(`[setup] could not ${what}: ${errorMessage(err)}`));

export async function lookAgain(): Promise<void> {
  setLooking(true);
  await run('look again', () => window.mainframe.setupLookAgain());
  setLooking(false);
}

export const findClaude = () => run('use that claude', () => window.mainframe.setupFindClaude());

export const chooseProject = () => run('start the project', () => window.mainframe.setupChooseProject());
