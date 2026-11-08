import { createStore, produce, reconcile } from 'solid-js/store';
import type { TodoView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';

/** By project folder; a project is missing until its first view comes in. */
const [store, setStore] = createStore<Record<string, TodoView>>({});

export const todoOf = (dir: string): TodoView | undefined => store[dir];

/** The open projects. A change, or the first view, that comes in for one that has closed is dropped, so it stays gone. */
const open = new Set<string>();
/** The open projects whose Todo changed since its view was asked for. */
const changed = new Set<string>();

// Keyed, so the cards and notes a sync leaves as they were keep their place in the list.
const setTodo = (dir: string, view: TodoView) => setStore(dir, reconcile(view));

window.mainframe.onTodo(({ dir, view }) => {
  if (!open.has(dir)) return;
  changed.add(dir);
  setTodo(dir, view);
});

export async function loadTodo(dir: string): Promise<void> {
  open.add(dir);
  const view = await window.mainframe.getTodo(dir);
  // Every change carries the whole view, so one that came in meanwhile is at least as new.
  if (open.has(dir) && !changed.has(dir)) setTodo(dir, view);
}

/** A project that closed: its list goes. Its sync has stopped in main. */
export function forgetTodo(dir: string): void {
  open.delete(dir);
  changed.delete(dir);
  setStore(produce((todos) => void delete todos[dir]));
}

// What these find, ask or fail with shows in the view; a call main refuses is only logged.
const logged = (what: string, dir: string) => (err: unknown) =>
  console.error(`[todo] could not ${what} for ${dir}: ${errorMessage(err)}`);

export function syncTodo(dir: string): void {
  window.mainframe.syncTodo(dir).catch(logged('sync the list', dir));
}

export function confirmTodoTools(dir: string): void {
  window.mainframe.confirmTodoTools(dir).catch(logged('allow the tools', dir));
}

export function pickTodoList(dir: string, index: number): void {
  window.mainframe.pickTodoList(dir, index).catch(logged('pick the list', dir));
}

export function resetTodoSource(dir: string): void {
  window.mainframe.resetTodoSource(dir).catch(logged('set up the sync again', dir));
}
