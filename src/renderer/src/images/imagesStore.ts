import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { ImageEntry } from '../../../shared/types';

/** Each session's images, by session id: in every project, as session ids are unique. */
const [lists, setLists] = createStore<Record<string, ImageEntry[]>>({});
/** Sessions whose list has been asked for, or has come through `onImages`. */
const asked = new Set<string>();
/** Sessions whose list came through `onImages`: a reply to the first ask, which can be older, doesn't replace it. */
const pushed = new Set<string>();
let following = false;

const set = (sessionId: string, images: ImageEntry[]) => setLists(sessionId, reconcile(images));

/** The session's images, oldest first. The first read asks main for them; later lists come as they change. */
export function imagesOf(sessionId: string): ImageEntry[] {
  if (!following) {
    following = true;
    window.mainframe.onImages(({ sessionId: id, images }) => {
      asked.add(id);
      pushed.add(id);
      set(id, images);
    });
  }
  if (!asked.has(sessionId)) {
    asked.add(sessionId);
    window.mainframe
      .getImages(sessionId)
      .then((images) => pushed.has(sessionId) || set(sessionId, images))
      .catch((err: unknown) => console.warn(`[images] could not read the images of session ${sessionId}`, err));
  }
  return lists[sessionId] ?? [];
}

/** The image the full-size view shows, by its place in its session's list; null while it is closed. */
export const [viewerState, setViewer] = createSignal<{ sessionId: string; index: number } | null>(null);

export function openImage(sessionId: string, index: number): void {
  setViewer({ sessionId, index });
}

export function closeImage(): void {
  setViewer(null);
}

/** The index one step on in a list of `length`, kept at its ends. */
export function stepIndex(index: number, length: number, delta: -1 | 1): number {
  return Math.min(Math.max(index + delta, 0), length - 1);
}
