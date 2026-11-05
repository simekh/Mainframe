import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { cardIn, run, screen, sendLine, startTask } from './tasks';

test.afterEach(cleanUp);

type Counted = Window & { __cardFlies?: number };

/** Counts every `.card-fly` copy added to the page from now on. */
async function countFlies(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as Counted;
    w.__cardFlies = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('card-fly')) w.__cardFlies! += 1;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as Counted).__cardFlies ?? 0);
}

test('a card that changes lanes flies there once, and nothing flies with reduced motion', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  await expect(cardIn(page, 'working', id)).toHaveCount(1);
  const flies = await countFlies(page);

  await run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(cardIn(page, 'needs-you', id)).toHaveCount(1);
  expect(await flies()).toBe(1);
  await page.waitForTimeout(1000);
  await expect(page.locator('.card-fly')).toHaveCount(0);
  const hidden = await page
    .getByTestId('task-card')
    .evaluateAll((cards) => cards.filter((el) => getComputedStyle(el).visibility === 'hidden').length);
  expect(hidden).toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await run(page, "printf '\\033]7501;state=working\\033\\\\'");
  await expect(cardIn(page, 'working', id)).toHaveCount(1);
  expect(await flies()).toBe(1);
  await app.close();
});

type Watched = Window & { __cardSpots?: string[] };

/**
 * Records, from now on and in order, each `lane glyph` the task's card shows: a lane when a card
 * for it is added to one, a glyph each time its glyph changes. Repeats are left out.
 */
async function watchCard(page: Page, taskId: string): Promise<() => Promise<string[]>> {
  await page.evaluate((id) => {
    const selector = `[data-testid=task-card][data-task-id="${id}"]`;
    const spots: string[] = [];
    (window as Watched).__cardSpots = spots;
    const note = (card: Element, glyph: string | null | undefined) => {
      const spot = `${card.getAttribute('data-lane')} ${glyph}`;
      if (spots.at(-1) !== spot) spots.push(spot);
    };
    const glyphOf = (card: Element) => card.querySelector('[data-testid=task-glyph]')?.getAttribute('data-glyph');
    note(document.querySelector(selector)!, glyphOf(document.querySelector(selector)!));
    new MutationObserver((records) => {
      records.forEach((record, i) => {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.matches(selector)) note(node, glyphOf(node));
          }
          return;
        }
        const card = (record.target as Element).closest(selector);
        if (!card) return;
        // The value it changed to: the old value of its next change in this batch, or what it holds now.
        const next = records.slice(i + 1).find((r) => r.type === 'attributes' && r.target === record.target);
        note(card, next ? next.oldValue : (record.target as Element).getAttribute('data-glyph'));
      });
    }).observe(document.querySelector('.lanes')!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-glyph'],
      attributeOldValue: true,
    });
  }, taskId);
  return () => page.evaluate(() => (window as Watched).__cardSpots ?? []);
}

test('a session that is closed goes straight to Closed, from Working and from Needs you', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  await sendLine(page, a, "printf '\\033]7501;state=working\\033\\\\'");
  await expect(cardIn(page, 'working', a).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  const b = await startTask(page, 'Beta');
  await sendLine(page, b, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(cardIn(page, 'needs-you', b)).toHaveCount(1);

  for (const [id, from] of [[a, 'working spin'], [b, 'needs-you ask']]) {
    const spots = await watchCard(page, id);
    await page.evaluate((taskId) => window.thesource.closeTask(taskId), id);
    await expect(cardIn(page, 'closed', id)).toHaveCount(1);
    await expect.poll(() => screen(page, id)).toContain('[Process exited]');
    expect(await spots()).toEqual([from, 'closed dot']);
  }
  await app.close();
});

const focusIsIn = (page: Page, taskId: string) =>
  page.evaluate(
    (id) => document.activeElement?.closest('[data-testid=task-card]')?.getAttribute('data-task-id') === id,
    taskId,
  );

test('a focused card keeps the focus when it changes lanes', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  await cardIn(page, 'working', id).locator('.card-title').focus();

  // It flies, so it can take the focus only once it has landed.
  await sendLine(page, id, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(cardIn(page, 'needs-you', id)).toHaveCount(1);
  await expect.poll(() => focusIsIn(page, id)).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sendLine(page, id, "printf '\\033]7501;state=working\\033\\\\'");
  await expect(cardIn(page, 'working', id)).toHaveCount(1);
  await expect.poll(() => focusIsIn(page, id)).toBe(true);
  await app.close();
});
