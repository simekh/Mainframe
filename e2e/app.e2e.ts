import { test, expect } from '@playwright/test';
import { cleanUp, launchAgain, launchApp } from './launch';
import { launches, screen, sendLine, startTask } from './tasks';

test.afterEach(cleanUp);

test('opens the TheSource window', async () => {
  const { app, page } = await launchApp();
  expect(await page.title()).toBe('TheSource');
  await app.close();
});

test('opened again on the same data folder, TheSource quits and its tasks keep running once', async () => {
  const { app, page, dataDir } = await launchApp();
  const id = await startTask(page);
  expect(launches(dataDir)).toHaveLength(1);

  expect(await launchAgain(dataDir)).toBe(0);
  // A second TheSource that had started would have reopened the open task.
  expect(launches(dataDir)).toHaveLength(1);
  await sendLine(page, id, 'echo first-$((1+1))');
  await expect.poll(() => screen(page, id)).toContain('first-2');
  await app.close();
});
