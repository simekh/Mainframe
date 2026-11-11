import { test, expect } from '@playwright/test';
import { cleanUp, launchApp, setWindowWidth } from './launch';
import {
  box, card, edgesWhile, expectSlide, expectStripAt, firstSpawn, fitSize, ROW_HEIGHT, screen, sendLine, settled, startTask, termSize,
} from './tasks';

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
  // From under the top row to 8 px above the window's bottom.
  const height = await page.evaluate(() => window.innerHeight);
  expect([panel.y, panel.y + panel.height]).toEqual([ROW_HEIGHT, height - 8]);
  await app.close();
});

test('unpinned, a press on the board folds the panel into its strip, which stays beside it while it is out; a card or the strip brings it out, and its terminal keeps its size', async () => {
  const { app, page } = await launchApp();
  // Room for the pinned panel at its own width, so unpinning it changes nothing.
  await setWindowWidth(app, page, 1600);
  const id = await startTask(page);
  const size = (await termSize(page, id))!;
  const panel = page.getByTestId('side-panel');
  const strip = page.getByTestId('panel-strip');

  await page.getByTestId('panel-pin').click();
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(page.getByTestId('panel-pin')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveAttribute('data-open', 'true');
  // Out beside its strip, not over it.
  await expect(strip).toBeVisible();
  const out = await box(page, 'side-panel');
  expect(out.x + out.width).toBeLessThanOrEqual((await box(page, 'panel-strip')).x);
  expect(await termSize(page, id)).toEqual(size);

  // The bottom of the first lane, under its cards.
  const board = await box(page, 'board');
  await page.getByTestId('board').click({ position: { x: 40, y: board.height - 40 } });
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(panel).toBeHidden();
  await expect(strip).toBeVisible();
  expect(await termSize(page, id)).toEqual(size);

  await card(page, id).click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(panel).toBeVisible();
  expect(await termSize(page, id)).toEqual(size);

  await page.getByTestId('panel-fold').click();
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(strip).toBeFocused();
  // A folded session that comes to need the owner shows from its strip.
  await sendLine(page, id, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(strip.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'ask');
  await expect(strip).toHaveAccessibleName('Show Task, Needs input');
  expect(await termSize(page, id)).toEqual(size);

  await strip.click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('panel-fold')).toBeFocused();

  await sendLine(page, id, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});

// Review Focus 1. A clamp that counted the panel's own strip would narrow it as it folds, and its terminal with it.
test("pinned, the panel folds into a strip at its pane's right edge and gives the board its room; a card or the strip opens it, and a panel at its widest keeps its width and its terminal's size", async () => {
  const { app, page } = await launchApp();
  await setWindowWidth(app, page, 1600);
  // The slide is what the frames below follow.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const id = await startTask(page);
  const panel = page.getByTestId('side-panel');
  const strip = page.getByTestId('panel-strip');
  const fold = page.getByTestId('panel-fold');
  await expect(panel).toHaveAttribute('data-pinned', 'true');

  // At its widest: left widens.
  const handle = page.getByTestId('panel-resize');
  await handle.focus();
  const max = (await handle.getAttribute('aria-valuemax'))!;
  for (let i = 0; i < 50 && (await handle.getAttribute('aria-valuenow')) !== max; i++) await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', max);
  await settled(page);
  const open = await box(page, 'side-panel');
  const size = (await termSize(page, id))!;
  const pane = await box(page, 'project-pane');
  // Pinned and open, it has no strip.
  await expect(strip).toHaveCount(0);

  // It slides away from where it stood, never stepping left first to where a floating panel sits, and ends past the
  // pane's edge.
  const folding = await edgesWhile(page, 'side-panel', 'right', () => fold.click());
  expectSlide(folding, 'right', { from: open.x + open.width });
  expect(folding.at(-1)! - open.width).toBeGreaterThanOrEqual(pane.x + pane.width);
  await expect(panel).toBeHidden();
  await expect(strip).toBeFocused();
  expectStripAt(await box(page, 'panel-strip'), 'right', pane.x + pane.width - 8);
  const board = await box(page, 'board');
  expect(board.x + board.width).toBeGreaterThan(open.x);
  expect(await termSize(page, id)).toEqual(size);

  await card(page, id).click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(panel).toBeVisible();
  // Measured as it may still slide in, where its box can come out a fraction of a pixel off.
  expect((await box(page, 'side-panel')).width).toBeCloseTo(open.width, 0);
  expect(await termSize(page, id)).toEqual(size);

  await fold.click();
  await expect(panel).toBeHidden();
  // From the strip it slides back in and lands where it stood, without a step at either end.
  const opening = await edgesWhile(page, 'side-panel', 'right', () => strip.click());
  expectSlide(opening, 'left', { to: open.x + open.width });
  await expect(panel).toBeVisible();
  await expect(fold).toBeFocused();
  expect((await box(page, 'side-panel')).width).toBeCloseTo(open.width, 0);
  expect(await termSize(page, id)).toEqual(size);
  await sendLine(page, id, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  await expect(strip).toHaveCount(0);
  await app.close();
});

// Review Focus 4.
test('before the owner folds or opens it, the session panel follows its pin as shown; once folded, it stays folded', async () => {
  const { app, page } = await launchApp();
  const panel = page.getByTestId('side-panel');
  const strip = page.getByTestId('panel-strip');

  // A 1004 px pane can't pin it beside the 400 px manager: it floats, so it starts folded.
  await setWindowWidth(app, page, 1200);
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(strip).toBeVisible();

  await setWindowWidth(app, page, 1600);
  await expect(panel).toHaveAttribute('data-pinned', 'true');
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(strip).toHaveCount(0);

  await page.getByTestId('panel-fold').click();
  await setWindowWidth(app, page, 1200);
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(panel).toHaveAttribute('data-open', 'false');
  await setWindowWidth(app, page, 1600);
  await expect(panel).toHaveAttribute('data-pinned', 'true');
  await expect(panel).toHaveAttribute('data-open', 'false');
  await app.close();
});

// The strip that opens the panel focuses the fold button inside it. Left to scroll, the browser brings
// that button into view while the panel is still out past the window's edge, and the whole window
// slides sideways until the panel is in. Every measurement is taken inside the page, on each frame.
test('opening the folded panel from its strip moves nothing sideways', async () => {
  const { app, page } = await launchApp();
  // Room for the pinned panel at its own width, so unpinning it changes nothing.
  await setWindowWidth(app, page, 1600);
  const id = await startTask(page);
  const size = (await termSize(page, id))!;
  const panel = page.getByTestId('side-panel');
  // With reduced motion the panel jumps in and nothing is left to scroll: the slide must be there.
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.getByTestId('panel-pin').click();
  await page.getByTestId('panel-fold').click();
  // Hidden means the slide out is over: shown too early, the panel is still near its place.
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('panel-strip')).toBeFocused();

  // Whatever scrolls sideways while the panel comes in: the page itself or any element in it.
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { sideways: string[] }).sideways = []);
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement! : (e.target as Element);
      if (el.scrollLeft > 0) seen.push(el.getAttribute('data-testid') || el.className || el.tagName.toLowerCase());
    };
    document.addEventListener('scroll', onScroll, true);
  });

  await page.getByTestId('panel-strip').click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await panel.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (window as unknown as { sideways: string[] }).sideways)).toEqual([]);

  await expect(page.getByTestId('panel-fold')).toBeFocused();
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});

// Review Focus 3. A folded start is a task started while the owner has folded the panel.
test('a task started while the unpinned panel is folded starts at the size its terminal shows', async () => {
  const { app, page } = await launchApp();
  // Pinned first: a new task's session starts at the size its terminal shows, and that fills the
  // well. A task selected also means folding hides only the panel, not the well inside it.
  const alpha = await startTask(page, 'Alpha');
  const shown = (await termSize(page, alpha))!;
  expect(await firstSpawn(page, alpha)).toEqual(shown);
  expect(await fitSize(page, alpha)).toEqual(shown);

  await page.getByTestId('panel-pin').click();
  await page.getByTestId('panel-fold').click();
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
