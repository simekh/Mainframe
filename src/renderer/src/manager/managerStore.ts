import { createStore } from 'solid-js/store';
import type { ManagerView } from '../../../shared/types';

const [store, setStore] = createStore<{
  manager: ManagerView;
  /** The session id of the manager's terminal: its running session, or the last one it had. */
  managerTerminal: string | null;
}>({ manager: { session: null }, managerTerminal: null });

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
