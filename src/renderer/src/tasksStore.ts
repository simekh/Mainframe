import { batch } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import type { TheSourceApi } from '../../shared/ipc';
import type { TaskView } from '../../shared/types';
import { laneOrder, nextNeedsYou } from './board/lanes';
import { addedTask, nextSessionState, updateTerminals, type SessionState, type TerminalEntry } from './taskModel';
import { getTerminal } from './terminal/registry';

const [store, setStore] = createStore<{
  tasks: TaskView[];
  /** By session id. */
  sessions: Record<string, SessionState>;
  terminals: TerminalEntry[];
  selectedId: string | null;
  /** Whether the unpinned panel is out; the pinned one always is. */
  panelOpen: boolean;
}>({ tasks: [], sessions: {}, terminals: [], selectedId: null, panelOpen: true });

export const tasksStore = store;

let changed = false;
/** Whether a New task start is under way. The dialog allows one at a time. */
let startPending = false;

function setTasks(tasks: TaskView[]): void {
  batch(() => {
    // The list that brings a started task selects it in the batch that adds its terminal, so the
    // terminal mounts on screen and its session starts at the size it shows.
    const started = startPending ? addedTask(unwrap(store.tasks), tasks) : null;
    // Keyed, so cards and terminals stay mounted across changes.
    setStore('tasks', reconcile(tasks, { key: 'id' }));
    setStore('terminals', updateTerminals(unwrap(store.terminals), tasks));
    if (started) select(started);
  });
}

window.thesource.onTasks((tasks) => {
  changed = true;
  setTasks(tasks);
});

window.thesource.onStatus((e) => {
  setStore('sessions', e.sessionId, nextSessionState(store.sessions[e.sessionId], e.status, Date.now()));
});

export async function loadTasks(): Promise<void> {
  const tasks = await window.thesource.listTasks();
  // Every change carries the whole list, so one that came in meanwhile is at least as new.
  if (!changed) setTasks(tasks);
}

/** Rejects with the reason the task couldn't start. */
export async function startTask(req: Parameters<TheSourceApi['startTask']>[0]): Promise<void> {
  startPending = true;
  try {
    const task = await window.thesource.startTask(req);
    // Selected already, unless the reply came before the list.
    select(task.id);
  } finally {
    startPending = false;
  }
}

export async function reopenTask(id: string): Promise<void> {
  // Selected first, so the new session's terminal mounts on screen. A reopen that fails leaves
  // the closed task selected, where the owner just asked for it.
  select(id);
  await window.thesource.reopenTask(id);
}

export function closeTask(id: string): void {
  window.thesource.closeTask(id);
}

/** Whatever selects a task (a card, Answer, Reopen, New task) also brings the panel out to show it. */
export function select(id: string | null): void {
  setStore(id === null ? { selectedId: id } : { selectedId: id, panelOpen: true });
}

export function setPanelOpen(open: boolean): void {
  setStore('panelOpen', open);
}

/** What the task's running session has reported; nothing while it is closed. */
export function sessionOf(task: TaskView): SessionState | undefined {
  return task.session ? store.sessions[task.session.id] : undefined;
}

/** The session id of the task's terminal: its running session, or the last one it had. */
export function terminalOf(taskId: string): string | null {
  return store.terminals.find((t) => t.taskId === taskId)?.sessionId ?? null;
}

/** Puts the cursor in the task's terminal; nothing happens when the task has none in this run. */
export function focusTerminalOf(taskId: string): void {
  const sessionId = terminalOf(taskId);
  if (sessionId) getTerminal(sessionId)?.focus();
}

/**
 * Selects the task `step` places from the selected one in the Needs you lane, in board order, and
 * puts the cursor in its terminal. Nothing happens while nothing needs the owner, or while a modal
 * dialog is open: it blocks what lies behind it.
 */
export function jumpToNeedsYou(step: 1 | -1): void {
  if (document.querySelector('dialog:modal')) return;
  const queue = laneOrder(store.tasks, store.sessions)['needs-you'].map((t) => t.id);
  const id = nextNeedsYou(queue, store.selectedId, step);
  if (id === null) return;
  select(id);
  // Once Solid has put the panel and the terminal on show: a hidden element can't take the focus.
  queueMicrotask(() => focusTerminalOf(id));
}
