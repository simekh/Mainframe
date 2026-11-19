import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { IMAGE_SCHEME } from '../../shared/imageUrl';
import type { ImageEntry } from '../../shared/types';
import { unchanged } from './imageLog';

export { IMAGE_SCHEME };

/** `imageUrl`'s shape, whole: a session id and a plain index, nothing else. */
const IMAGE_URL = new RegExp(`^${IMAGE_SCHEME}://([A-Za-z0-9-]+)/(\\d+)$`);

/**
 * The file to serve for an image URL: the path of the entry at its index in the session's list, never a path taken
 * from the URL. Null for a URL of another shape, an unknown session, an index past the list, or a file that changed
 * since it was recorded. A fragment is left out: the page adds one to load an image afresh, which it would otherwise
 * show from what it loaded before.
 */
export function resolveImageRequest(url: string, lookup: (sessionId: string) => ImageEntry[] | null): string | null {
  const hash = url.indexOf('#');
  const match = IMAGE_URL.exec(hash < 0 ? url : url.slice(0, hash));
  if (!match) return null;
  const entry = lookup(match[1])?.[Number(match[2])];
  return entry && unchanged(entry) ? entry.path : null;
}

/**
 * Serves the conversations' images to the page; a request for anything else, or a file that is gone or changed, gets a 404. Call
 * once the app is ready. The scheme stays unprivileged (no `supportFetchAPI`, `corsEnabled` or `bypassCSP`): that is
 * what keeps the page from reading an image's bytes, so it can only show them.
 */
export function registerImageProtocol(lookup: (sessionId: string) => ImageEntry[] | null): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const path = resolveImageRequest(request.url, lookup);
    if (path === null) return new Response(null, { status: 404 });
    try {
      return await net.fetch(pathToFileURL(path).toString());
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
