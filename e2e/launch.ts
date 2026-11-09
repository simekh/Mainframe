import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test';
import { writeOpenProjects } from '../src/main/projects';

// DIAGNOSTIC (Windows e2e diagnosis): a record in main of each session's PTY traffic, written out
// when a test fails. Removed before the branch's last commit.
export interface DiagRecord {
  t0: number;
  events: Record<string, Array<[number, string, string]>>;
  bytes: Record<string, number>;
  /** Bytes per second of the run, per session. */
  buckets: Record<string, Record<number, number>>;
  pauses: Record<string, number>;
  resumes: Record<string, number>;
  pausedNow: Record<string, boolean>;
  lastData: Record<string, number>;
}

async function installRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow, ipcMain }) => {
    const t0 = Date.now();
    const d: DiagRecord = { t0, events: {}, bytes: {}, buckets: {}, pauses: {}, resumes: {}, pausedNow: {}, lastData: {} };
    const add = (id: string, kind: string, data: string) => {
      const list = (d.events[id] ??= []);
      const text = data.length > 600 ? `${data.slice(0, 600)}…(+${data.length - 600})` : data;
      if (list.length < 4000) list.push([Date.now() - t0, kind, text]);
    };
    ipcMain.on('pty:write', (_e, id: string, data: string) => add(id, 'in', JSON.stringify(data)));
    ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => add(id, 'resize', `${cols}x${rows}`));
    ipcMain.on('pty:pause', (_e, id: string) => {
      d.pauses[id] = (d.pauses[id] ?? 0) + 1;
      d.pausedNow[id] = true;
      add(id, 'pause', String(d.bytes[id] ?? 0));
    });
    ipcMain.on('pty:resume', (_e, id: string) => {
      d.resumes[id] = (d.resumes[id] ?? 0) + 1;
      d.pausedNow[id] = false;
      add(id, 'resume', String(d.bytes[id] ?? 0));
    });
    const wrap = (win: { webContents: { send: (channel: string, ...args: unknown[]) => void } }) => {
      const wc = win.webContents;
      const send = wc.send.bind(wc);
      wc.send = (channel: string, ...args: unknown[]) => {
        try {
          if (channel === 'pty:data') {
            const { sessionId, data } = args[0] as { sessionId: string; data: Uint8Array };
            const before = d.bytes[sessionId] ?? 0;
            d.bytes[sessionId] = before + data.length;
            const t = Date.now() - t0;
            d.lastData[sessionId] = t;
            const buckets = (d.buckets[sessionId] ??= {});
            buckets[Math.floor(t / 1000)] = (buckets[Math.floor(t / 1000)] ?? 0) + data.length;
            if (before < 32_768) add(sessionId, 'out', JSON.stringify(Buffer.from(data).toString('utf8')));
          } else if (channel === 'pty:exit') {
            const exit = args[0] as { sessionId: string };
            add(exit.sessionId, 'exit', JSON.stringify(exit));
          }
        } catch {
          // A diagnostic never breaks the app.
        }
        send(channel, ...args);
      };
    };
    BrowserWindow.getAllWindows().forEach(wrap);
    electronApp.on('browser-window-created', (_e, win) => wrap(win));
    (globalThis as { __diag?: DiagRecord }).__diag = d;
  });
}

export const diagOf = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __diag?: DiagRecord }).__diag!);

/** The record as text: per session its totals, its bytes per second, and its first and last events. */
export function formatDiag(d: DiagRecord, events = 80): string {
  const lines: string[] = [];
  for (const id of Object.keys(d.events)) {
    lines.push(
      `session ${id}: bytes=${d.bytes[id] ?? 0} pauses=${d.pauses[id] ?? 0} resumes=${d.resumes[id] ?? 0} pausedNow=${d.pausedNow[id] ?? false} lastData=${d.lastData[id]}`,
    );
    const buckets = d.buckets[id] ?? {};
    lines.push(`  per second: ${Object.entries(buckets).map(([s, n]) => `${s}s:${n}`).join(' ')}`);
    const list = d.events[id];
    const shown = list.length > events * 2 ? [...list.slice(0, events), null, ...list.slice(-events)] : list;
    for (const e of shown) lines.push(e ? `  ${e[0]} ${e[1]} ${e[2]}` : '  …');
  }
  return lines.join('\n');
}

let diagCount = 0;

/** Writes a diagnostic text into the test's output folder, for the CI step that prints them. */
export function writeDiag(name: string, text: string): void {
  const file = test.info().outputPath(`diag-${name}-${++diagCount}.txt`);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `### ${test.info().titlePath.join(' > ')} (retry ${test.info().retry}, repeat ${test.info().repeatEachIndex})\n${text}\n`);
}

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
  // DIAGNOSTIC (Windows e2e diagnosis): a failed test's apps write their PTY record first.
  const info = test.info();
  if (info.status !== info.expectedStatus) {
    for (const app of runningApps) {
      try {
        writeDiag('failed', formatDiag(await diagOf(app)));
      } catch (err) {
        writeDiag('failed', `no record: ${String(err)}`);
      }
    }
  }
  await Promise.all([...runningApps].map((app) => app.close()));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * The app's environment in a test: `e2e/fake-claude.cjs` as `claude` (on Windows the .exe the global
 * setup built from it), logging to the data folder.
 */
function appEnv(dataDir: string, env: Record<string, string>): Record<string, string> {
  const fakeClaudeLogDir = join(dataDir, 'fake-claude');
  mkdirSync(fakeClaudeLogDir, { recursive: true });
  return {
    ...(process.env as Record<string, string>),
    MAINFRAME_E2E: '1',
    MAINFRAME_CLAUDE_BIN: process.env.FAKE_CLAUDE_EXE ?? join(root, 'e2e', 'fake-claude.cjs'),
    MAINFRAME_DATA_DIR: dataDir,
    FAKE_CLAUDE_LOG_DIR: fakeClaudeLogDir,
    PS1: '$ ',
    BASH_SILENCE_DEPRECATION_WARNING: '1',
    ...env,
  };
}

/**
 * Starts the built app with `e2e/fake-claude.cjs` as `claude`, in a data folder of its own: a fresh
 * one unless `env` names one (to relaunch on the same tasks). It opens `projects`, which the data
 * folder's `projects.json` names, so the folder dialog never shows.
 */
export async function launchApp(
  env: Record<string, string> = {},
  projects: string | string[] = os.tmpdir(),
): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = env.MAINFRAME_DATA_DIR ?? removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-')));
  writeOpenProjects(dataDir, typeof projects === 'string' ? [projects] : projects);
  const app = await electron.launch({ args: [root], env: appEnv(dataDir, env) });
  runningApps.add(app);
  app.on('close', () => runningApps.delete(app));
  await installRecorder(app);
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
    const [win] = BrowserWindow.getAllWindows();
    // The page's size, not the window's: on Windows the window's frame is wider than the page.
    win.setContentSize(w, win.getContentSize()[1]);
  }, width);
  await page.waitForFunction((w) => window.innerWidth === w, width);
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
