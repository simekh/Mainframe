import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { labelRanges } from '../../../shared/imageLabels';
import { imagesOf, openImage } from '../images/imagesStore';
import { linkClickHeld } from '../keys';
import { screenText } from './imageWatch';

/** Room for any label on one line: `[Image #` and a number of up to seven digits, `]`. */
const LONGEST_LABEL = 16;

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
 * other links. A label split across rows, by the terminal's wrap or by the agent's own, is read across them and links
 * from each.
 */
export function imageLinkProvider(term: Terminal, sessionId: string, label: RegExp, platform: NodeJS.Platform): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const buffer = term.buffer.active;
      const row = y - 1;
      const images = imagesOf(sessionId);
      if (!buffer.getLine(row) || images.length === 0) return callback(undefined);
      // The rows a label on this row can reach, wrapped or not: the agent's own wrap starts a row the terminal doesn't
      // count as wrapped.
      const reach = Math.ceil(LONGEST_LABEL / term.cols);
      const first = Math.max(0, row - reach);
      const lines: IBufferLine[] = [];
      for (let r = first, line = buffer.getLine(r); line && r <= row + reach; line = buffer.getLine(++r)) lines.push(line);
      // Cheap bail-out: most lines hold no label, and this skips the per-cell walk for them.
      if (labelRanges(screenText(lines), label).length === 0) return callback(undefined);
      // One character per column on every row, so an index is a row and a column.
      const text = lines.map((line) => cellText(line, term.cols)).join('');
      const at = (i: number) => ({ x: (i % term.cols) + 1, y: first + Math.floor(i / term.cols) + 1 });
      const links: ILink[] = [];
      for (const r of labelRanges(text, label)) {
        const range = { start: at(r.start), end: at(r.end - 1) };
        if (range.start.y > y || range.end.y < y || !images.some((e) => e.number === r.number)) continue;
        links.push({
          range,
          text: text.slice(r.start, r.end),
          activate: (event: MouseEvent) => {
            if (!linkClickHeld(event, platform)) return;
            // Looked up at the click: the list may have changed since the hover.
            const index = imagesOf(sessionId).findIndex((e) => e.number === r.number);
            if (index >= 0) openImage(sessionId, index);
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}
