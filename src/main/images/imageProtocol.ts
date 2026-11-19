import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { IMAGE_SCHEME } from '../../shared/imageUrl';
import type { ImageEntry } from '../../shared/types';

export { IMAGE_SCHEME };

/** `imageUrl`'s shape, whole: a session id and a plain index, nothing else. */
const IMAGE_URL = new RegExp(`^${IMAGE_SCHEME}://([A-Za-z0-9-]+)/(\\d+)$`);

/**
 * The file to serve for an image URL: the path of the entry at its index in the session's list, never a path taken
 * from the URL. Null for a URL of another shape, an unknown session, or an index past the list.
 */
export function resolveImageRequest(url: string, lookup: (sessionId: string) => ImageEntry[] | null): string | null {
  const match = IMAGE_URL.exec(url);
  if (!match) return null;
  return lookup(match[1])?.[Number(match[2])]?.path ?? null;
}

/** Serves the conversations' images to the page; a request for anything else, or a file that is gone, gets a 404. Call once the app is ready. */
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
