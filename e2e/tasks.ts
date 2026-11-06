import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { makeRepo } from '../src/main/testing/makeRepo';
import { removeAfterTest } from './launch';

/** A repo from `makeRepo()` that is removed after the test; returns its main checkout. */
export function repo(): string {
  const { main } = makeRepo();
  removeAfterTest(dirname(main));
  return main;
}

export function git(...args: string[]): void {
  execFileSync('git', args, { stdio: 'pipe' });
}

export const ids = (page: Page) => page.evaluate(() => window.__thesourceE2E.taskIds());

export const screen = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__thesourceE2E.screenText(id), taskId);

export const termSize = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__thesourceE2E.termSize(id), taskId);

/** The size the task's session was first spawned at. */
export const firstSpawn = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__thesourceE2E.firstSpawn(id), taskId);

/** The size a fit of the task's terminal would give now: what fills its well with the renderer it has. */
export const fitSize = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__thesourceE2E.fitSize(id), taskId);

/**
 * The look of each cell of the first place `text` shows on the task's screen, each distinct look
 * once: one entry when the text is styled alike throughout.
 */
export const styleOf = (page: Page, taskId: string, text: string) =>
  page.evaluate(
    ([id, wanted]) => {
      const hooks = window.__thesourceE2E;
      const lines = hooks.screenText(id).split('\n');
      const row = lines.findIndex((line) => line.includes(wanted));
      if (row < 0) throw new Error(`"${wanted}" is not on the screen`);
      const col = lines[row].indexOf(wanted);
      const looks = new Set<string>();
      for (let i = 0; i < wanted.length; i++) {
        const { fg, bold, underline } = hooks.cell(id, row, col + i)!;
        looks.add(JSON.stringify({ fg, bold, underline }));
      }
      return [...looks].map((look) => JSON.parse(look) as { fg: string; bold: boolean; underline: boolean });
    },
    [taskId, text] as const,
  );

export const card = (page: Page, taskId: string) => page.locator(`[data-testid=task-card][data-task-id="${taskId}"]`);

/** The task's card, found only inside the given lane of the board. */
export const cardIn = (page: Page, lane: 'needs-you' | 'working' | 'closed', taskId: string) =>
  page.locator(`[data-testid=lane][data-lane=${lane}] [data-testid=task-card][data-task-id="${taskId}"]`);

export async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

/** Sends a line to the task's session through the bridge, so the focus can stay where it is. */
export async function sendLine(page: Page, taskId: string, line: string): Promise<void> {
  await page.evaluate(
    async ([id, data]) => {
      const task = (await window.thesource.listTasks()).find((t) => t.id === id);
      window.thesource.write(task!.session!.id, data);
    },
    [taskId, `${line}\r`],
  );
}

/** Starts a task through the New task dialog; resolves with its id once its shell prompt shows. */
export async function startTask(page: Page, title = 'Task', description = ''): Promise<string> {
  const before = await ids(page);
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill(title);
  if (description) await page.getByTestId('new-task-description').fill(description);
  await page.getByTestId('new-task-start').click();
  const added = async () => (await ids(page)).filter((id) => !before.includes(id));
  await expect.poll(added).toHaveLength(1);
  const [id] = await added();
  await expect.poll(() => screen(page, id)).toContain('$');
  return id;
}

/** A shell command that reports `state` as Claude Code does, over OSC 7501. */
export const report = (state: string) => `printf '\\033]7501;state=${state}\\033\\\\'`;

/** Closes the task's session, as Close session in the panel does. */
export const closeTask = (page: Page, taskId: string) => page.evaluate((id) => window.thesource.closeTask(id), taskId);

/**
 * Stands in for the owner's browser: from now on the app records the links it is asked to open
 * instead of opening them. Gives what it has recorded so far, oldest first.
 */
export async function catchOpenedLinks(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    const record = async (url: string) => void opened.push(url);
    shell.openExternal = record;
    if (shell.openExternal !== record) throw new Error('shell.openExternal could not be replaced');
    (globalThis as { openedLinks?: string[] }).openedLinks = opened;
  });
  return () => app.evaluate(() => (globalThis as { openedLinks?: string[] }).openedLinks ?? []);
}

/** What `e2e/fake-claude.sh` recorded of each launch in this data folder, oldest first. */
export function launches(dataDir: string): Array<{ cwd: string; args: string[] }> {
  const dir = join(dataDir, 'fake-claude');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.argv'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .map((file) => {
      const [cwd, ...args] = readFileSync(file, 'utf8').split('\0').slice(0, -1);
      return { cwd, args };
    });
}
