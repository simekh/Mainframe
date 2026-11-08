import { test, expect } from '@playwright/test';
import { cleanUp, launchApp, setWindowWidth } from './launch';
import { box, card, firstSpawn, fitSize, screen, sendLine, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

test("dragging the panel's edge sets its width, and a restart keeps it", async () => {
  const first = await launchApp();
  await setWindowWidth(first.app, first.page, 1600);
  const handle = first.page.getByTestId('panel-resize');
  const before = (await box(first.page, 'side-panel')).width;
  const edge = await box(first.page, 'panel-resize');
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  // Narrower: the window leaves it its own width beside the manager's column and the board.
  await first.page.mouse.move(x, y);
  await first.page.mouse.down();
  await first.page.mouse.move(x + 200, y, { steps: 8 });
  await first.page.mouse.up();
  const dragged = (await box(first.page, 'side-panel')).width;
  expect(Math.abs(dragged - (before - 200))).toBeLessThanOrEqual(2);
  await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(dragged)));

  // The arrow keys move the edge too: left widens.
  await handle.focus();
  await first.page.keyboard.press('ArrowLeft');
  await first.page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(dragged) + 32));
  const keyed = (await box(first.page, 'side-panel')).width;
  expect(Math.abs(keyed - (dragged + 32))).toBeLessThanOrEqual(2);
  await first.app.close();

  const { app, page } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir });
  await setWindowWidth(app, page, 1600);
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
  // Room for the pinned panel at its own width, so unpinning it changes nothing.
  await setWindowWidth(app, page, 1600);
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

// The pill that shows the panel focuses the hide pill inside it. Left to scroll, the browser brings
// that pill into view while the panel is still out past the window's edge, and the whole window
// slides sideways until the panel is in. Every measurement is taken inside the page, on each frame.
test('showing the hidden panel with its button moves nothing sideways', async () => {
  const { app, page } = await launchApp();
  // Room for the pinned panel at its own width, so unpinning it changes nothing.
  await setWindowWidth(app, page, 1600);
  const id = await startTask(page);
  const size = (await termSize(page, id))!;
  const panel = page.getByTestId('side-panel');
  // With reduced motion the panel jumps in and nothing is left to scroll: the slide must be there.
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.getByTestId('panel-pin').click();
  await page.getByTestId('panel-hide').click();
  // Hidden means the slide out is over: shown too early, the panel is still near its place.
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('panel-show')).toBeFocused();

  // Whatever scrolls sideways while the panel comes in: the page itself or any element in it.
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { sideways: string[] }).sideways = []);
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement! : (e.target as Element);
      if (el.scrollLeft > 0) seen.push(el.getAttribute('data-testid') || el.className || el.tagName.toLowerCase());
    };
    document.addEventListener('scroll', onScroll, true);
  });

  await page.getByTestId('panel-show').click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await panel.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (window as unknown as { sideways: string[] }).sideways)).toEqual([]);

  await expect(page.getByTestId('panel-hide')).toBeFocused();
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});

// Review Focus 3. At a start, the unpinned panel is out (with nothing selected it shows the empty
// state), so a hidden start is a task started while the owner has put the panel away.
test('a task started while the unpinned panel is hidden starts at the size its terminal shows', async () => {
  const { app, page } = await launchApp();
  // Pinned first: a new task's session starts at the size its terminal shows, and that fills the
  // well. A task selected also means hiding hides only the panel, not the well inside it.
  const alpha = await startTask(page, 'Alpha');
  const shown = (await termSize(page, alpha))!;
  expect(await firstSpawn(page, alpha)).toEqual(shown);
  expect(await fitSize(page, alpha)).toEqual(shown);

  await page.getByTestId('panel-pin').click();
  await page.getByTestId('panel-hide').click();
  await expect(page.getByTestId('side-panel')).toBeHidden();

  const id = await startTask(page, 'Beta');
  await expect(page.getByTestId('side-panel')).toHaveAttribute('data-open', 'true');
  const size = (await termSize(page, id))!;
  expect(await firstSpawn(page, id)).toEqual(size);
  expect(await fitSize(page, id)).toEqual(size);
  await sendLine(page, id, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});
