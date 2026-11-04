import type { PtyExitEvent } from '../../shared/types';

interface PtyHandlers {
  data(d: Uint8Array): void;
  exit(e: PtyExitEvent): void;
}

const handlers = new Map<string, PtyHandlers>();
let installed = false;

/** One bridge listener per event type for all sessions, dispatched by session id. */
function install(): void {
  if (installed) return;
  installed = true;
  window.thesource.onData((e) => handlers.get(e.sessionId)?.data(e.data));
  window.thesource.onExit((e) => handlers.get(e.sessionId)?.exit(e));
}

export function subscribePty(sessionId: string, h: PtyHandlers): () => void {
  install();
  handlers.set(sessionId, h);
  return () => {
    if (handlers.get(sessionId) === h) handlers.delete(sessionId);
  };
}
