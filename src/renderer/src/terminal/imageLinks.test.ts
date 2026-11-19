import type { ILink, Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_LABEL, labelRanges } from '../../../shared/imageLabels';
import type { ImageEntry } from '../../../shared/types';

const store = vi.hoisted(() => ({ images: [] as ImageEntry[] }));
vi.mock('../images/imagesStore', () => ({ imagesOf: () => store.images, openImage: () => {} }));
const { imageLinkProvider } = await import('./imageLinks');

describe('labelRanges', () => {
  it('gives the columns and number of each label on a line', () => {
    expect(labelRanges('❯ [Image #3] see [Image #12]', IMAGE_LABEL.claude!)).toEqual([
      { start: 2, end: 12, number: 3 },
      { start: 17, end: 28, number: 12 },
    ]);
  });

  it('finds none on a line without a label', () => {
    expect(labelRanges('❯ [Image] #3', IMAGE_LABEL.claude!)).toEqual([]);
  });
});

describe('imageLinkProvider', () => {
  // A wide character takes two cells, the second empty, as in xterm's buffer.
  const cells = ['❯', ' ', '界', '', ...'[Image #3] [Image #4]'];
  const term = {
    cols: cells.length,
    buffer: {
      active: {
        getLine: (y: number) =>
          y === 0 ? { translateToString: () => cells.join(''), getCell: (x: number) => ({ getChars: () => cells[x] ?? '' }) } : undefined,
      },
    },
  } as unknown as Terminal;
  const linksOn = (y: number) => {
    let links: ILink[] | undefined;
    imageLinkProvider(term, 's1', IMAGE_LABEL.claude!, 'darwin').provideLinks(y, (l) => (links = l));
    return links;
  };

  it('links only a listed label, on its own cells', () => {
    store.images = [{ number: 4, path: '/a.png', name: 'a.png' }];
    // [Image #3] is unlisted; [Image #4] fills columns 16 to 25, counted from 1.
    expect(linksOn(1)?.map(({ range, text }) => ({ range, text }))).toEqual([
      { range: { start: { x: 16, y: 1 }, end: { x: 25, y: 1 } }, text: '[Image #4]' },
    ]);
  });

  it('gives no link where no label is listed', () => {
    store.images = [{ number: 9, path: '/a.png', name: 'a.png' }];
    expect(linksOn(1)).toBeUndefined();
    store.images = [];
    expect(linksOn(1)).toBeUndefined();
  });
});
