import type { IBufferLine, ILinkProvider, Terminal } from '@xterm/xterm';
import { labelRanges } from '../../../shared/imageLabels';
import { imagesOf, openImage } from '../images/imagesStore';
import { linkClickHeld } from '../keys';

/**
 * The line with one character per column, so a string index is a column: a cell whose character isn't one UTF-16 unit
 * (an emoji, the empty second half of a wide one) stands as a space. The labels are plain ASCII, so they stay whole.
 */
function cellText(line: IBufferLine, cols: number): string {
  let text = '';
  for (let x = 0; x < cols; x++) {
    const chars = line.getCell(x)?.getChars() ?? '';
    text += chars.length === 1 ? chars : ' ';
  }
  return text;
}

/**
 * Makes the agent's image labels in the terminal links to the session's images. Only a label whose number is in the list
 * is one, and a Cmd+click (Ctrl+click on Windows and Linux) on it opens that image; a plain click selects, as it does on
 * other links. A label the terminal wrapped onto the next row is read across the rows of its line, and links from both.
 */
export function imageLinkProvider(term: Terminal, sessionId: string, label: RegExp, platform: NodeJS.Platform): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const buffer = term.buffer.active;
      const row = y - 1;
      const images = imagesOf(sessionId);
      if (!buffer.getLine(row) || images.length === 0) return callback(undefined);
      // The rows of the soft-wrapped line this row is part of.
      let first = row;
      while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
      const lines: IBufferLine[] = [];
      for (let r = first, line = buffer.getLine(r); line && (r === first || line.isWrapped); line = buffer.getLine(++r)) lines.push(line);
      // Cheap bail-out: most lines hold no label, and this skips the per-cell walk for them.
      if (labelRanges(lines.map((line) => line.translateToString()).join(''), label).length === 0) return callback(undefined);
      // One character per column on every row, so an index is a row and a column.
      const text = lines.map((line) => cellText(line, term.cols)).join('');
      const at = (i: number) => ({ x: (i % term.cols) + 1, y: first + Math.floor(i / term.cols) + 1 });
      const links = labelRanges(text, label)
        .filter((r) => images.some((e) => e.number === r.number))
        .map((r) => ({ range: { start: at(r.start), end: at(r.end - 1) }, number: r.number, text: text.slice(r.start, r.end) }))
        .filter(({ range }) => range.start.y <= y && y <= range.end.y)
        .map(({ range, number, text }) => ({
          range,
          text,
          activate: (event: MouseEvent) => {
            if (!linkClickHeld(event, platform)) return;
            // Looked up at the click: the list may have changed since the hover.
            const index = imagesOf(sessionId).findIndex((e) => e.number === number);
            if (index >= 0) openImage(sessionId, index);
          },
        }));
      callback(links.length > 0 ? links : undefined);
    },
  };
}
