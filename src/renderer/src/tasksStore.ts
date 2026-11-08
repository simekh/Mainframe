import { batch } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import type { MainframeApi } from '../../shared/ipc';
import type { TaskView } from '../../shared/types';
import { laneOrder, nextNeedsYou } from './board/lanes';
import { addedTask, nextSessionState, updateTerminals, type SessionState, type TerminalEntry } from './taskModel';
import { getTerminal } from './terminal/registry';

/** One open project's tasks, as its board and its session panel show them. */
export interface ProjectTasks {
  tasks: TaskView[];
  terminals: TerminalEntry[];
  selectedId: string | null;
  /** Whether the unpinned panel is out; the pinned one always is. It comes out once a task is selected. */
  panelOpen: boolean;
}

/** Each project's own, so no two share an array the store would change in place. */
const noTasks = (): ProjectTasks => ({ tasks: [], terminals: [], selectedId: null, panelOpen: false });
/** What `tasksOf` reads for a project whose list hasn't come in; never stored. */
const NO_TASKS: ProjectTasks = Object.freeze(noTasks());

const [store, setStore] = createStore<{
  /** By project folder. */
  projects: Record<string, ProjectTasks>;
  /** By session id, which no two projects share. */
  sessions: Record<string, SessionState>;
  /** The sessions whose screen shows a Claude Code suggestion, by session id; read off the screen, so never a lane's input. */
  suggesting: Record<string, boolean>;
  /** The task selected last, in whichever project: where Ctrl+Tab goes on from. */
  lastSelected: string | null;
}>({ projects: {}, sessions: {}, suggesting: {}, lastSelected: null });

export const tasksStore = store;

/** The project's tasks; none before its first list comes in. */
export const tasksOf = (dir: string): ProjectTasks => store.projects[dir] ?? NO_TASKS;

/** The projects whose tasks changed since their list was asked for. */
const changed = new Set<string>();
/**
 * The project of each start under way. New task and the Todo panel each allow one at a time, so a project may be
 * in it twice: it is pending until its last start has finished, and the list that brings a task selects it meanwhile.
 */
const startPending: string[] = [];

function setTasks(dir: string, tasks: TaskView[]): void {
  batch(() => {
    if (!store.projects[dir]) setStore('projects', dir, noTasks());
    // The list that brings a started task selects it in the batch that adds its terminal, so the
    // terminal mounts on screen and its session starts at the size it shows.
    const started = startPending.includes(dir) ? addedTask(unwrap(store.projects[dir].tasks), tasks) : null;
    // Keyed, so cards and terminals stay mounted across changes.
    setStore('projects', dir, 'tasks', reconcile(tasks, { key: 'id' }));
    setStore('projects', dir, 'terminals', updateTerminals(unwrap(store.projects[dir].terminals), tasks));
    if (started) select(dir, started);
  });
}

window.mainframe.onTasks(({ dir, tasks }) => {
  changed.add(dir);
  setTasks(dir, tasks);
});

window.mainframe.onStatus((e) => {
  setStore('sessions', e.sessionId, nextSessionState(store.sessions[e.sessionId], e.status, Date.now()));
});

export async function loadTasks(dir: string): Promise<void> {
  const tasks = await window.mainframe.listTasks(dir);
  // Every change carries the whole list, so one that came in meanwhile is at least as new.
  if (!changed.has(dir)) setTasks(dir, tasks);
}

/** A project that closed: its cards and terminals go. Its sessions have ended in main. */
export function forgetTasks(dir: string): void {
  changed.delete(dir);
  setStore('projects', produce((projects) => void delete projects[dir]));
}

/** Selects the task `start` starts once it is on the board; rejects with the reason it couldn't start. */
async function startAndSelect(dir: string, start: () => Promise<TaskView>): Promise<void> {
  startPending.push(dir);
  try {
    const task = await start();
    // Selected already, unless the reply came before the list.
    select(dir, task.id);
  } finally {
    startPending.splice(startPending.indexOf(dir), 1);
  }
}

export const startTask = (dir: string, req: Parameters<MainframeApi['startTask']>[1]): Promise<void> =>
  startAndSelect(dir, () => window.mainframe.startTask(dir, req));

/** Starts a task from a card or a note on the project's Todo list. */
export const startTodoItem = (dir: string, req: Parameters<MainframeApi['startTodoItem']>[1]): Promise<void> =>
  startAndSelect(dir, () => window.mainframe.startTodoItem(dir, req));

export async function reopenTask(dir: string, id: string): Promise<void> {
  // Selected first, so the new session's terminal mounts on screen. A reopen that fails leaves
  // the closed task selected, where the owner just asked for it.
  select(dir, id);
  await window.mainframe.reopenTask(dir, id);
}

export function closeTask(dir: string, id: string): void {
  window.mainframe.closeTask(dir, id);
}

/** Whatever selects a task (a card, Answer, Reopen, New task) also brings the panel out to show it. */
export function select(dir: string, id: string | null): void {
  if (!store.projects[dir]) return;
  batch(() => {
    setStore('projects', dir, id === null ? { selectedId: id } : { selectedId: id, panelOpen: true });
    if (id !== null) setStore('lastSelected', id);
  });
}

export function setPanelOpen(dir: string, open: boolean): void {
  if (store.projects[dir]) setStore('projects', dir, 'panelOpen', open);
}

/** What the task's running session, or the manager's, has reported; nothing while it is closed. */
export function sessionOf(task: Pick<TaskView, 'session'>): SessionState | undefined {
  return task.session ? store.sessions[task.session.id] : undefined;
}

/** Whether a running session shows a suggestion. The store ignores a write of the same value. */
export function setSuggesting(sessionId: string, on: boolean): void {
  setStore('suggesting', sessionId, on);
}

/** Whether the task's running session shows a suggestion; never while it is closed. */
export function isSuggesting(task: TaskView): boolean {
  return task.session ? !!store.suggesting[task.session.id] : false;
}

/** The session id of the task's terminal: its running session, or the last one it had. */
export function terminalOf(dir: string, taskId: string): string | null {
  return tasksOf(dir).terminals.find((t) => t.taskId === taskId)?.sessionId ?? null;
}

/** Puts the cursor in the task's terminal; nothing happens when the task has none in this run. */
export function focusTerminalOf(dir: string, taskId: string): void {
  const sessionId = terminalOf(dir, taskId);
  if (sessionId) getTerminal(sessionId)?.focus();
}

/** The project's tasks in its Needs you lane, in board order. */
const needsYou = (dir: string) => laneOrder(tasksOf(dir).tasks, store.sessions)['needs-you'];

/** How many of the project's tasks wait in its Needs you lane. */
export const needsYouCount = (dir: string) => needsYou(dir).length;

/**
 * Selects the task `step` places from the one selected last in the Needs you lanes of every open
 * project, in the order `dirs` lists them and each board's order, and puts the cursor in its terminal.
 * `reveal` brings its project on screen first. Nothing happens while nothing needs the owner.
 */
export function jumpToNeedsYou(step: 1 | -1, dirs: string[], reveal: (dir: string) => void): void {
  const queue = dirs.flatMap((dir) => needsYou(dir).map((t) => ({ dir, id: t.id })));
  const id = nextNeedsYou(
    queue.map((t) => t.id),
    store.lastSelected,
    step,
  );
  const target = queue.find((t) => t.id === id);
  if (!target) return;
  reveal(target.dir);
  select(target.dir, target.id);
  // Once Solid has put the project, the panel and the terminal on show: a hidden element can't take the focus.
  queueMicrotask(() => focusTerminalOf(target.dir, target.id));
}
