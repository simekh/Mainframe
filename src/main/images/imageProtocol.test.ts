import { expect, it, vi } from 'vitest';
import type { ImageEntry } from '../../shared/types';
import { imageUrl } from '../../shared/imageUrl';

vi.mock('electron', () => ({}));
const { resolveImageRequest } = await import('./imageProtocol');

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
});
