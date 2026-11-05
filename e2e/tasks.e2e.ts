import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanUp, launchApp, removeAfterTest } from './launch';
import { card, cardIn, firstSpawn, fitSize, git, ids, launches, repo, run, screen, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  // On the content: fake-claude creates its file before it writes the arguments.
  await expect.poll(() => launches(dataDir)[1]?.args.at(-1)).toContain('No questions on this task');
  const second = launches(dataDir)[1];
  expect(second.args.slice(0, 2)).toEqual(['-w', 'tidy-up']);
  expect(sessionIdOf(second.args)).not.toBe(first.args[5]);
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
    "stage has 1 commit that isn't on origin/stage. New worktrees start from origin/stage, so this task won't have it. Push stage first, or start anyway.",
  );
  await expect(first.page.getByTestId('new-task-start')).toHaveText('Start anyway');
  await first.page.keyboard.press('Escape');
  writeFileSync(join(ahead, 'local2.txt'), 'local\n');
  git('-C', ahead, 'add', 'local2.txt');
  git('-C', ahead, 'commit', '-m', 'local 2');
  await first.page.getByTestId('new-task').click();
  await expect(first.page.getByTestId('start-check-warning')).toHaveText(
    "stage has 2 commits that aren't on origin/stage. New worktrees start from origin/stage, so this task won't have them. Push stage first, or start anyway.",
  );
  await first.app.close();

  const second = await launchApp({ THESOURCE_PROJECT_DIR: repo() });
  await second.page.getByTestId('new-task').click();
  // The check has answered once the dialog names the base.
  await expect(second.page.getByTestId('new-task-base')).toHaveText('origin/stage');
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
    await expect(cardIn(page, 'working', id).getByTestId('task-activity')).toHaveText('Starting…');
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
  expect(await firstSpawn(page, id)).toEqual(await termSize(page, id));
  // Its first time on screen puts it in WebGL, which can fit fewer columns: it fits again, so it
  // fills the well, and its session takes that size.
  await card(page, id).click();
  const size = (await termSize(page, id))!;
  expect(await fitSize(page, id)).toEqual(size);
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
  await expect(cardIn(first.page, 'closed', id).getByTestId('task-ask')).toHaveText('Closed');
  // The terminal says why, without the bridge's wrapping.
  await expect.poll(() => screen(first.page, id)).toContain('/nonexistent/claude');
  expect(await screen(first.page, id)).not.toContain('invoking remote method');
  await first.app.close();
  const saved = JSON.parse(readFileSync(join(first.dataDir, 'state.json'), 'utf8')).tasks;
  expect(saved).toEqual([expect.objectContaining({ id, open: false })]);

  const { app, page, dataDir } = await launchApp({ THESOURCE_DATA_DIR: first.dataDir });
  await expect(cardIn(page, 'closed', id).getByTestId('task-ask')).toHaveText('Closed');
  expect(launches(dataDir)).toEqual([]);
  await app.close();
});

test('a start that fails shows why and keeps the dialog open', async () => {
  const dataDir = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'thesource-e2e-')));
  // A file where the tasks folder goes: main can't make the new task's folder.
  writeFileSync(join(dataDir, 'tasks'), '');
  const { app, page } = await launchApp({ THESOURCE_DATA_DIR: dataDir });
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill('Fix login');
  await page.getByTestId('new-task-start').click();
  await expect(page.getByRole('alert')).toHaveText(/^ENOTDIR: not a directory, mkdir /);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('new-task-start')).toBeEnabled();
  expect(await ids(page)).toEqual([]);
  await app.close();
});

test('reloading the window keeps running tasks running', async () => {
  const { app, page, dataDir } = await launchApp();
  const id = await startTask(page);
  await page.reload();
  await page.waitForFunction(() => window.__thesourceE2E !== undefined);
  await card(page, id).click();
  await run(page, 'echo still-$((2+2))');
  await expect.poll(() => screen(page, id)).toContain('still-4');
  await expect(card(page, id)).toHaveAttribute('data-lane', 'working');
  expect(launches(dataDir)).toHaveLength(1);
  await app.close();
});

test('cards move between lanes as the session reports, and Reopen brings a closed one back', async () => {
  const { app, page, dataDir } = await launchApp();
  const a = await startTask(page, 'Alpha');
  await expect(cardIn(page, 'working', a)).toBeVisible();

  await run(page, "printf '\\033]7501;state=blocked:kind=permission:msg=YXBwcm92ZSBCYXNoOiBscw==\\033\\\\'");
  const needs = cardIn(page, 'needs-you', a);
  await expect(needs).toBeVisible();
  await expect(needs.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'ask');
  await expect(needs.getByTestId('task-activity')).toHaveText('approve Bash: ls');
  await expect(needs.getByTestId('task-ask')).toHaveText('Needs input');

  // A second task takes the selection, so Answer has something to change.
  const b = await startTask(page, 'Beta');
  await expect(card(page, a)).toHaveAttribute('data-selected', 'false');
  await expect(card(page, a).locator('.card-title')).not.toHaveAttribute('aria-current');
  await expect(needs.getByTestId('answer')).toHaveAttribute('aria-label', 'Answer Alpha');
  await needs.getByTestId('answer').click();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, a).locator('.card-title')).toHaveAttribute('aria-current', 'true');

  await page.getByTestId('close-session').click();
  const closed = cardIn(page, 'closed', a);
  await expect(closed.getByTestId('task-ask')).toHaveText('Closed');
  await expect(closed.getByTestId('task-age')).toHaveText('just now');
  await expect(closed.getByTestId('reopen')).toHaveAttribute('aria-label', 'Reopen Alpha');

  // Reopened while another task is selected: the reopen selects it, and its new terminal mounts
  // on screen, so the session starts at the size that fills the well.
  await card(page, b).click();
  await closed.getByTestId('reopen').click();
  await expect(cardIn(page, 'working', a)).toBeVisible();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => launches(dataDir).filter((l) => l.args.includes('--resume')).length).toBe(1);
  await expect.poll(() => screen(page, a)).toContain('$');
  const size = (await termSize(page, a))!;
  expect(await firstSpawn(page, a)).toEqual(size);
  expect(await fitSize(page, a)).toEqual(size);
  await app.close();
});
