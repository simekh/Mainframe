import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanUp, launchAgain, launchApp, removeAfterTest } from './launch';
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

test('Open Project… remembers the picked folder and restarts Mainframe on it', async () => {
  const { app, dataDir } = await launchApp();
  const picked = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-project-')));
  const relaunched = join(dataDir, 'relaunched');
  // The dialog answers with the folder, and the restart only leaves a mark: a real one would start
  // a Mainframe this test doesn't control. Main looks both up at each call.
  await app.evaluate(({ app: main, dialog, Menu }, { folder, mark }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    main.relaunch = () => process.getBuiltinModule('node:fs').writeFileSync(mark, '');
    Menu.getApplicationMenu()!.getMenuItemById('open-project')!.click();
  }, { folder: picked, mark: relaunched });

  await app.waitForEvent('close');
  expect(existsSync(relaunched)).toBe(true);
  expect(JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8'))).toEqual({ version: 1, open: [picked] });
});
