import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { openedLinks, run, screen, startTask } from './tasks';

test.afterEach(cleanUp);

// In both commands the https is kept in a variable, so the echoed command line holds no URL of its
// own to hover.

// Three links on one screen: a plain URL, an OSC 8 link, and an OSC 8 link to a file.
const PRINT_LINKS =
  "u=https; printf 'plain: %s\\nosc8: \\033]8;;%s\\033\\\\label\\033]8;;\\033\\\\\\n" +
  "bad: \\033]8;;file:///etc/passwd\\033\\\\bad-link\\033]8;;\\033\\\\\\n' " +
  '"${u}://example.com/plain" "${u}://example.com/osc8"';

// A link, then the terminal asked to report the mouse, with `cat -v` showing what the session gets.
const PRINT_LINK_AND_TRACK_MOUSE =
  "u=https; printf 'plain: %s\\n' \"${u}://example.com/tracked\"; " +
  "printf '\\033[?1000h\\033[?1006h'; echo tracking-on-$((6*7)); cat -v";

/** Where to click: text that follows `before` on the screen, or the cell of a blank row. */
type Spot = { before: string; text: string } | { blankColumn: number };

/**
 * Hovers and clicks the spot with mouse events on the task's screen, and reports whether the
 * terminal had marked a link under the pointer when it clicked.
 *
 * All in one go inside the page, so the spot is worked out from the screen as it is at that moment
 * and nothing, a real pointer included, can come between the steps. The screen is a fresh shell's,
 * which is exactly one screen of rows, so a line's index is its row.
 */
function click(page: Page, taskId: string, spot: Spot, cmd: boolean): Promise<boolean> {
  return page.evaluate(
    ([id, target, metaKey]) => {
      const screenEl = document.querySelector('.terminal:not(.terminal--hidden) .xterm-screen')!;
      const lines = window.__thesourceE2E.screenText(id).split('\n');
      const size = window.__thesourceE2E.termSize(id)!;
      const box = screenEl.getBoundingClientRect();
      const pointAt = (row: number, col: number) => ({
        clientX: box.left + (col / size.cols) * box.width,
        clientY: box.top + ((row + 0.5) / size.rows) * box.height,
      });
      const fire = (type: string, point: { clientX: number; clientY: number }) =>
        screenEl.dispatchEvent(
          new MouseEvent(type, { ...point, bubbles: true, cancelable: true, view: window, button: 0, buttons: type === 'mousedown' ? 1 : 0, metaKey }),
        );

      // The last row is blank, and so is the one above it: they are where a click finds no link.
      const blankRow = size.rows - 1;
      let row: number;
      let col: number;
      if ('blankColumn' in target) {
        row = size.rows - 2;
        col = target.blankColumn + 0.5;
      } else {
        const wanted = target.before + target.text;
        row = lines.findIndex((line) => line.includes(wanted));
        if (row < 0) throw new Error(`"${wanted}" is not on the screen`);
        col = lines[row].indexOf(wanted) + target.before.length + target.text.length / 2;
      }
      if (lines.length !== size.rows) throw new Error(`the buffer has ${lines.length} lines for ${size.rows} rows`);
      if (lines[blankRow] !== '' || lines[size.rows - 2] !== '') throw new Error('the bottom rows are not blank');

      // xterm asks for a row's links when the pointer comes onto the row and keeps the answer while
      // it stays there. Coming from a blank row asks afresh, however the pointer was placed before.
      fire('mousemove', pointAt(blankRow, 0));
      fire('mousemove', pointAt(row, col));
      const hovered = screenEl.classList.contains('xterm-cursor-pointer');
      fire('mousedown', pointAt(row, col));
      fire('mouseup', pointAt(row, col));
      return hovered;
    },
    [taskId, spot, cmd] as const,
  );
}

test("Cmd+click opens a link from the terminal; a plain click doesn't", async () => {
  const { app, page, dataDir } = await launchApp();
  const a = await startTask(page);
  await run(page, PRINT_LINKS);
  await expect.poll(() => screen(page, a)).toContain('bad: bad-link');
  const plain = { before: 'plain: ', text: 'https://example.com/plain' };
  const osc8 = { before: 'osc8: ', text: 'label' };
  const bad = { before: 'bad: ', text: 'bad-link' };

  // A plain click on either link opens nothing, though the terminal has found the link.
  expect(await click(page, a, plain, false)).toBe(true);
  expect(await click(page, a, osc8, false)).toBe(true);

  // With Cmd held each opens once. xterm refuses the file link, so it is never even marked. A
  // record of it would sit between the two others, since main handles the clicks in order.
  expect(await click(page, a, plain, true)).toBe(true);
  expect(await click(page, a, bad, true)).toBe(false);
  expect(await click(page, a, osc8, true)).toBe(true);

  await expect.poll(() => openedLinks(dataDir)).toEqual(['https://example.com/plain', 'https://example.com/osc8']);
  await app.close();
});

test('a Cmd+click on a link stays out of a program that asks for the mouse, a plain click does not', async () => {
  const { app, page, dataDir } = await launchApp();
  const a = await startTask(page);
  await run(page, PRINT_LINK_AND_TRACK_MOUSE);
  // Printed after the terminal was asked to report the mouse, so the request has been seen by now.
  await expect.poll(() => screen(page, a)).toContain('tracking-on-42');
  await expect.poll(() => screen(page, a)).toContain('plain: https://example.com/tracked');
  const link = { before: 'plain: ', text: 'https://example.com/tracked' };

  // What the session was sent as mouse reports, which `cat -v` shows as ^[[<button;column;rowM or m.
  const reports = async () => (await screen(page, a)).replace(/\n/g, '').match(/\^\[\[<\d+;\d+;\d+[Mm]/g) ?? [];

  // The control: a plain click on a blank cell is reported, a press and a release.
  expect(await click(page, a, { blankColumn: 2 }, false)).toBe(false);
  await expect.poll(reports).toHaveLength(2);

  // The Cmd+click on the link opens it and is not reported. A second plain click, a column over,
  // follows it: once that is reported the reports stand in the order they were sent, so a report
  // of the Cmd+click would sit between the two clicks' and show.
  expect(await click(page, a, link, true)).toBe(true);
  expect(await click(page, a, { blankColumn: 30 }, false)).toBe(false);
  await expect.poll(async () => (await reports()).some((r) => r.includes(';31;'))).toBe(true);
  const sent = await reports();
  expect(sent).toHaveLength(4);
  expect(sent.map((r) => r.split(';')[1])).toEqual(['3', '3', '31', '31']);

  await expect.poll(() => openedLinks(dataDir)).toEqual(['https://example.com/tracked']);
  await app.close();
});
