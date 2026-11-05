import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { cardIn, run, sendLine, startTask } from './tasks';

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
