import { batch } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import type { TheSourceApi } from '../../shared/ipc';
import type { TaskView } from '../../shared/types';
import { nextSessionState, updateTerminals, type SessionState, type TerminalEntry } from './taskModel';

const [store, setStore] = createStore<{
  tasks: TaskView[];
  /** By session id. */
  sessions: Record<string, SessionState>;
  terminals: TerminalEntry[];
  selectedId: string | null;
}>({ tasks: [], sessions: {}, terminals: [], selectedId: null });

export const tasksStore = store;

let changed = false;

function setTasks(tasks: TaskView[]): void {
  batch(() => {
    // Keyed, so cards and terminals stay mounted across changes.
    setStore('tasks', reconcile(tasks, { key: 'id' }));
    setStore('terminals', updateTerminals(unwrap(store.terminals), tasks));
  });
}

window.thesource.onTasks((tasks) => {
  changed = true;
  setTasks(tasks);
});

// reconcile replaces the status: a plain set would merge it into the old one and keep a stale kind.
window.thesource.onStatus((e) => {
  setStore('sessions', e.sessionId, reconcile(nextSessionState(store.sessions[e.sessionId], e.status, Date.now())));
});

export async function loadTasks(): Promise<void> {
  const tasks = await window.thesource.listTasks();
  // Every change carries the whole list, so one that came in meanwhile is at least as new.
  if (!changed) setTasks(tasks);
}

/** Rejects with the reason the task couldn't start. */
export async function startTask(req: Parameters<TheSourceApi['startTask']>[0]): Promise<void> {
  const task = await window.thesource.startTask(req);
  select(task.id);
}

export async function reopenTask(id: string): Promise<void> {
  await window.thesource.reopenTask(id);
  select(id);
}

export function closeTask(id: string): void {
  window.thesource.closeTask(id);
}

export function select(id: string | null): void {
  setStore('selectedId', id);
}

/** The session id of the task's terminal: its running session, or the last one it had. */
export function terminalOf(taskId: string): string | null {
  return store.terminals.find((t) => t.taskId === taskId)?.sessionId ?? null;
}
