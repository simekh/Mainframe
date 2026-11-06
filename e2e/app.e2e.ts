import { test, expect } from '@playwright/test';
import { cleanUp, launchAgain, launchApp } from './launch';
import { launches, screen, sendLine, startTask } from './tasks';

test.afterEach(cleanUp);

test('opens the Mainframe window', async () => {
  const { app, page } = await launchApp();
  expect(await page.title()).toBe('Mainframe');
  await app.close();
});

test('opened again on the same data folder, Mainframe quits and its tasks keep running once', async () => {
  const { app, page, dataDir } = await launchApp();
  const id = await startTask(page);
  expect(launches(dataDir)).toHaveLength(1);
  await app.evaluate(({ app: main }) => {
    const seen = globalThis as { secondLaunches?: number };
    seen.secondLaunches = 0;
    main.on('second-instance', () => (seen.secondLaunches! += 1));
  });

  expect(await launchAgain(dataDir)).toBe(0);
  // A second Mainframe that had started would have reopened the open task.
  expect(launches(dataDir)).toHaveLength(1);
  // The first one heard of it, which brings its window forward.
  await expect.poll(() => app.evaluate(() => (globalThis as { secondLaunches?: number }).secondLaunches)).toBe(1);
  await sendLine(page, id, 'echo first-$((1+1))');
  await expect.poll(() => screen(page, id)).toContain('first-2');
  await app.close();
});
