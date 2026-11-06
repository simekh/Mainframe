import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The app's environment in a test: `e2e/fake-claude.sh` as `claude`, logging to the data folder. */
function appEnv(dataDir: string, env: Record<string, string>): Record<string, string> {
  const fakeClaudeLogDir = join(dataDir, 'fake-claude');
  mkdirSync(fakeClaudeLogDir, { recursive: true });
  return {
    ...(process.env as Record<string, string>),
    THESOURCE_E2E: '1',
    THESOURCE_PROJECT_DIR: os.tmpdir(),
    THESOURCE_CLAUDE_BIN: join(root, 'e2e', 'fake-claude.sh'),
    THESOURCE_DATA_DIR: dataDir,
    FAKE_CLAUDE_LOG_DIR: fakeClaudeLogDir,
    PS1: '$ ',
    BASH_SILENCE_DEPRECATION_WARNING: '1',
    ...env,
  };
}

/**
 * Starts the built app with `e2e/fake-claude.sh` as `claude`, in a data folder of its own: a fresh
 * one unless `env` names one (to relaunch on the same tasks).
 */
export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = env.THESOURCE_DATA_DIR ?? removeAfterTest(mkdtempSync(join(os.tmpdir(), 'thesource-e2e-')));
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
  await page.waitForFunction(() => window.__thesourceE2E !== undefined);
  return { app, page, dataDir };
}

// What `require('electron')` gives Node: the path of the Electron binary.
const electronBin: string = require('electron');

/**
 * Runs the built app once more on the data folder, as opening it a second time does, without
 * Playwright; resolves with its exit code. One still running after `timeoutMs` is ended, and the
 * promise rejects.
 */
export function launchAgain(dataDir: string, timeoutMs = 15_000): Promise<number | null> {
  const proc = spawn(electronBin, [root], { env: appEnv(dataDir, {}), stdio: 'ignore' });
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
