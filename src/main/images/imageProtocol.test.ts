import { expect, it, vi } from 'vitest';
import type { ImageEntry } from '../../shared/types';
import { imageUrl } from '../../shared/imageUrl';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (request: { url: string }) => Promise<Response>>(),
  /** The files `net.fetch` finds; any other rejects, as a missing file does. */
  files: new Set<string>(),
}));
vi.mock('electron', () => ({
  protocol: { handle: (scheme: string, fn: (request: { url: string }) => Promise<Response>) => electron.handlers.set(scheme, fn) },
  net: {
    fetch: async (url: string) => {
      if (!electron.files.has(url)) throw new Error('net::ERR_FILE_NOT_FOUND');
      return new Response(`bytes of ${url}`);
    },
  },
}));
const { IMAGE_SCHEME, registerImageProtocol, resolveImageRequest } = await import('./imageProtocol');

const LISTS: Record<string, ImageEntry[]> = {
  s1: [
    { number: 1, path: '/data/tasks/t1/images/a.png', name: 'a.png' },
    { number: 2, path: '/Users/x/Desktop/b.png', name: 'b.png' },
  ],
};
const lookup = (sessionId: string) => LISTS[sessionId] ?? null;

it("a listed index is served from its entry's path", () => {
  expect(resolveImageRequest(imageUrl('s1', 0), lookup)).toBe('/data/tasks/t1/images/a.png');
  expect(resolveImageRequest(imageUrl('s1', 1), lookup)).toBe('/Users/x/Desktop/b.png');
  // The page's fragment, which loads it afresh, is left out.
  expect(resolveImageRequest(`${imageUrl('s1', 0)}#7`, lookup)).toBe('/data/tasks/t1/images/a.png');
});

it('anything else is served nothing', () => {
  expect(resolveImageRequest(imageUrl('s1', 2), lookup)).toBeNull();
  expect(resolveImageRequest(imageUrl('s9', 0), lookup)).toBeNull();
  for (const url of ['mainframe-image://s1/x', 'mainframe-image://s1/1e0', 'mainframe-image://s1/0abc', 'mainframe-image://s1/-1', 'mainframe-image://s1/']) {
    expect(resolveImageRequest(url, lookup)).toBeNull();
  }
  for (const url of ['mainframe-image://s1/../0', 'mainframe-image://../s1/0', 'mainframe-image://s1/0/..', 'mainframe-image://s1/%2e%2e/0']) {
    expect(resolveImageRequest(url, lookup)).toBeNull();
  }
  expect(resolveImageRequest('file:///etc/passwd', lookup)).toBeNull();
  expect(resolveImageRequest('mainframe-image://s1/0?x#7', lookup)).toBeNull();
});

it("the protocol serves a listed entry's file, and a 404 for an unlisted index or a listed file that is gone", async () => {
  const { pathToFileURL } = await import('node:url');
  registerImageProtocol(lookup);
  const serve = electron.handlers.get(IMAGE_SCHEME)!;
  const present = pathToFileURL(LISTS.s1[0].path).toString();
  electron.files.add(present);

  const served = await serve({ url: imageUrl('s1', 0) });
  expect(served.status).toBe(200);
  expect(await served.text()).toBe(`bytes of ${present}`);
  expect((await serve({ url: imageUrl('s1', 5) })).status).toBe(404);
  expect((await serve({ url: imageUrl('s1', 1) })).status).toBe(404);
});

it('a listed file that changed after it was recorded is served nothing: it is no longer that image', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { recordImages } = await import('./imageLog');
  const root = mkdtempSync(join(tmpdir(), 'mainframe-protocol-'));
  try {
    const shot = join(root, 'shot.png');
    writeFileSync(shot, 'png');
    const images = recordImages(join(root, 'images'), [{ path: shot, number: 1 }], join(root, 'paste'));
    registerImageProtocol((id) => (id === 's2' ? images : null));
    const serve = electron.handlers.get(IMAGE_SCHEME)!;
    electron.files.add(pathToFileURL(shot).toString());
    expect((await serve({ url: imageUrl('s2', 0) })).status).toBe(200);

    writeFileSync(shot, 'another png');
    expect(resolveImageRequest(imageUrl('s2', 0), () => images)).toBeNull();
    expect((await serve({ url: imageUrl('s2', 0) })).status).toBe(404);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
