import { createStore } from 'solid-js/store';
import type { ManagerView } from '../../../shared/types';
import { getTerminal } from '../terminal/registry';

const [store, setStore] = createStore<{
  /** Null until the first view comes in, so the column never shows a stop that hasn't happened. */
  manager: ManagerView | null;
  /** The session id of the manager's terminal: its running session, or the last one it had. */
  managerTerminal: string | null;
}>({ manager: null, managerTerminal: null });

export const managerStore = store;

let changed = false;

function setManager(manager: ManagerView): void {
  // Once its session has ended, the terminal stays, so its last output can still be read.
  setStore({ manager, managerTerminal: manager.session?.id ?? store.managerTerminal });
}

window.mainframe.onManager((view) => {
  changed = true;
  setManager(view);
});

export async function loadManager(): Promise<void> {
  const view = await window.mainframe.getManager();
  // Every change carries the whole view, so one that came in meanwhile is at least as new.
  if (!changed) setManager(view);
}

/**
 * Launches the manager again, carrying on its chat, and puts the cursor in its new terminal: the
 * owner's click on Restart is where they last clicked. Rejects with why it couldn't.
 */
export async function restartManager(): Promise<void> {
  const { session } = await window.mainframe.restartManager();
  // Main sends the change that brings the session before it answers, so its terminal is mounted by now.
  getTerminal(session!.id)?.focus();
}
