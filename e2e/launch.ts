import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { writeOpenProjects } from '../src/main/projects';
import { type AppSettings, writeSettings } from '../src/main/setup/settings';

const root = join(__dirname, '..');

const tempDirs: string[] = [];
const runningApps = new Set<ElectronApplication>();

/** Marks a folder the test made for removal by `cleanUp`, and returns it. */
export function removeAfterTest(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

/**
 * Each e2e file runs this after every test: `test.afterEach(cleanUp)`. It closes the apps a failed
 * test left running first, since Chromium writes its profile back into the data folder as it quits.
 */
export async function cleanUp(): Promise<void> {
  await Promise.all([...runningApps].map((app) => app.close()));
  // Retries: Windows keeps a program's file locked until its process has gone, which can be a moment
  // after the app has quit.
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** The stand-in for `claude`: `e2e/fake-claude.cjs`, on Windows the .exe the global setup built from it. */
export const fakeClaude = process.env.FAKE_CLAUDE_EXE ?? join(root, 'e2e', 'fake-claude.cjs');

/** The stand-in for `opencode`: `e2e/fake-opencode.cjs`, on Windows a copy of the .exe named `fake-opencode.exe`. */
export const fakeOpencode = process.env.FAKE_OPENCODE_EXE ?? join(root, 'e2e', 'fake-opencode.cjs');

/**
 * `launchApp` with the stand-in as `opencode` beside the one as `claude`. Found, and with no tick saved, it counts as
 * ticked, so the New task box offers it.
 */
export const launchWithOpencode = (projects: string | string[], env: Record<string, string> = {}, settings?: AppSettings) =>
  launchApp({ MAINFRAME_OPENCODE_BIN: fakeOpencode, ...env }, projects, { settings });

/**
 * The app's environment in a test: the stand-in as `claude`, logging to the data folder, and an `opencode`
 * that isn't there, so no OpenCode on the machine shows in the New task box unless a test names one. A variable
 * `env` gives as `undefined` is left out, even one set here.
 */
function appEnv(dataDir: string, env: Record<string, string | undefined>): Record<string, string> {
  const fakeClaudeLogDir = join(dataDir, 'fake-claude');
  mkdirSync(fakeClaudeLogDir, { recursive: true });
  const vars: Record<string, string | undefined> = {
    ...process.env,
    MAINFRAME_E2E: '1',
    MAINFRAME_CLAUDE_BIN: fakeClaude,
    MAINFRAME_OPENCODE_BIN: join(dataDir, 'no-opencode'),
    MAINFRAME_DATA_DIR: dataDir,
    FAKE_CLAUDE_LOG_DIR: fakeClaudeLogDir,
    PS1: '$ ',
    BASH_SILENCE_DEPRECATION_WARNING: '1',
    ...env,
  };
  return Object.fromEntries(Object.entries(vars).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/**
 * Starts the built app with `e2e/fake-claude.cjs` as `claude`, in a data folder of its own: a fresh
 * one unless `env` names one (to relaunch on the same tasks). It opens `projects`, which the data
 * folder's `projects.json` names, so the folder dialog never shows; and `settings.json` holds
 * `o.settings`, `{ welcomeSeen: true }` unless given, so the welcome never shows. With `o.firstStart`
 * the folder gets neither file: the app starts as on a computer that has never run it.
 */
export async function launchApp(
  env: Record<string, string | undefined> = {},
  projects: string | string[] = os.tmpdir(),
  o: { firstStart?: boolean; settings?: AppSettings } = {},
): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = env.MAINFRAME_DATA_DIR ?? removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-')));
  if (!o.firstStart) {
    writeOpenProjects(dataDir, typeof projects === 'string' ? [projects] : projects);
    writeSettings(dataDir, o.settings ?? { welcomeSeen: true });
  }
  const app = await electron.launch({ args: [root], env: appEnv(dataDir, env) });
  runningApps.add(app);
  app.on('close', () => runningApps.delete(app));
  // No e2e run opens the owner's browser: the links main is asked to open are recorded instead,
  // for `openedLinks`. Main looks the opener up at each call.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    const record = async (url: string) => void opened.push(url);
    shell.openExternal = record;
    if (shell.openExternal !== record) throw new Error('shell.openExternal could not be replaced');
    (globalThis as { openedLinks?: string[] }).openedLinks = opened;
  });
  const page = await app.firstWindow();
  // The renderer installs its test hooks once its config and font are in.
  await page.waitForFunction(() => window.__mainframeE2E !== undefined);
  return { app, page, dataDir };
}

/**
 * Makes the window `width` px wide, as the owner dragging its edge does; resolves once the page has
 * that width. For a test that needs room for the manager's column, the board and the panel at their
 * own widths beside the project list.
 */
export async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, w) => {
    // Mainframe's window, not the diff window above it.
    const win = BrowserWindow.getAllWindows().find((w) => w.getParentWindow() === null)!;
    // The page's size, not the window's: on Windows the window's frame is wider than the page.
    win.setContentSize(w, win.getContentSize()[1]);
  }, width);
  await page.waitForFunction((w) => window.innerWidth === w, width);
}

/**
 * Presses Cmd (Ctrl off the Mac) and `keyCode` down in Mainframe's window, or with `inDiff` the diff window.
 * Sent through Electron, not Playwright: on the Mac, Cmd keys Playwright presses never reach the window's
 * `before-input-event`.
 */
export async function pressWindowKey(app: ElectronApplication, keyCode: string, o: { inDiff?: boolean; shift?: boolean } = {}): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, inDiff, shift }) => {
      const win = BrowserWindow.getAllWindows().find((w) => (w.getParentWindow() === null) !== inDiff)!;
      const mod = process.platform === 'darwin' ? 'meta' : 'control';
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: shift ? [mod, 'shift'] : [mod] });
    },
    { keyCode, inDiff: o.inDiff ?? false, shift: o.shift ?? false },
  );
}

// What `require('electron')` gives Node: the path of the Electron binary.
const electronBin: string = require('electron');

/**
 * Runs the built app once more on the data folder, as opening it a second time does, without
 * Playwright; resolves with its exit code. One still running after `timeoutMs` is ended, and the
 * promise rejects.
 */
export function launchAgain(dataDir: string, timeoutMs = 15_000): Promise<number | null> {
  // On Linux without Chromium's sandbox, as Playwright's own launch runs it.
  const args = process.platform === 'linux' ? [root, '--no-sandbox'] : [root];
  const proc = spawn(electronBin, args, { env: appEnv(dataDir, {}), stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    // Once it has gone, so the test's clean-up doesn't race its last writes to the data folder.
    proc.once('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`the second launch was still running after ${timeoutMs} ms`));
      else resolve(code);
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
