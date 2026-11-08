import { batch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { ProjectView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { forgetManager, loadManager } from '../manager/managerStore';
import { forgetTasks, loadTasks } from '../tasksStore';
import { bringOnScreen, fitLayout, loadLayout, managerShown, saveLayout, showOnly, toggleBeside, toggleManager, type Layout } from './layout';

const [store, setStore] = createStore<{
  /** The open projects, in the order the owner opened them. */
  projects: ProjectView[];
  /** Whether the first list has come in, so the window never shows "no project" before it has asked. */
  loaded: boolean;
  layout: Layout;
}>({ projects: [], loaded: false, layout: loadLayout(localStorage) });

export const projectsStore = store;

export const isShown = (dir: string) => store.layout.shown.includes(dir);
export const managerHidden = (dir: string) => !managerShown(store.layout, dir);
export const weightOf = (dir: string) => store.layout.weights[dir] ?? 1;

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
    }
  });
  for (const dir of dirs.filter((d) => !before.includes(d))) {
    void load('tasks', dir, loadTasks(dir));
    void load('manager', dir, loadManager(dir));
  }
}

window.mainframe.onProjects((projects) => {
  changed = true;
  setProjects(projects);
});

window.mainframe.onShowProject((dir) => revealProject(dir));

export async function loadProjects(): Promise<void> {
  const projects = await window.mainframe.listProjects();
  // Every change carries the whole list, so one that came in meanwhile is at least as new.
  if (!changed) setProjects(projects);
}

export const showOnlyProject = (dir: string) => setLayout(showOnly(store.layout, dir));
export const toggleBesideProject = (dir: string) => setLayout(toggleBeside(store.layout, dir));
export const toggleManagerOf = (dir: string) => setLayout(toggleManager(store.layout, dir));
export const setArrangement = (arrangement: Layout['arrangement']) => setLayout({ ...store.layout, arrangement });
/** Brings a project on screen that something needs seen: one just opened, or the next that needs the owner. */
export const revealProject = (dir: string) => setLayout(bringOnScreen(store.layout, dir));

/** Main asks for the folder and says itself why one can't open. */
export const openProject = () => window.mainframe.openProject();

export function closeProject(dir: string): void {
  window.mainframe.closeProject(dir).catch((err: unknown) => console.error(`[projects] could not close ${dir}: ${errorMessage(err)}`));
}
