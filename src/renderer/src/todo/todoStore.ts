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

/** A project that closed: its list and note drafts go. Its sync has stopped in main. */
export function forgetTodo(dir: string): void {
  open.delete(dir);
  changed.delete(dir);
  drafts.delete(dir);
  setStore(produce((todos) => void delete todos[dir]));
}

export interface NoteDraft {
  title: string;
  text: string;
}

/**
 * What was typed in a note's ticket and not saved, by project and then ticket key (a note's, or 'new-note'). It comes
 * back when the ticket opens again, until Mainframe quits or the project closes.
 */
const drafts = new Map<string, Map<string, NoteDraft>>();

export const noteDraft = (dir: string, key: string): NoteDraft | undefined => drafts.get(dir)?.get(key);

/** Keeps `draft` for the ticket, or with null forgets it. */
export function keepNoteDraft(dir: string, key: string, draft: NoteDraft | null): void {
  if (draft) {
    if (!drafts.has(dir)) drafts.set(dir, new Map());
    drafts.get(dir)!.set(key, draft);
  } else {
    drafts.get(dir)?.delete(key);
  }
}

// What these find, ask or fail with shows in the view; a call main refuses is only logged.
const logged = (what: string, dir: string) => (err: unknown) =>
  console.error(`[todo] could not ${what} for ${dir}: ${errorMessage(err)}`);

export function syncTodo(dir: string): void {
  window.mainframe.syncTodo(dir).catch(logged('sync the list', dir));
}

export function cancelTodoSync(dir: string): void {
  window.mainframe.cancelTodoSync(dir).catch(logged('stop the sync', dir));
}

export function keepTodoSync(dir: string): void {
  window.mainframe.keepTodoSync(dir).catch(logged('keep the sync going', dir));
}

export function confirmTodoTools(dir: string): void {
  window.mainframe.confirmTodoTools(dir).catch(logged('allow the tools', dir));
}

export function pickTodoList(dir: string, index: number): void {
  window.mainframe.pickTodoList(dir, index).catch(logged('pick the list', dir));
}

export function pickTodoModel(dir: string, id: string): void {
  window.mainframe.pickTodoModel(dir, id).catch(logged('pick the model', dir));
}

export function resetTodoSource(dir: string): void {
  window.mainframe.resetTodoSource(dir).catch(logged('set up the sync again', dir));
}
