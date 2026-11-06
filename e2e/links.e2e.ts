import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { openedLinks, run, screen, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

// Three links on one screen: a plain URL, an OSC 8 link, and an OSC 8 link to a file. The https is
// kept in a variable, so the echoed command line holds no URL of its own to hover.
const PRINT_LINKS =
  "u=https; printf 'plain: %s\\nosc8: \\033]8;;%s\\033\\\\label\\033]8;;\\033\\\\\\n" +
  "bad: \\033]8;;file:///etc/passwd\\033\\\\bad-link\\033]8;;\\033\\\\\\n' " +
  '"${u}://example.com/plain" "${u}://example.com/osc8"';

/**
 * Where `text` shows on the task's screen when it follows `before`, as a point in the page. A fresh
 * shell's buffer is exactly one screen, so a line's index is its row.
 */
async function pointOn(page: Page, taskId: string, before: string, text: string): Promise<{ x: number; y: number }> {
  const lines = (await screen(page, taskId)).split('\n');
  const size = (await termSize(page, taskId))!;
  expect(lines).toHaveLength(size.rows);
  const row = lines.findIndex((line) => line.includes(before + text));
  expect(row, `"${before + text}" on screen`).toBeGreaterThanOrEqual(0);
  const col = lines[row].indexOf(before + text) + before.length + text.length / 2;
  return page.evaluate(
    ([r, c, cols, rows]) => {
      const box = document.querySelector('.terminal:not(.terminal--hidden) .xterm-screen')!.getBoundingClientRect();
      return { x: box.left + (c / cols) * box.width, y: box.top + ((r + 0.5) / rows) * box.height };
    },
    [row, col, size.cols, size.rows],
  );
}

/**
 * The addon finds a link when the pointer moves, and marks the screen as clickable once it has.
 * xterm asks for a row's links when the pointer comes onto the row and keeps the answer while it
 * stays there, so a move that found none is made again from another row, until the link is found.
 */
async function hover(page: Page, point: { x: number; y: number }): Promise<void> {
  const screenEl = page.locator('.terminal:not(.terminal--hidden) .xterm-screen');
  await expect(async () => {
    await page.mouse.move(point.x, point.y + 60);
    await page.mouse.move(point.x, point.y);
    await expect(screenEl).toHaveClass(/xterm-cursor-pointer/, { timeout: 500 });
  }).toPass({ timeout: 5000 });
}

async function cmdClick(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Meta');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Meta');
}

test("Cmd+click opens a link from the terminal; a plain click doesn't", async () => {
  const { app, page, dataDir } = await launchApp();
  const a = await startTask(page);
  await run(page, PRINT_LINKS);
  await expect.poll(() => screen(page, a)).toContain('bad: bad-link');
  const plain = await pointOn(page, a, 'plain: ', 'https://example.com/plain');
  const osc8 = await pointOn(page, a, 'osc8: ', 'label');
  const bad = await pointOn(page, a, 'bad: ', 'bad-link');

  // A plain click on either link opens nothing.
  for (const link of [plain, osc8]) {
    await hover(page, link);
    await page.mouse.click(link.x, link.y);
  }

  // With Cmd held each opens once. The file link between them opens nothing: a record of it would
  // sit between the two, since main handles the clicks in order.
  await hover(page, plain);
  await cmdClick(page, plain);
  await page.mouse.move(bad.x, bad.y);
  await cmdClick(page, bad);
  await hover(page, osc8);
  await cmdClick(page, osc8);

  await expect.poll(() => openedLinks(dataDir)).toEqual(['https://example.com/plain', 'https://example.com/osc8']);
  await app.close();
});
