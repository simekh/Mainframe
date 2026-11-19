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
 * other links.
 */
export function imageLinkProvider(term: Terminal, sessionId: string, label: RegExp, platform: NodeJS.Platform): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      const images = imagesOf(sessionId);
      if (!line || images.length === 0) return callback(undefined);
      // Cheap bail-out: most lines hold no label, and this skips the per-cell walk for them.
      if (labelRanges(line.translateToString(true), label).length === 0) return callback(undefined);
      const text = cellText(line, term.cols);
      const links = labelRanges(text, label)
        .filter((r) => images.some((e) => e.number === r.number))
        .map((r) => ({
          range: { start: { x: r.start + 1, y }, end: { x: r.end, y } },
          text: text.slice(r.start, r.end),
          activate: (event: MouseEvent) => {
            if (!linkClickHeld(event, platform)) return;
            // Looked up at the click: the list may have changed since the hover.
            const index = imagesOf(sessionId).findIndex((e) => e.number === r.number);
            if (index >= 0) openImage(sessionId, index);
          },
        }));
      callback(links.length > 0 ? links : undefined);
    },
  };
}
