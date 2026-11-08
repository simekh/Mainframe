import { createStore, produce } from 'solid-js/store';
import type { ManagerView } from '../../../shared/types';
import { getTerminal } from '../terminal/registry';

/** One open project's manager, as its column shows it. */
export interface ProjectManager {
  manager: ManagerView;
  /** The session id of the manager's terminal: its running session, or the last one it had. */
  managerTerminal: string | null;
}

/** By project folder; a project is missing until its manager's first view comes in, so its column never shows a stop that hasn't happened. */
const [store, setStore] = createStore<Record<string, ProjectManager>>({});

export const managerOf = (dir: string): ProjectManager | undefined => store[dir];

/** The projects whose manager changed since its view was asked for. */
const changed = new Set<string>();

function setManager(dir: string, manager: ManagerView): void {
  // Once its session has ended, the terminal stays, so its last output can still be read.
  setStore(dir, { manager, managerTerminal: manager.session?.id ?? store[dir]?.managerTerminal ?? null });
}

window.mainframe.onManager(({ dir, view }) => {
  changed.add(dir);
  setManager(dir, view);
});

export async function loadManager(dir: string): Promise<void> {
  const view = await window.mainframe.getManager(dir);
  // Every change carries the whole view, so one that came in meanwhile is at least as new.
  if (!changed.has(dir)) setManager(dir, view);
}

/** A project that closed: its manager's column goes. Its session has ended in main. */
export function forgetManager(dir: string): void {
  changed.delete(dir);
  setStore(produce((managers) => void delete managers[dir]));
}

/**
 * Launches the manager again, carrying on its chat, and puts the cursor in its new terminal: the
 * owner's click on Restart is where they last clicked. Rejects with why it couldn't.
 */
export async function restartManager(dir: string): Promise<void> {
  const { session } = await window.mainframe.restartManager(dir);
  // Main sends the change that brings the session before it answers, so its terminal is mounted by now.
  getTerminal(session!.id)?.focus();
}
