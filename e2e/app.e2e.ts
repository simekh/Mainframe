import { mkdtempSync, readFileSync } from 'node:fs';
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

test('Open Project… opens the picked folder beside the open one and shows it, without a restart', async () => {
  const { app, page, dataDir } = await launchApp();
  const projectsFile = join(dataDir, 'projects.json');
  const [first] = JSON.parse(readFileSync(projectsFile, 'utf8')).open;
  const picked = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-project-')));
  // Main looks the dialog up at each call.
  await app.evaluate(({ dialog, Menu }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    Menu.getApplicationMenu()!.getMenuItemById('open-project')!.click();
  }, picked);

  await expect(page.getByTestId('rail-project')).toHaveCount(2);
  await expect(page.locator(`[data-testid=project-pane][data-project="${picked}"]`)).toHaveAttribute('data-shown', 'true');
  expect(JSON.parse(readFileSync(projectsFile, 'utf8'))).toEqual({ version: 1, open: [first, picked] });
  await app.close();
});

test('Open Project… says why it could not open the folder', async () => {
  const { app } = await launchApp();
  await app.evaluate(({ dialog, Menu }) => {
    const seen = globalThis as { errorBoxes?: string[] };
    seen.errorBoxes = [];
    dialog.showOpenDialog = async () => {
      throw new Error('the dialog failed');
    };
    dialog.showErrorBox = (title, content) => void seen.errorBoxes!.push(`${title}: ${content}`);
    Menu.getApplicationMenu()!.getMenuItemById('open-project')!.click();
  });

  await expect
    .poll(() => app.evaluate(() => (globalThis as { errorBoxes?: string[] }).errorBoxes))
    .toEqual(['Mainframe could not open the project: the dialog failed']);
  await app.close();
});
