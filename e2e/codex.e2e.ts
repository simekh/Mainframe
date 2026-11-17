import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cleanUp, fakeCodex, launchApp, launchWithCodex, removeAfterTest } from './launch';
import { card, cardIn, closeTask, fakeLogDir, git, ids, launches, report, repo, screen, sendLine } from './tasks';

test.afterEach(cleanUp);

/** Starts a Codex task through the New task box; resolves with its id once its shell prompt shows. */
async function startCodexTask(page: Page, title: string): Promise<string> {
  const before = await ids(page);
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill(title);
  await page.getByTestId('new-task-agent-codex').check();
  await page.getByTestId('new-task-start').click();
  const added = async () => (await ids(page)).filter((id) => !before.includes(id));
  await expect.poll(added).toHaveLength(1);
  const [id] = await added();
  await expect.poll(() => screen(page, id)).toContain('$');
  return id;
}

test('a Codex task starts in its own worktree under .mainframe/worktrees', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchWithCodex(main);
  const id = await startCodexTask(page, 'Fix login');

  const [first, ...rest] = launches(dataDir);
  expect(rest).toEqual([]);
  expect(realpathSync(first.cwd)).toBe(realpathSync(join(main, '.mainframe', 'worktrees', 'fix-login')));
  // The opening prompt and nothing else: Mainframe passes Codex no setting.
  expect(first.args).toHaveLength(1);
  expect(first.args[0]).toContain('Task: Fix login');
  git('-C', main, 'rev-parse', '--verify', 'worktree-fix-login');
  await expect(card(page, id).getByTestId('task-agent')).toHaveText('Codex');
  await app.close();
});

test('a Codex task closed and reopened from its card runs `codex resume --last` in its worktree', async () => {
  const { app, page, dataDir } = await launchWithCodex(repo());
  const id = await startCodexTask(page, 'Fix login');
  // It began, and its turn is over, so the reopen resumes it and owes it no prompt.
  await sendLine(page, id, `${report('working')}; ${report('idle')}`);
  await expect(cardIn(page, 'needs-you', id)).toHaveCount(1);

  await closeTask(page, id);
  await cardIn(page, 'paused', id).getByTestId('reopen').click();
  // On the content: the stand-in creates its file before it writes the arguments.
  await expect.poll(() => launches(dataDir)[1]?.args).toEqual(['resume', '--last']);
  const [start, reopened] = launches(dataDir);
  expect(reopened.cwd).toBe(start.cwd);
  await app.close();
});

test('Quit mid-turn carries the Codex session on with resume --last and the carry-on prompt', async () => {
  const main = repo();
  const first = await launchWithCodex(main);
  const id = await startCodexTask(first.page, 'Fix login');
  await sendLine(first.page, id, report('working'));
  await expect(cardIn(first.page, 'working', id).getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  await first.app.close();
  const [start] = launches(first.dataDir);

  const second = await launchWithCodex(main, { MAINFRAME_DATA_DIR: first.dataDir });
  await expect.poll(() => launches(first.dataDir)[1]?.args).toEqual(['resume', '--last', 'Continue where you left off.']);
  expect(launches(first.dataDir)[1].cwd).toBe(start.cwd);
  await second.app.close();
});

test("the New task box says when Codex won't read the project's CLAUDE.md", async () => {
  const main = repo();
  writeFileSync(join(main, 'CLAUDE.md'), '# Rules\n');
  // Codex's config folder of the test's own, so the note names no file on the machine running it.
  const codexHome = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-codex-home-')));
  const { app, page, dataDir } = await launchWithCodex(main, { CODEX_HOME: codexHome });
  const promptInput = join(fakeLogDir(dataDir), 'codex-prompt-input.json');
  writeFileSync(promptInput, '[]');

  await page.getByTestId('new-task').click();
  await expect(page.getByTestId('new-task-codex-note')).toHaveCount(0);
  await page.getByTestId('new-task-agent-codex').check();
  const note = page.getByTestId('new-task-codex-note');
  await expect(note).toContainText(`Codex won't read this project's CLAUDE.md. Add this line at the top of ${join(codexHome, 'config.toml')}, then start the task:`);
  await expect(note).toContainText('project_doc_fallback_filenames = ["CLAUDE.md"]');
  await expect(page.getByTestId('new-task-codex-note-copy')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-task-title')).toHaveCount(0);

  // Codex loads the project's instructions now, as after the line was added.
  const loaded = { type: 'message', role: 'user', content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${main}\n\n# Rules\n` }] };
  writeFileSync(promptInput, JSON.stringify([loaded]));
  // Main's answer first: an absent note alone would pass while the box is still asking.
  expect(await page.evaluate((d) => window.mainframe.codexClaudeMdNote(d), main)).toBeNull();
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-agent-codex').check();
  await expect(page.getByTestId('new-task-agent-codex')).toBeChecked();
  await expect(page.getByTestId('new-task-codex-note')).toHaveCount(0);
  await app.close();
});

test('setup lists Codex', async () => {
  const { app, page } = await launchApp({ MAINFRAME_CODEX_BIN: fakeCodex }, undefined, { firstStart: true });
  const row = page.locator('.setup-agent').filter({ has: page.getByTestId('setup-tick-codex') });
  await expect(row).toContainText('Codex');
  await expect(row).toContainText('v0.169.0');
  await app.close();
});
