import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, firstSpawn, screen, sendLine, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test("dragging the panel's edge sets its width, and a restart keeps it", async () => {
  const first = await launchApp();
  const handle = first.page.getByTestId('panel-resize');
  const before = (await box(first.page, 'side-panel')).width;
  const edge = await box(first.page, 'panel-resize');
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  await first.page.mouse.move(x, y);
  await first.page.mouse.down();
  await first.page.mouse.move(x - 200, y, { steps: 8 });
  await first.page.mouse.up();
  const dragged = (await box(first.page, 'side-panel')).width;
  expect(Math.abs(dragged - (before + 200))).toBeLessThanOrEqual(2);
  await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(dragged)));

  // The arrow keys move the edge too: left widens.
  await handle.focus();
  await first.page.keyboard.press('ArrowLeft');
  await first.page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(dragged) + 32));
  const keyed = (await box(first.page, 'side-panel')).width;
  expect(Math.abs(keyed - (dragged + 32))).toBeLessThanOrEqual(2);
  await first.app.close();

  const { app, page } = await launchApp({ THESOURCE_DATA_DIR: first.dataDir });
  expect(Math.abs((await box(page, 'side-panel')).width - keyed)).toBeLessThanOrEqual(2);
  await app.close();
});

test('the pinned panel sits beside the board', async () => {
  const { app, page } = await launchApp();
  await expect(page.getByTestId('side-panel')).toHaveAttribute('data-pinned', 'true');
  const board = await box(page, 'board');
  const panel = await box(page, 'side-panel');
  expect(board.x + board.width).toBeLessThanOrEqual(panel.x);
  // The full height of the window, 8 px in: the top bar doesn't cross it.
  const height = await page.evaluate(() => window.innerHeight);
  expect([panel.y, panel.y + panel.height]).toEqual([8, height - 8]);
  await app.close();
});

test('unpinned, the panel hides when the board is clicked and comes back when a card is clicked, without resizing the terminal', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  const size = (await termSize(page, id))!;
  const panel = page.getByTestId('side-panel');

  await page.getByTestId('panel-pin').click();
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(page.getByTestId('panel-pin')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveAttribute('data-open', 'true');
  expect(await termSize(page, id)).toEqual(size);

  // The bottom of the first lane, under its cards.
  const board = await box(page, 'board');
  await page.getByTestId('board').click({ position: { x: 40, y: board.height - 40 } });
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(panel).toBeHidden();
  expect(await termSize(page, id)).toEqual(size);

  await card(page, id).click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(panel).toBeVisible();
  expect(await termSize(page, id)).toEqual(size);

  await page.getByTestId('panel-hide').click();
  await expect(panel).toHaveAttribute('data-open', 'false');
  const show = page.getByTestId('panel-show');
  await expect(show).toBeVisible();
  await expect(show).toBeFocused();
  // A hidden session that comes to need the owner shows from there.
  await sendLine(page, id, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(show.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'ask');
  await expect(show).toHaveAccessibleName('Show panel, Needs input');
  expect(await termSize(page, id)).toEqual(size);

  await show.click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('panel-hide')).toBeFocused();
  await expect(show).toBeHidden();

  await sendLine(page, id, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});

// Review Focus 3. At a start, the unpinned panel is out (with nothing selected it shows the empty
// state), so a hidden start is a task started while the owner has put the panel away.
test('a task started while the unpinned panel is hidden starts at the size its terminal shows', async () => {
  const { app, page } = await launchApp();
  // A task selected first, so only the panel is hidden, not the terminal well inside it.
  await startTask(page, 'Alpha');
  await page.getByTestId('panel-pin').click();
  await page.getByTestId('panel-hide').click();
  await expect(page.getByTestId('side-panel')).toBeHidden();

  const id = await startTask(page, 'Beta');
  await expect(page.getByTestId('side-panel')).toHaveAttribute('data-open', 'true');
  const spawned = (await firstSpawn(page, id))!;
  expect(spawned.panelShown).toBe(false);
  const size = (await termSize(page, id))!;
  expect({ cols: spawned.cols, rows: spawned.rows }).toEqual(size);
  await sendLine(page, id, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});
