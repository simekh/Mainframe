import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanUp, fakeClaude, launchApp, removeAfterTest } from './launch';
import {
  card, cardIn, closeTask, firstSpawn, fitSize, git, ids, launches, report, repo, run, screen, sendAfterResize, sendLine,
  sessionIdOf, startTask, termSize, UUID,
} from './tasks';

test.afterEach(cleanUp);

const settingsFile = (dataDir: string, taskId: string) => join(dataDir, 'tasks', taskId, 'settings.json');

/**
 * Launches with a copy of the stand-in as `claude`, which the start check accepts, and removes the copy
 * once the board shows: a claude that can't start. Resolves with the copy's path as well. (`copyFileSync`
 * keeps the executable bit.)
 */
async function launchWithClaudeGone(projects?: string) {
  const claude = join(removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-claude-'))), basename(fakeClaude));
  copyFileSync(fakeClaude, claude);
  const launched = await launchApp({ MAINFRAME_CLAUDE_BIN: claude }, projects);
  await expect(launched.page.getByTestId('new-task')).toBeVisible();
  rmSync(claude);
  return { ...launched, claude };
}

test('New task launches claude -w in the main checkout with a fresh session id, the hooks file and the opening prompt', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchApp({}, main);
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
  const first = await launchApp({}, ahead);
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

  const second = await launchApp({}, repo());
  await second.page.getByTestId('new-task').click();
  // The check has answered once the dialog names the base.
  await expect(second.page.getByTestId('new-task-base')).toHaveText('origin/stage');
  await expect(second.page.getByTestId('start-check-warning')).toHaveCount(0);
  await expect(second.page.getByTestId('new-task-start')).toHaveText('Start');
  await second.app.close();
});

test('quitting with tasks running reopens them at the next start, in their worktrees while the branch exists', async () => {
  const main = repo();
  const first = await launchApp({}, main);
  const alpha = await startTask(first.page, 'Alpha');
  const beta = await startTask(first.page, 'Beta');
  git('-C', main, 'branch', 'worktree-alpha');
  await first.app.close();
  const [alphaStart, betaStart] = launches(first.dataDir);

  const { app, page, dataDir } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir }, main);
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

test("a session closed mid-turn carries on when reopened; one that was waiting doesn't", async () => {
  const main = repo();
  const first = await launchApp({}, main);
  const { page, dataDir } = first;
  const a = await startTask(page, 'Alpha');
  const b = await startTask(page, 'Beta');
  /** The launches of one task, oldest first: its start, its Reopen, then its restore after a quit. */
  const launchesOf = (id: string) =>
    launches(dataDir).filter((l) => l.args.includes(settingsFile(dataDir, id))).map((l) => l.args);

  // Alpha is mid-turn; Beta has finished its turn and waits for the owner.
  await sendLine(page, a, report('working'));
  await sendLine(page, b, `${report('working')}; ${report('idle')}`);
  await expect(cardIn(page, 'working', a).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  await expect(cardIn(page, 'needs-you', b)).toHaveCount(1);

  for (const id of [a, b]) await closeTask(page, id);
  for (const id of [a, b]) await expect(cardIn(page, 'closed', id)).toHaveCount(1);
  for (const id of [a, b]) await cardIn(page, 'closed', id).getByTestId('reopen').click();

  // On the content: fake-claude creates its file before it writes the arguments.
  await expect.poll(() => launchesOf(a).length).toBe(2);
  await expect.poll(() => launchesOf(b).length).toBe(2);
  const alpha = sessionIdOf(launchesOf(a)[0]);
  const beta = sessionIdOf(launchesOf(b)[0]);
  expect(launchesOf(a)[1]).toEqual(['--resume', alpha, '--settings', settingsFile(dataDir, a), 'Continue where you left off.']);
  expect(launchesOf(b)[1]).toEqual(['--resume', beta, '--settings', settingsFile(dataDir, b)]);

  // Both sessions say they are idle before they have worked. Alpha was given a prompt, so its card
  // keeps to Working until it does; Beta was not, so it is waiting for the owner. The echo comes
  // after the report on the same stream, so its output shows only once the report has been handled.
  const idleAndEcho = `${report('idle')}; echo idle-$((1+1))`;
  await sendLine(page, a, idleAndEcho);
  await sendLine(page, b, idleAndEcho);
  for (const id of [a, b]) await expect.poll(() => screen(page, id)).toContain('idle-2');
  await expect(cardIn(page, 'needs-you', b)).toHaveCount(1);
  await expect(cardIn(page, 'working', a).getByTestId('task-activity')).toHaveText('Starting…');

  // Alpha is mid-turn again as the app quits; Beta is waiting.
  await sendLine(page, a, report('working'));
  await expect(cardIn(page, 'working', a).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  await first.app.close();

  const second = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, main);
  await expect.poll(() => launchesOf(a).length).toBe(3);
  await expect.poll(() => launchesOf(b).length).toBe(3);
  expect(launchesOf(a)[2]).toEqual(['--resume', alpha, '--settings', settingsFile(dataDir, a), 'Continue where you left off.']);
  expect(launchesOf(b)[2]).toEqual(['--resume', beta, '--settings', settingsFile(dataDir, b)]);
  await second.app.close();
});

test('tasks reopened at startup start at the size their terminal shows', async () => {
  const first = await launchApp();
  const id = await startTask(first.page);
  await first.app.close();

  const { app, page } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir });
  await expect.poll(() => screen(page, id)).toContain('$');
  await expect(card(page, id)).toHaveAttribute('data-selected', 'false');
  expect(await firstSpawn(page, id)).toEqual(await termSize(page, id));
  // Its first time on screen puts it in WebGL, which can fit fewer columns: it fits again, so it
  // fills the well, and its session takes that size.
  await card(page, id).click();
  const size = (await termSize(page, id))!;
  expect(await fitSize(page, id)).toEqual(size);
  await sendAfterResize((line) => run(page, line), 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await termSize(page, id)).toEqual(size);
  await app.close();
});

test("a task whose claude can't start lands in Closed and stays closed after a restart", async () => {
  const first = await launchWithClaudeGone();
  await first.page.getByTestId('new-task').click();
  await first.page.getByTestId('new-task-title').fill('Fix login');
  await first.page.getByTestId('new-task-start').click();
  await expect(first.page.getByTestId('task-card')).toHaveCount(1);
  const [id] = await ids(first.page);
  await expect(cardIn(first.page, 'closed', id).getByTestId('task-ask')).toHaveText('Closed');
  // The terminal says why, without the bridge's wrapping. White space is ignored: it wraps the long path.
  const compact = (text: string) => text.replace(/\s+/g, '');
  await expect
    .poll(async () => compact(await screen(first.page, id)))
    .toContain(compact(`${first.claude} was not found, or is not an executable file`));
  expect(await screen(first.page, id)).not.toContain('invoking remote method');
  await first.app.close();
  const saved = JSON.parse(readFileSync(join(first.dataDir, 'state.json'), 'utf8')).tasks;
  expect(saved).toEqual([expect.objectContaining({ id, open: false })]);

  const { app, page, dataDir } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir });
  await expect(cardIn(page, 'closed', id).getByTestId('task-ask')).toHaveText('Closed');
  expect(launches(dataDir)).toEqual([]);
  await app.close();
});

test('Reopen of a task whose claude never started begins its conversation, and the next Reopen resumes it', async () => {
  const main = repo();
  const first = await launchWithClaudeGone(main);
  await first.page.getByTestId('new-task').click();
  await first.page.getByTestId('new-task-title').fill('Fix login');
  await first.page.getByTestId('new-task-no-questions').check();
  await first.page.getByTestId('new-task-start').click();
  await expect(first.page.getByTestId('task-card')).toHaveCount(1);
  const [id] = await ids(first.page);
  await expect(cardIn(first.page, 'closed', id)).toHaveCount(1);
  await first.app.close();
  const before = JSON.parse(readFileSync(join(first.dataDir, 'state.json'), 'utf8')).tasks[0].claudeSessionId;

  const { app, page, dataDir } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir }, main);
  await cardIn(page, 'closed', id).getByTestId('reopen').click();
  // On the content: fake-claude creates its file before it writes the arguments.
  await expect.poll(() => launches(dataDir)[0]?.args.at(-1)).toContain('No questions on this task');
  const [started, ...rest] = launches(dataDir);
  expect(rest).toEqual([]);
  expect(started.args.slice(0, 5)).toEqual(['-w', 'fix-login', '-n', 'main-fix-login', '--session-id']);
  expect(started.args[5]).toMatch(UUID);
  expect(started.args[5]).not.toBe(before);
  expect(started.args.slice(6, 8)).toEqual(['--settings', settingsFile(dataDir, id)]);
  expect(started.args[8].startsWith('This task is your brief')).toBe(true);
  await expect.poll(() => screen(page, id)).toContain('$');

  // That launch began the conversation, so the next Reopen continues it.
  await page.getByTestId('close-session').click();
  await cardIn(page, 'closed', id).getByTestId('reopen').click();
  await expect
    .poll(() => launches(dataDir)[1]?.args)
    .toEqual(['--resume', started.args[5], '--settings', settingsFile(dataDir, id)]);
  await app.close();
});

test('a start that fails shows why and keeps the dialog open', async () => {
  const dataDir = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-')));
  // A file where the tasks folder goes: main can't make the new task's folder.
  writeFileSync(join(dataDir, 'tasks'), '');
  const { app, page } = await launchApp({ MAINFRAME_DATA_DIR: dataDir });
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill('Fix login');
  await page.getByTestId('new-task-start').click();
  await expect(page.getByRole('alert')).toHaveText(/^ENOTDIR: not a directory, mkdir /);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('new-task-start')).toBeEnabled();
  expect(await ids(page)).toEqual([]);
  await app.close();
});

test('reloading the window keeps running tasks running, in the state they last reported', async () => {
  const { app, page, dataDir } = await launchApp();
  const id = await startTask(page);
  await sendLine(page, id, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(cardIn(page, 'needs-you', id)).toHaveCount(1);
  await page.reload();
  await page.waitForFunction(() => window.__mainframeE2E !== undefined);
  await expect(cardIn(page, 'needs-you', id).getByTestId('task-ask')).toHaveText('Needs input');
  await expect(card(page, id).getByTestId('task-activity')).toHaveText('Asking you a question');
  await card(page, id).click();
  await run(page, 'echo still-$((2+2))');
  await expect.poll(() => screen(page, id)).toContain('still-4');
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
