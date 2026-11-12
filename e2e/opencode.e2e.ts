import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchWithOpencode } from './launch';
import { card, cardIn, closeTask, envOf, git, ids, launches, report, repo, screen, sendLine, SESSION_ID } from './tasks';

test.afterEach(cleanUp);

/** Starts an OpenCode task through the New task box; resolves with its id once its shell prompt shows. */
async function startOpencodeTask(page: Page, title: string): Promise<string> {
  const before = await ids(page);
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill(title);
  await page.getByTestId('new-task-agent-opencode').check();
  await page.getByTestId('new-task-start').click();
  const added = async () => (await ids(page)).filter((id) => !before.includes(id));
  await expect.poll(added).toHaveLength(1);
  const [id] = await added();
  await expect.poll(() => screen(page, id)).toContain('$');
  return id;
}

test('an OpenCode task starts in its own worktree', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchWithOpencode(main);
  const id = await startOpencodeTask(page, 'Fix login');

  const [first, ...rest] = launches(dataDir);
  expect(rest).toEqual([]);
  expect(realpathSync(first.cwd)).toBe(realpathSync(join(main, '.claude', 'worktrees', 'fix-login')));
  expect(first.args).toHaveLength(5);
  expect(first.args.slice(0, 2)).toEqual(['--standalone', '-s']);
  expect(first.args[2]).toMatch(SESSION_ID);
  expect(first.args[3]).toBe('--prompt');
  expect(first.args[4]).toContain('AGENTS.md');
  git('-C', main, 'rev-parse', '--verify', 'worktree-fix-login');
  expect(envOf(first).OPENCODE_CLI_CONFIG_CONTENT).toBe('{"tabs":{"mode":"off"}}');
  expect(envOf(first).OPENCODE_CONFIG_CONTENT).toBeUndefined();
  await expect(card(page, id).getByTestId('task-agent')).toHaveText('OpenCode');
  await app.close();
});

test('its card follows the summary record', async () => {
  const { app, page } = await launchWithOpencode(repo());
  const id = await startOpencodeTask(page, 'Fix login');

  await sendLine(page, id, report('working'));
  await expect(cardIn(page, 'working', id).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');

  // A child session's record, as OpenCode separates its fields: the echo after it shows once it has been handled.
  await sendLine(page, id, `printf '\\033]7501;state=idle:id=ses_child\\033\\\\'; echo child-$((1+1))`);
  await expect.poll(() => screen(page, id)).toContain('child-2');
  await expect(cardIn(page, 'working', id).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  await app.close();
});

test('Quit mid-turn carries the OpenCode session on', async () => {
  const main = repo();
  const first = await launchWithOpencode(main);
  const id = await startOpencodeTask(first.page, 'Fix login');
  await sendLine(first.page, id, report('working'));
  await expect(cardIn(first.page, 'working', id).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  await first.app.close();
  const [start] = launches(first.dataDir);

  const second = await launchWithOpencode(main, undefined, { MAINFRAME_DATA_DIR: first.dataDir });
  // On the content: the stand-in creates its file before it writes the arguments.
  await expect.poll(() => launches(first.dataDir)[1]?.args.at(-1)).toBe('Continue where you left off.');
  const reopened = launches(first.dataDir)[1];
  expect(reopened.args).toEqual(['--standalone', '-s', start.args[2], '--prompt', 'Continue where you left off.']);
  expect(reopened.cwd).toBe(start.cwd);
  await second.app.close();
});

test('an OpenCode task closed and reopened from its card resumes the same session in its worktree', async () => {
  const { app, page, dataDir } = await launchWithOpencode(repo());
  const id = await startOpencodeTask(page, 'Fix login');
  // Its turn is over, so the reopen owes it no prompt.
  await sendLine(page, id, `${report('working')}; ${report('idle')}`);
  await expect(cardIn(page, 'needs-you', id)).toHaveCount(1);

  await closeTask(page, id);
  await cardIn(page, 'closed', id).getByTestId('reopen').click();
  // On the arguments: the stand-in creates its file before it writes them.
  await expect.poll(() => launches(dataDir)[1]?.args.length).toBe(3);
  const [start, reopened] = launches(dataDir);
  expect(reopened.args).toEqual(['--standalone', '-s', start.args[2]]);
  expect(reopened.cwd).toBe(start.cwd);
  await app.close();
});

test('the dialog says when a ticked OpenCode is too old', async () => {
  // Not found, an OpenCode with no tick saved counts as unticked, and the box would say nothing of it.
  const settings = { welcomeSeen: true, agents: { opencode: { enabled: true } } };
  const { app, page } = await launchWithOpencode(repo(), settings, { FAKE_OPENCODE_VERSION: '1.18.35' });
  await page.getByTestId('new-task').click();
  await expect(page.getByTestId('new-task-agent-hint')).toHaveText('OpenCode 1.18.35 is installed. Mainframe needs 2.1.0 or later.');
  await expect(page.getByTestId('new-task-agent-opencode')).toHaveCount(0);
  await app.close();
});
