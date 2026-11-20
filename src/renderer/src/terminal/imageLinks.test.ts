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
  /** A terminal whose rows are these cells, each row soft-wrapped from the one above when `wrapped`. */
  const termOf = (rows: { cells: string[]; wrapped?: boolean }[], cols: number) =>
    ({
      cols,
      buffer: {
        active: {
          getLine: (y: number) => {
            const row = rows[y];
            return row && { isWrapped: row.wrapped ?? false, translateToString: () => row.cells.join(''), getCell: (x: number) => ({ getChars: () => row.cells[x] ?? '' }) };
          },
        },
      },
    }) as unknown as Terminal;
  const linksOn = (term: Terminal, y: number) => {
    let links: ILink[] | undefined;
    imageLinkProvider(term, 's1', IMAGE_LABEL.claude!, 'darwin').provideLinks(y, (l) => (links = l));
    return links?.map(({ range, text }) => ({ range, text }));
  };

  // A wide character takes two cells, the second empty, as in xterm's buffer.
  const cells = ['❯', ' ', '界', '', ...'[Image #3] [Image #4]'];
  const oneRow = termOf([{ cells }], cells.length);

  it('links only a listed label, on its own cells', () => {
    store.images = [{ number: 4, path: '/a.png', name: 'a.png' }];
    // [Image #3] is unlisted; [Image #4] fills columns 16 to 25, counted from 1.
    expect(linksOn(oneRow, 1)).toEqual([{ range: { start: { x: 16, y: 1 }, end: { x: 25, y: 1 } }, text: '[Image #4]' }]);
  });

  it('gives no link where no label is listed', () => {
    store.images = [{ number: 9, path: '/a.png', name: 'a.png' }];
    expect(linksOn(oneRow, 1)).toBeUndefined();
    store.images = [];
    expect(linksOn(oneRow, 1)).toBeUndefined();
  });

  it('links a label the terminal wrapped onto the next row, from either row, across both', () => {
    store.images = [{ number: 3, path: '/a.png', name: 'a.png' }];
    const term = termOf(
      [
        { cells: [...'ok      '] },
        { cells: [...'❯ x [Ima'] },
        { cells: [...'ge #3] y'], wrapped: true },
        { cells: [...'z       '], wrapped: true },
      ],
      8,
    );
    const wrapped = [{ range: { start: { x: 5, y: 2 }, end: { x: 6, y: 3 } }, text: '[Image #3]' }];
    expect(linksOn(term, 2)).toEqual(wrapped);
    expect(linksOn(term, 3)).toEqual(wrapped);
    // A row of the same wrapped line that holds none of the label has no link, nor does the line above.
    expect(linksOn(term, 4)).toBeUndefined();
    expect(linksOn(term, 1)).toBeUndefined();
  });

  it('links a label Claude Code broke onto a row of its own, from either row', () => {
    store.images = [{ number: 3, path: '/a.png', name: 'a.png' }];
    // Its own wrap: `[Image`, the row's end cleared, and `#3]` on the next row after two cells it skips. Not soft-wrapped.
    const term = termOf([{ cells: [...'ok        '] }, { cells: [...'❯ [Image', '', ''] }, { cells: ['', '', ...'#3]', '', '', '', '', ''] }], 10);
    const broken = [{ range: { start: { x: 3, y: 2 }, end: { x: 5, y: 3 } }, text: '[Image    #3]' }];
    expect(linksOn(term, 2)).toEqual(broken);
    expect(linksOn(term, 3)).toEqual(broken);
    expect(linksOn(term, 1)).toBeUndefined();
  });

  it('links a label broken where `[Image` fills its row and `#3]` starts the next at its first column', () => {
    store.images = [{ number: 3, path: '/a.png', name: 'a.png' }];
    const term = termOf([{ cells: [...'ok  [Image'] }, { cells: [...'#3]       '] }], 10);
    const broken = [{ range: { start: { x: 5, y: 1 }, end: { x: 3, y: 2 } }, text: '[Image#3]' }];
    expect(linksOn(term, 1)).toEqual(broken);
    expect(linksOn(term, 2)).toEqual(broken);
  });

  it('finds a wrapped label far down a long line, reading only the rows near it', () => {
    store.images = [{ number: 3, path: '/a.png', name: 'a.png' }];
    const filler = { cells: [...'xxxxxxxx'], wrapped: true };
    const term = termOf([{ cells: [...'xxxxxxxx'] }, filler, filler, filler, { cells: [...'xx[Image'], wrapped: true }, { cells: [...' #3]    '], wrapped: true }], 8);
    const wrapped = [{ range: { start: { x: 3, y: 5 }, end: { x: 4, y: 6 } }, text: '[Image #3]' }];
    expect(linksOn(term, 5)).toEqual(wrapped);
    expect(linksOn(term, 6)).toEqual(wrapped);
    expect(linksOn(term, 2)).toBeUndefined();
  });
});
