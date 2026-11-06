import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { OPENED_LINKS_FILE } from '../src/main/links';
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

/** The links the app would have opened in the owner's browser, oldest first; an e2e run records them in its data folder. */
export function openedLinks(dataDir: string): string[] {
  const file = join(dataDir, OPENED_LINKS_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
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
