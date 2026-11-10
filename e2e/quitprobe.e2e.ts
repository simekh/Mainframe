// TEMPORARY DIAGNOSTIC (2c CI push 1), removed once the cause is known. Plan 2b's CI saw Electron exit
// 0xC0000409 at some Windows quits. This repeats quits with and without sessions, through Playwright and
// as a user's close of the window (WM_CLOSE, no Playwright), and logs each exit code and stderr's end.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { writeOpenProjects } from '../src/main/projects';
import { writeSettings } from '../src/main/setup/settings';
import { cleanUp, fakeClaude, launchApp, removeAfterTest } from './launch';
import { ids, managerLaunches, managerScreen, repo, screen, sendLine, sendManagerLine, startTask } from './tasks';

test.afterEach(cleanUp);
test.skip(process.env.MAINFRAME_QUIT_PROBE !== '1', 'diagnostic, run by its own Windows CI step');

const debugEnv = { ELECTRON_ENABLE_STACK_DUMPING: '1', ELECTRON_ENABLE_LOGGING: '1' };
const hex = (code: number | null) => (code === null ? 'null' : `0x${(code >>> 0).toString(16).toUpperCase()}`);
const tally: Record<string, string[]> = {};

function note(label: string, i: number, code: number | null, signal: string | null, ms: number, err: string): void {
  (tally[label] ??= []).push(hex(code));
  const crashed = code !== 0;
  console.log(
    `[quitprobe] ${label} i=${i} exit=${hex(code)} signal=${signal} closeMs=${ms}` +
      (crashed ? ` stderrTail=${JSON.stringify(err.slice(-1500))}` : ''),
  );
}

test.afterAll(() => {
  for (const [label, codes] of Object.entries(tally)) {
    console.log(`[quitprobe] SUMMARY ${label}: ${codes.filter((c) => c !== '0x0').length} of ${codes.length} non-zero (${codes.join(' ')})`);
  }
});

/** Quits through Playwright's app.close() (app.quit() in main), and notes the exit. */
async function closeAndNote(app: ElectronApplication, label: string, i: number): Promise<void> {
  const proc = app.process();
  let err = '';
  proc.stderr?.on('data', (d: Buffer) => {
    err = (err + d.toString()).slice(-4000);
  });
  const exited = new Promise<[number | null, string | null]>((resolve) =>
    proc.once('exit', (code, signal) => resolve([code, signal])),
  );
  const t = Date.now();
  await app.close();
  const [code, signal] = await exited;
  note(label, i, code, signal, Date.now() - t, err);
}

async function sessionsOf(page: Page) {
  return page.evaluate(async () => {
    const out: Array<string | null> = [];
    for (const { dir } of await window.mainframe.listProjects()) {
      out.push((await window.mainframe.getManager(dir)).session?.id ?? null);
      for (const t of await window.mainframe.listTasks(dir)) out.push(t.session?.id ?? null);
    }
    return out;
  });
}

test('quit at the setup screen: no project, no session', async () => {
  test.setTimeout(600_000);
  for (let i = 0; i < 8; i++) {
    const { app, page } = await launchApp(debugEnv, undefined, { firstStart: true });
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.waitForTimeout(1000);
    await closeAndNote(app, 'setup', i);
  }
});

test("quit with the manager's and a task's session running", async () => {
  test.setTimeout(600_000);
  const project = repo();
  for (let i = 0; i < 10; i++) {
    const { app, page } = await launchApp(debugEnv, project);
    await expect.poll(() => managerScreen(page)).toContain('$');
    await startTask(page, `Probe ${i}`);
    await page.waitForTimeout(1000);
    await closeAndNote(app, 'live', i);
  }
});

test("quit once the manager's and the task's sessions have ended on their own", async () => {
  test.setTimeout(600_000);
  const project = repo();
  for (let i = 0; i < 8; i++) {
    const { app, page } = await launchApp(debugEnv, project);
    await expect.poll(() => managerScreen(page)).toContain('$');
    const id = await startTask(page, `Probe ${i}`);
    // A lone Enter first, for Git Bash to lose after a resize.
    await expect
      .poll(
        async () => {
          await sendLine(page, id, '').catch(() => {});
          await sendLine(page, id, 'exit').catch(() => {});
          await sendManagerLine(page, '').catch(() => {});
          await sendManagerLine(page, 'exit').catch(() => {});
          return (await sessionsOf(page)).every((s) => s === null);
        },
        { timeout: 30_000, intervals: [3000] },
      )
      .toBe(true);
    await page.waitForTimeout(2000);
    console.log(`[quitprobe] ended i=${i} sessions before quit: ${JSON.stringify(await sessionsOf(page))} task screen ends: ${JSON.stringify((await screen(page, id)).trim().slice(-60))}`);
    await closeAndNote(app, 'ended', i);
  }
});

test('quit after Close project ended the sessions', async () => {
  test.setTimeout(600_000);
  const project = repo();
  for (let i = 0; i < 8; i++) {
    const { app, page } = await launchApp(debugEnv, project);
    await expect.poll(() => managerScreen(page)).toContain('$');
    await startTask(page, `Probe ${i}`);
    expect(await ids(page)).not.toHaveLength(0);
    await page.evaluate(async () => {
      for (const { dir } of await window.mainframe.listProjects()) await window.mainframe.closeProject(dir);
    });
    await page.waitForTimeout(3000);
    await closeAndNote(app, 'closed', i);
  }
});

const electronBin: string = require('electron');
const root = join(__dirname, '..');

/**
 * Starts the built app without Playwright, on `projects` (none: the first-start screen), waits for
 * `managers` manager sessions to have launched, then closes its window as a user does (taskkill without
 * /F sends WM_CLOSE), and notes the exit.
 */
async function userClose(label: string, i: number, projects: string[]): Promise<void> {
  const dataDir = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-')));
  const logDir = join(dataDir, 'fake-claude');
  mkdirSync(logDir, { recursive: true });
  if (projects.length > 0) {
    writeOpenProjects(dataDir, projects);
    writeSettings(dataDir, { welcomeSeen: true });
  }
  const env = {
    ...process.env,
    ...debugEnv,
    MAINFRAME_E2E: '1',
    MAINFRAME_CLAUDE_BIN: fakeClaude,
    MAINFRAME_DATA_DIR: dataDir,
    FAKE_CLAUDE_LOG_DIR: logDir,
    PS1: '$ ',
  };
  const proc = spawn(electronBin, [root], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d: Buffer) => {
    err = (err + d.toString()).slice(-4000);
  });
  const exited = new Promise<[number | null, string | null]>((resolve) =>
    proc.once('exit', (code, signal) => resolve([code, signal])),
  );
  await expect.poll(() => managerLaunches(dataDir).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(Math.min(1, projects.length));
  // The sessions' shells start, and the window is up.
  await new Promise((r) => setTimeout(r, 4000));
  const managers = managerLaunches(dataDir).length;
  const t = Date.now();
  try {
    execFileSync('taskkill', ['/PID', String(proc.pid)], { stdio: 'pipe' });
  } catch (e) {
    console.log(`[quitprobe] ${label} i=${i} taskkill without /F failed: ${String((e as { stderr?: Buffer }).stderr ?? e)}`);
  }
  const timer = setTimeout(() => {
    console.log(`[quitprobe] ${label} i=${i} still running 20 s after WM_CLOSE; ending it`);
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'pipe' });
    } catch {
      // Gone already.
    }
  }, 20_000);
  const [code, signal] = await exited;
  clearTimeout(timer);
  note(`${label}(${managers} managers)`, i, code, signal, Date.now() - t, err);
}

test("a user's close of the window with two projects' managers running (no Playwright)", async () => {
  test.skip(process.platform !== 'win32', 'taskkill is Windows');
  test.setTimeout(600_000);
  const projects = [repo(), repo()];
  for (let i = 0; i < 10; i++) await userClose('wmclose-live', i, projects);
});

test("a user's close of the window at the setup screen (no Playwright)", async () => {
  test.skip(process.platform !== 'win32', 'taskkill is Windows');
  test.setTimeout(600_000);
  for (let i = 0; i < 5; i++) await userClose('wmclose-setup', i, []);
});
