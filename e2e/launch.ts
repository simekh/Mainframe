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

/**
 * Starts the built app with `e2e/fake-claude.sh` as `claude`, in a data folder of its own: a fresh
 * one unless `env` names one (to relaunch on the same tasks).
 */
export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = env.THESOURCE_DATA_DIR ?? removeAfterTest(mkdtempSync(join(os.tmpdir(), 'thesource-e2e-')));
  const fakeClaudeLogDir = join(dataDir, 'fake-claude');
  mkdirSync(fakeClaudeLogDir, { recursive: true });
  const app = await electron.launch({
    args: [root],
    env: {
      ...(process.env as Record<string, string>),
      THESOURCE_E2E: '1',
      THESOURCE_PROJECT_DIR: os.tmpdir(),
      THESOURCE_CLAUDE_BIN: join(root, 'e2e', 'fake-claude.sh'),
      THESOURCE_DATA_DIR: dataDir,
      FAKE_CLAUDE_LOG_DIR: fakeClaudeLogDir,
      PS1: '$ ',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      ...env,
    },
  });
  runningApps.add(app);
  app.on('close', () => runningApps.delete(app));
  const page = await app.firstWindow();
  // The renderer installs its test hooks once its config and font are in.
  await page.waitForFunction(() => window.__thesourceE2E !== undefined);
  return { app, page, dataDir };
}
