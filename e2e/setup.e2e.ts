import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { findExecutable } from '../src/main/pty/findExecutable';
import { localFiles } from '../src/main/pty/sessionHost';
import { pathKey } from '../src/main/pty/spawnEnv';
import { readSettings } from '../src/main/setup/settings';
import { MIN_CLAUDE_VERSION } from '../src/shared/types';
import { cleanUp, fakeClaude, launchApp, removeAfterTest } from './launch';
import { openedLinks, repo } from './tasks';

test.afterEach(cleanUp);

const claudeFile = process.platform === 'win32' ? 'claude.exe' : 'claude';

/** The git on the developer's own PATH, which the stand-in computers are given. */
function systemGit(): string {
  const found = findExecutable('git', {
    env: process.env as Record<string, string>,
    cwd: process.cwd(),
    platform: process.platform,
    files: localFiles,
  });
  if (found === null) throw new Error('the setup tests need git on PATH');
  return found;
}

/**
 * A computer with nothing but node, and git unless `o.git` is false: the app's PATH holds only those,
 * and HOME, USERPROFILE and APPDATA name an empty folder (on Windows one with the AppData\Roaming
 * Electron needs), so no claude of the developer's can be found and `MAINFRAME_CLAUDE_BIN` is unset.
 * On POSIX PATH is a folder of links, as the stand-in for claude is a script that runs `node`; on
 * Windows it is node's own folder and Git's own folder.
 */
function computer(o: { git?: boolean } = {}) {
  const home = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-home-')));
  let dirs: string[];
  if (process.platform === 'win32') {
    // Electron on Windows crashes at launch (exit 0x80000003) when USERPROFILE names a folder with no
    // AppData\Roaming in it. CI run 3: with only that folder in it, Electron launched; with an empty one,
    // one holding only AppData\Local, or C:\Users\Public (no AppData at all), it crashed.
    mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true });
    dirs = [dirname(process.execPath), ...(o.git === false ? [] : [dirname(systemGit())])];
  } else {
    const bin = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-bin-')));
    symlinkSync(process.execPath, join(bin, 'node'));
    if (o.git !== false) symlinkSync(systemGit(), join(bin, 'git'));
    dirs = [bin];
  }
  const env: Record<string, string | undefined> = {
    MAINFRAME_CLAUDE_BIN: undefined,
    // Windows spells it `Path` in process.env, and the app must get one key, not two.
    [pathKey(process.env, process.platform) ?? 'PATH']: dirs.join(delimiter),
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
  };
  return {
    env,
    home,
    /** Puts a copy of the stand-in where the native installer puts claude, and returns its path. */
    installClaude(): string {
      const file = join(home, '.local', 'bin', claudeFile);
      mkdirSync(dirname(file), { recursive: true });
      copyFileSync(fakeClaude, file);
      return file;
    },
  };
}

/** Answers the file or folder dialog, which main looks up at each call: with `picked`, or null for a cancel. */
function answerDialogs(app: ElectronApplication, picked: string | null): Promise<void> {
  return app.evaluate(({ dialog }, answer) => {
    const seen = globalThis as { dialogCalls?: number };
    seen.dialogCalls = 0;
    dialog.showOpenDialog = async () => {
      seen.dialogCalls! += 1;
      return answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [answer] };
    };
  }, picked);
}

const dialogCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as { dialogCalls?: number }).dialogCalls);

const savedSettings = (dataDir: string) =>
  readSettings(dataDir, (msg) => {
    throw new Error(msg);
  });

const check = (page: Page, name: 'git' | 'claude') => page.getByTestId(`setup-${name}`);
const button = (page: Page, name: string) => page.getByTestId(`setup-${name}`);
const welcome = (page: Page) => page.getByText("Hi, I'm Mainframe.");

/** The project's pane is the one on show: the board has opened it. */
const boardShows = (page: Page, project: string) =>
  expect(page.locator(`[data-testid=project-pane][data-project=${JSON.stringify(project)}]`)).toHaveAttribute('data-shown', 'true');

test('a first start welcomes you, finds everything and asks for the first project', async () => {
  const pc = computer();
  const claude = pc.installClaude();
  const project = repo();
  const { app, page, dataDir } = await launchApp(pc.env, undefined, { firstStart: true });

  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(welcome(page)).toBeVisible();
  await expect(check(page, 'git')).toHaveAttribute('data-state', 'found');
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'found');
  await expect(check(page, 'claude')).toContainText(`${claude} · v2.1.999`);
  await expect(page.getByTestId('new-task')).toHaveCount(0);
  // The welcome counts as seen only once a project is chosen.
  expect(savedSettings(dataDir)).toEqual({});

  await answerDialogs(app, project);
  await button(page, 'choose-project').click();

  await boardShows(page, project);
  await expect(page.getByTestId('new-task')).toBeVisible();
  await expect(page.getByTestId('setup')).toHaveCount(0);
  expect(savedSettings(dataDir)).toEqual({ welcomeSeen: true, claudeBin: claude });
  await app.close();
});

test('claude missing: Find claude… checks the file and saves it', async () => {
  const pc = computer();
  const project = repo();
  const { app, page, dataDir } = await launchApp(pc.env, undefined, { firstStart: true });

  await expect(check(page, 'git')).toHaveAttribute('data-state', 'found');
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'missing');
  await expect(check(page, 'claude')).toContainText('not found');
  await expect(button(page, 'find-claude')).toBeVisible();
  await expect(button(page, 'install-claude')).toBeVisible();
  await expect(button(page, 'look-again')).toBeVisible();
  await expect(button(page, 'choose-project')).toHaveCount(0);

  await button(page, 'install-claude').click();
  await expect.poll(() => openedLinks(app)).toEqual(['https://code.claude.com/docs/en/setup']);

  await answerDialogs(app, fakeClaude);
  await button(page, 'find-claude').click();

  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'found');
  await expect(check(page, 'claude')).toContainText(`${fakeClaude} · v2.1.999`);
  expect(savedSettings(dataDir)).toEqual({ claudeBin: fakeClaude });

  await answerDialogs(app, project);
  await button(page, 'choose-project').click();

  await boardShows(page, project);
  expect(savedSettings(dataDir)).toEqual({ welcomeSeen: true, claudeBin: fakeClaude });
  await app.close();
});

test('a claude too old says to update', async () => {
  const pc = computer();
  const claude = pc.installClaude();
  // The stand-in holds each answer back, so the screen is seen "looking…" while Look again runs.
  const env = { ...pc.env, FAKE_CLAUDE_VERSION: '2.1.200', FAKE_CLAUDE_VERSION_DELAY_MS: '500' };
  const { app, page } = await launchApp(env, undefined, { firstStart: true });

  const update = `This Claude Code is v2.1.200, and I need v${MIN_CLAUDE_VERSION} or newer. Run claude update in a terminal, then I'll look again.`;
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'too-old');
  await expect(check(page, 'claude')).toContainText(`${claude} · v2.1.200, too old`);
  await expect(page.getByTestId('setup')).toContainText(update);
  await expect(button(page, 'look-again')).toBeVisible();
  await expect(button(page, 'find-claude')).toBeVisible();
  await expect(button(page, 'install-claude')).toHaveCount(0);

  await button(page, 'look-again').click();
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'looking');
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'too-old');
  await expect(check(page, 'claude')).toContainText(`${claude} · v2.1.200, too old`);
  await expect(page.getByTestId('setup')).toContainText(update);
  // The new view changes the screen's lines in place, so the button pressed keeps the focus.
  await expect(button(page, 'look-again')).toBeFocused();
  await app.close();
});

test('git missing offers only How to install and Look again', async () => {
  const pc = computer({ git: false });
  pc.installClaude();
  const { app, page } = await launchApp(pc.env, undefined, { firstStart: true });

  await expect(check(page, 'git')).toHaveAttribute('data-state', 'missing');
  await expect(check(page, 'git')).toContainText('not found');
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'found');
  await expect(button(page, 'install-git')).toBeVisible();
  await expect(button(page, 'look-again')).toBeVisible();
  for (const other of ['find-claude', 'install-claude', 'choose-project']) await expect(button(page, other)).toHaveCount(0);

  await button(page, 'install-git').click();
  await expect.poll(() => openedLinks(app)).toEqual(['https://git-scm.com/downloads']);

  // Git is still not on PATH: the screen says so, and that a program installed since needs a new start.
  await button(page, 'look-again').click();
  await expect(page.getByTestId('setup')).toContainText('Just installed it?');
  await expect(check(page, 'git')).toHaveAttribute('data-state', 'missing');
  await app.close();
});

test("a later start whose claude has moved comes back with 'Something moved'", async () => {
  const pc = computer();
  const project = repo();
  const gone = join(pc.home, 'elsewhere', claudeFile);
  const { app, page, dataDir } = await launchApp(pc.env, project, { settings: { welcomeSeen: true, claudeBin: gone } });

  await expect(page.getByText('Something moved since last time, so I had another look around.')).toBeVisible();
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'missing');
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.getByTestId('new-task')).toHaveCount(0);

  const claude = pc.installClaude();
  await button(page, 'look-again').click();

  await boardShows(page, project);
  await expect(page.getByTestId('new-task')).toBeVisible();
  await expect(page.getByTestId('setup')).toHaveCount(0);
  expect(savedSettings(dataDir)).toEqual({ welcomeSeen: true, claudeBin: claude });
  await app.close();
});

test('with MAINFRAME_CLAUDE_BIN set nothing is saved', async () => {
  const pc = computer();
  const project = repo();
  const env = { ...pc.env, MAINFRAME_CLAUDE_BIN: fakeClaude };
  const { app, page, dataDir } = await launchApp(env, undefined, { firstStart: true });

  await expect(welcome(page)).toBeVisible();
  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'found');
  await expect(check(page, 'claude')).toContainText(`${fakeClaude} · v2.1.999`);

  await answerDialogs(app, project);
  await button(page, 'choose-project').click();

  await boardShows(page, project);
  expect(savedSettings(dataDir)).toEqual({ welcomeSeen: true });
  await app.close();
});

test('with MAINFRAME_CLAUDE_BIN naming nothing, only Look again is offered and nothing is saved', async () => {
  const pc = computer();
  pc.installClaude();
  // A claude is findable, but the variable names the only place looked at.
  const nowhere = join(pc.home, 'nowhere', claudeFile);
  const { app, page, dataDir } = await launchApp({ ...pc.env, MAINFRAME_CLAUDE_BIN: nowhere }, undefined, { firstStart: true });

  await expect(check(page, 'claude')).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('setup')).toContainText(`MAINFRAME_CLAUDE_BIN is set to ${nowhere}`);
  await expect(button(page, 'look-again')).toBeVisible();
  for (const other of ['find-claude', 'install-claude', 'choose-project']) await expect(button(page, other)).toHaveCount(0);
  expect(savedSettings(dataDir)).toEqual({});
  await app.close();
});

test('cancelling the folder dialog keeps the screen; quitting before choosing shows the welcome again', async () => {
  const pc = computer();
  pc.installClaude();
  const first = await launchApp(pc.env, undefined, { firstStart: true });
  const { dataDir } = first;

  await expect(button(first.page, 'choose-project')).toBeVisible();
  await answerDialogs(first.app, null);
  await button(first.page, 'choose-project').click();
  await expect.poll(() => dialogCalls(first.app)).toBe(1);

  // Asked again, so the cancel has been dealt with and the screen still takes the answer.
  await expect(button(first.page, 'choose-project')).toBeVisible();
  await button(first.page, 'choose-project').click();
  await expect.poll(() => dialogCalls(first.app)).toBe(2);
  await expect(first.page.getByTestId('new-task')).toHaveCount(0);
  expect(savedSettings(dataDir)).toEqual({});
  await first.app.close();

  const second = await launchApp({ ...pc.env, MAINFRAME_DATA_DIR: dataDir }, undefined, { firstStart: true });
  await expect(welcome(second.page)).toBeVisible();
  await expect(button(second.page, 'choose-project')).toBeVisible();
  await second.app.close();
});
