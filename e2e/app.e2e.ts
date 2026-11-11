import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { cleanUp, launchAgain, launchApp, removeAfterTest } from './launch';
import { answerDialogs, launches, projectPane, screen, sendLine, sessionLaunches, startTask } from './tasks';

test.afterEach(cleanUp);

/** Picks Open Project…: in the Mac's File menu, and on Windows and Linux, which have no menu, under the project list. */
async function clickOpenProject(app: ElectronApplication, page: Page): Promise<void> {
  if (process.platform === 'darwin') {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('open-project')!.click());
  } else {
    await page.getByTestId('open-project').click();
  }
}

test('opens the Mainframe window', async () => {
  const { app, page } = await launchApp();
  expect(await page.title()).toBe('Mainframe');
  await app.close();
});

test('the window follows its system: the Mac keeps its menu and the room for its window buttons; Windows and Linux have neither', async () => {
  const { app, page } = await launchApp();
  const onMac = process.platform === 'darwin';
  if (onMac) {
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('open-project') != null)).toBe(true);
  } else {
    const bar = await app.evaluate(({ BrowserWindow, Menu }) => ({
      appMenu: Menu.getApplicationMenu() !== null,
      menuBarVisible: BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
    }));
    expect(bar).toEqual({ appMenu: false, menuBarVisible: false });
  }
  await expect(page.locator('html')).toHaveAttribute('data-platform', process.platform);
  // The top row's start leaves the window buttons their room on the Mac, and the frame's 8 px elsewhere.
  await expect(page.locator('.top-row')).toHaveCSS('padding-left', onMac ? '80px' : '8px');
  // Windows still drags a framed window by a page's drag region, so the page has them on the Mac only.
  await expect(page.locator('.top-row')).toHaveCSS('-webkit-app-region', onMac ? 'drag' : 'none');
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

test('Quit waits for the sessions it hangs up on to end', async () => {
  test.skip(process.platform === 'win32', 'Windows has no hang-up: its kill ends a session outright');
  // Each session ends a second after its hang-up, as a real claude saving its chat may.
  const { app, page, dataDir } = await launchApp({ FAKE_CLAUDE_HANGUP_DELAY_MS: '1000' });
  await startTask(page);
  const sessions = sessionLaunches(dataDir);
  expect(sessions).toHaveLength(2);
  await app.close();
  // One still running when the app goes is hung up on again, and ends with no record.
  expect(sessions.filter((s) => !existsSync(s.file.replace(/\.argv$/, '.ended')))).toEqual([]);
});

test('Open Project… opens the picked folder beside the open one and shows it, without a restart', async () => {
  const { app, page, dataDir } = await launchApp();
  const projectsFile = join(dataDir, 'projects.json');
  const [first] = JSON.parse(readFileSync(projectsFile, 'utf8')).open;
  const picked = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-project-')));
  await answerDialogs(app, picked);
  await clickOpenProject(app, page);

  await expect(page.getByTestId('rail-project')).toHaveCount(2);
  await expect(projectPane(page, picked)).toHaveAttribute('data-shown', 'true');
  expect(JSON.parse(readFileSync(projectsFile, 'utf8'))).toEqual({ version: 1, open: [first, picked] });
  await app.close();
});

test('Ctrl+Shift+O opens Open Project… on Windows and Linux', async () => {
  test.skip(process.platform === 'darwin', "a Windows and Linux key: the Mac's is the menu's Cmd+O, which keys pressed in the page never reach");
  const { app, page } = await launchApp();
  const picked = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-project-')));
  await answerDialogs(app, picked);
  await page.keyboard.press('Control+Shift+O');

  await expect(page.getByTestId('rail-project')).toHaveCount(2);
  await expect(projectPane(page, picked)).toHaveAttribute('data-shown', 'true');
  await app.close();
});

test('Open Project… says why it could not open the folder', async () => {
  const { app, page } = await launchApp();
  await app.evaluate(({ dialog }) => {
    const seen = globalThis as { errorBoxes?: string[] };
    seen.errorBoxes = [];
    dialog.showOpenDialog = async () => {
      throw new Error('the dialog failed');
    };
    dialog.showErrorBox = (title, content) => void seen.errorBoxes!.push(`${title}: ${content}`);
  });
  await clickOpenProject(app, page);

  await expect
    .poll(() => app.evaluate(() => (globalThis as { errorBoxes?: string[] }).errorBoxes))
    .toEqual(['Mainframe could not open the project: the dialog failed']);
  await app.close();
});
