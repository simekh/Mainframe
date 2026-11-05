import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { makeRepo } from '../src/main/testing/makeRepo';
import { cleanUp, launchApp, removeAfterTest } from './launch';
import { card, ids, launches, run, screen, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function repo(): string {
  const { main } = makeRepo();
  removeAfterTest(dirname(main));
  return main;
}

function git(...args: string[]): void {
  execFileSync('git', args, { stdio: 'pipe' });
}

const settingsFile = (dataDir: string, taskId: string) => join(dataDir, 'tasks', taskId, 'settings.json');
const sessionIdOf = (args: string[]) => args[args.indexOf('--session-id') + 1];

test('New task launches claude -w in the main checkout with a fresh session id, the hooks file and the opening prompt', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchApp({ THESOURCE_PROJECT_DIR: main });
  const id = await startTask(page, 'Fix login');

  const [first, ...rest] = launches(dataDir);
  expect(rest).toEqual([]);
  expect(realpathSync(first.cwd)).toBe(realpathSync(main));
  expect(first.args.slice(0, 5)).toEqual(['-w', 'fix-login', '-n', 'main-fix-login', '--session-id']);
  expect(first.args[5]).toMatch(UUID);
  expect(first.args[5]).not.toBe(id);
  expect(first.args.slice(6, 8)).toEqual(['--settings', settingsFile(dataDir, id)]);
  expect(first.args).toHaveLength(9);
  const prompt = first.args[8];
  expect(prompt.startsWith('This task is your brief')).toBe(true);
  expect(prompt).toContain('Task: Fix login');
  expect(prompt).not.toContain('No questions on this task');

  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill('Tidy up');
  await page.getByTestId('new-task-no-questions').check();
  await page.getByTestId('new-task-start').click();
  await expect.poll(() => launches(dataDir).length).toBe(2);
  const second = launches(dataDir)[1];
  expect(second.args.slice(0, 2)).toEqual(['-w', 'tidy-up']);
  expect(sessionIdOf(second.args)).not.toBe(first.args[5]);
  expect(second.args.at(-1)).toContain('No questions on this task');
  await app.close();
});

test("the dialog warns when the main checkout has commits that new worktrees won't have", async () => {
  const ahead = repo();
  writeFileSync(join(ahead, 'local.txt'), 'local\n');
  git('-C', ahead, 'add', 'local.txt');
  git('-C', ahead, 'commit', '-m', 'local');
  const first = await launchApp({ THESOURCE_PROJECT_DIR: ahead });
  await first.page.getByTestId('new-task').click();
  await expect(first.page.getByTestId('start-check-warning')).toHaveText(
    "stage has 1 commit that isn't on origin/stage. New worktrees start from origin/stage, so this task won't have them. Push stage first, or start anyway.",
  );
  await expect(first.page.getByTestId('new-task-start')).toHaveText('Start anyway');
  await first.app.close();

  const second = await launchApp({ THESOURCE_PROJECT_DIR: repo() });
  await second.page.getByTestId('new-task').click();
  // The check has answered once the dialog names the base.
  await expect(second.page.locator('.nt-sub')).toContainText('origin/stage');
  await expect(second.page.getByTestId('start-check-warning')).toHaveCount(0);
  await expect(second.page.getByTestId('new-task-start')).toHaveText('Start');
  await second.app.close();
});

test('quitting with tasks running reopens them at the next start, in their worktrees while the branch exists', async () => {
  const main = repo();
  const first = await launchApp({ THESOURCE_PROJECT_DIR: main });
  const alpha = await startTask(first.page, 'Alpha');
  const beta = await startTask(first.page, 'Beta');
  git('-C', main, 'branch', 'worktree-alpha');
  await first.app.close();
  const [alphaStart, betaStart] = launches(first.dataDir);

  const { app, page, dataDir } = await launchApp({ THESOURCE_PROJECT_DIR: main, THESOURCE_DATA_DIR: first.dataDir });
  await expect.poll(() => ids(page)).toEqual([alpha, beta]);
  for (const id of [alpha, beta]) {
    await expect(card(page, id).getByTestId('task-status')).toHaveText('—');
    await expect.poll(() => screen(page, id)).toContain('$');
  }

  // The two reopens spawn together, so their order is not fixed.
  await expect.poll(() => launches(dataDir).length).toBe(4);
  const reopened = launches(dataDir).slice(2).map((launch) => launch.args);
  expect(reopened).toHaveLength(2);
  expect(reopened).toEqual(
    expect.arrayContaining([
      ['--worktree', 'alpha', '--resume', sessionIdOf(alphaStart.args), '--settings', settingsFile(dataDir, alpha)],
      ['--resume', sessionIdOf(betaStart.args), '--settings', settingsFile(dataDir, beta)],
    ]),
  );
  await app.close();
});

test('tasks reopened at startup start at the size their terminal shows', async () => {
  const first = await launchApp();
  const id = await startTask(first.page);
  await first.app.close();

  const { app, page } = await launchApp({ THESOURCE_DATA_DIR: first.dataDir });
  await expect.poll(() => screen(page, id)).toContain('$');
  await expect(card(page, id)).toHaveAttribute('data-selected', 'false');
  const size = (await termSize(page, id))!;
  await card(page, id).click();
  await run(page, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});

test("a task whose claude can't start lands in Closed and stays closed after a restart", async () => {
  const first = await launchApp({ THESOURCE_CLAUDE_BIN: '/nonexistent/claude' });
  await first.page.getByTestId('new-task').click();
  await first.page.getByTestId('new-task-title').fill('Fix login');
  await first.page.getByTestId('new-task-start').click();
  await expect(first.page.getByTestId('task-card')).toHaveCount(1);
  const [id] = await ids(first.page);
  await expect(card(first.page, id).getByTestId('task-status')).toHaveText('closed');
  await first.app.close();

  const { app, page, dataDir } = await launchApp({ THESOURCE_DATA_DIR: first.dataDir });
  await expect(card(page, id).getByTestId('task-status')).toHaveText('closed');
  expect(launches(dataDir)).toEqual([]);
  await app.close();
});
