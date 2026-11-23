import { createSignal } from 'solid-js';
import type { TrelloConnection } from '../../../shared/types';
import { errorMessage } from '../bridgeError';

/** The Trello sign-in, for the whole app; undefined until main has answered. */
const [view, setView] = createSignal<TrelloConnection | undefined>(undefined);
export const trelloConnection = view;

window.mainframe.onTrello(setView);

/** Whether Trello can be read now: signed in, with no reconnect asked. */
export const trelloSignedIn = () => {
  const t = view();
  return t?.connected === true && !t.needsReconnect;
};

// How a connect goes shows in the view; a call main refuses is only logged.
const logged = (what: string) => (err: unknown) => console.error(`[trello] could not ${what}: ${errorMessage(err)}`);

/** Every change carries the whole view, so one that came in meanwhile is at least as new as the answer. */
export const loadTrello = (): Promise<void> =>
  window.mainframe.getTrello().then((next) => void (view() ?? setView(next)), logged('get the sign-in'));

export function connectTrello(): void {
  window.mainframe.connectTrello().catch(logged('connect'));
}

export function disconnectTrello(): void {
  window.mainframe.disconnectTrello().catch(logged('disconnect'));
}

export function setTrelloClientId(id: string | null): void {
  window.mainframe.setTrelloClientId(id).catch(logged('save the client id'));
}
