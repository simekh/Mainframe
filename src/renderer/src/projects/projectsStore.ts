import { batch, createSignal } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import type { ProjectView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { forgetManager, loadManager, managerOf } from '../manager/managerStore';
import type { PanelState } from '../panel/panelPrefs';
import {
  focusTerminalOf, forgetTasks, jumpToNeedsYou, loadTasks, needsYouCount, select, tasksOf, terminalOf,
} from '../tasksStore';
import { getTerminal } from '../terminal/registry';
import { forgetTodo, loadTodo } from '../todo/todoStore';
import { fitLayout, focusOn, loadLayout, managerShown, saveLayout, toggleBeside, toggleManager, type Layout } from './layout';

const [store, setStore] = createStore<{
  /** The open projects, in the order the owner opened them. */
  projects: ProjectView[];
  /** Whether the first list has come in, so the window never shows "no project" before it has asked. */
  loaded: boolean;
  layout: Layout;
  /**
   * Whether each project's manager, while on, is open or folded into its strip; never saved. A project is missing
   * until the owner first folds or opens it, and its manager is then as its pin shows it.
   */
  managerOpen: Record<string, boolean>;
}>({ projects: [], loaded: false, layout: loadLayout(localStorage), managerOpen: {} });

export const projectsStore = store;

export const isShown = (dir: string) => store.layout.shown.includes(dir);
export const isFocused = (dir: string) => store.layout.focused === dir;
export const isManagerShown = (dir: string) => managerShown(store.layout, dir);
export const managerOpenOf = (dir: string): boolean | undefined => store.managerOpen[dir];
export const setManagerOpen = (dir: string, open: boolean) => setStore('managerOpen', dir, open);

/** The projects list, the window's own: open at launch, and never saved. */
export const [railState, setRailState] = createSignal<PanelState>('open');
/** Projects in the top row: off, it turns the list on and open; open or folded, it turns it off. */
export const toggleRail = () => setRailState(railState() === 'off' ? 'open' : 'off');
/** The sessions that need the owner in the open projects off screen: what the list shows of them while it is off. */
export const offScreenNeedsYou = () =>
  store.projects.reduce((sum, { dir }) => sum + (isShown(dir) ? 0 : needsYouCount(dir)), 0);

let changed = false;

/** Shows the layout at once; `keep` also saves it, which a divider's drag leaves to its end. */
export function setLayout(layout: Layout, keep = true): void {
  setStore('layout', reconcile(layout));
  if (keep) saveLayout(localStorage, layout);
}

const load = (what: string, dir: string, done: Promise<void>) =>
  done.catch((err: unknown) => console.error(`[projects] could not load the ${what} of ${dir}: ${errorMessage(err)}`));

function setProjects(projects: ProjectView[]): void {
  const dirs = projects.map((p) => p.dir);
  const before = store.projects.map((p) => p.dir);
  batch(() => {
    setStore('projects', reconcile(projects, { key: 'dir' }));
    setStore('loaded', true);
    setLayout(fitLayout(store.layout, dirs));
    for (const dir of before.filter((d) => !dirs.includes(d))) {
      forgetTasks(dir);
      forgetManager(dir);
      setStore('managerOpen', produce((open) => void delete open[dir]));
      forgetTodo(dir);
    }
  });
  for (const dir of dirs.filter((d) => !before.includes(d))) {
    void load('tasks', dir, loadTasks(dir));
    void load('manager', dir, loadManager(dir));
    void load('Todo list', dir, loadTodo(dir));
  }
}

window.mainframe.onProjects((projects) => {
  changed = true;
  setProjects(projects);
});

window.mainframe.onShowProject((dir) => revealProject(dir));

/** The first list, asked for once every project has opened: the setup's end. */
export async function loadProjects(): Promise<void> {
  const projects = await window.mainframe.listProjects();
  // Every change carries the whole list, so one that came in meanwhile is at least as new.
  if (!changed) setProjects(projects);
}

export const toggleBesideProject = (dir: string) => setLayout(toggleBeside(store.layout, dir));
/** Turns the project's manager off, or on: then open, never as a strip, whether or not it was folded when it went off. */
export function toggleManagerOf(dir: string): void {
  batch(() => {
    if (!isManagerShown(dir)) setManagerOpen(dir, true);
    setLayout(toggleManager(store.layout, dir));
  });
}
export const setArrangement = (arrangement: Layout['arrangement']) => setLayout({ ...store.layout, arrangement });

/**
 * Focuses the project: one just opened, the next that needs the owner, or the pane they work in. One
 * off screen takes the focused one's place.
 */
export function revealProject(dir: string): void {
  if (store.layout.focused !== dir) setLayout(focusOn(store.layout, dir));
}

/**
 * Focuses the project from the list or Cmd+1 to Cmd+9 (Ctrl+1 to Ctrl+9 on Windows and Linux), and
 * puts the cursor where its typing goes: the selected task's terminal, brought out as Ctrl+Tab brings
 * it, or else its manager's, opened if it is folded. With neither, the cursor leaves the project it was
 * in, so no typing lands there unseen.
 */
export function focusProject(dir: string): void {
  revealProject(dir);
  const taskId = tasksOf(dir).selectedId;
  const toTask = taskId !== null && terminalOf(dir, taskId) !== null;
  if (toTask) select(dir, taskId);
  const managerTerminal = isManagerShown(dir) ? managerOf(dir)?.managerTerminal : null;
  if (!toTask && managerTerminal) setManagerOpen(dir, true);
  // Once Solid has put the pane and the panel on show: a hidden element can't take the focus.
  queueMicrotask(() => {
    if (toTask) focusTerminalOf(dir, taskId);
    else if (managerTerminal) getTerminal(managerTerminal)?.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** Ctrl+Tab and the board's button: the next session that needs the owner, in any open project. */
export const jump = (step: 1 | -1) =>
  jumpToNeedsYou(
    step,
    store.projects.map((p) => p.dir),
    revealProject,
  );

/**
 * Takes the focused project off screen, as Cmd+W (Ctrl+Shift+W on Windows and Linux) does; it stays
 * open, its sessions running. The neighbour that takes the focus takes the cursor too. The last one on
 * screen stays.
 */
export function closeFocusedPane(): void {
  const { focused, shown } = store.layout;
  if (focused === null || shown.length < 2) return;
  toggleBesideProject(focused);
  if (store.layout.focused !== null) focusProject(store.layout.focused);
}

/** Main asks for the folder and says itself why one can't open. */
export const openProject = () => window.mainframe.openProject();

export function closeProject(dir: string): void {
  window.mainframe.closeProject(dir).catch((err: unknown) => console.error(`[projects] could not close ${dir}: ${errorMessage(err)}`));
}
