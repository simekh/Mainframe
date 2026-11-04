import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ProgramStatus, SessionInfo } from '../../shared/types';

export type SessionEntry = SessionInfo & { status: ProgramStatus | null; exited: boolean };

const [store, setStore] = createStore<{ sessions: SessionEntry[]; selectedId: string | null }>({
  sessions: [],
  selectedId: null,
});

export const sessionsStore = store;

window.thesource.onStatus((e) => {
  setStore('sessions', (s) => s.id === e.sessionId, 'status', e.status);
});

export async function newSession(): Promise<void> {
  const info = await window.thesource.createSession();
  // Together, so the new terminal mounts already on screen and spawns at its real size.
  batch(() => {
    setStore('sessions', (all) => [...all, { ...info, status: null, exited: false }]);
    setStore('selectedId', info.id);
  });
}

export function select(id: string): void {
  setStore('selectedId', id);
}

export function markExited(id: string): void {
  setStore('sessions', (s) => s.id === id, 'exited', true);
}

/** Kills the session when it is still running, then removes it. */
export function close(id: string): void {
  const index = store.sessions.findIndex((s) => s.id === id);
  if (index === -1) return;
  if (!store.sessions[index].exited) window.thesource.kill(id);
  const rest = store.sessions.filter((s) => s.id !== id);
  if (store.selectedId === id) {
    setStore('selectedId', (rest[index] ?? rest[index - 1])?.id ?? null);
  }
  setStore('sessions', rest);
}
