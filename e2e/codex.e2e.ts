import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { AppSettings } from '../src/main/setup/settings';
import { cleanUp, fakeCodex, launchApp, launchWithCodex, removeAfterTest } from './launch';
import {
  card, cardIn, closeTask, codexSyncReply, envOf, fakeLogDir, git, launches, managerLaunches, report, repo, sendLine, startTask, syncLaunches,
} from './tasks';

test.afterEach(cleanUp);

const ON_CODEX: AppSettings = { welcomeSeen: true, defaultAgent: 'codex' };

/** Codex's strict answer schema has every top-level field: what an answer leaves out, it prints as null. */
const answer = (fields: object) => ({ kind: null, message: null, connector: null, readTools: null, lists: null, source: null, cards: null, ...fields });

const TOOLS = answer({ kind: 'tools', connector: 'Tracker', readTools: ['mcp__tracker__get_cards'] });

const CARDS = answer({
  kind: 'cards',
  source: { kind: 'Tracker', board: 'Shop', list: 'To do', url: 'https://tracker.example/shop/to-do' },
  cards: [
    { id: 'c128', number: '#128', title: 'Search ignores accents', description: '', labels: [], checklists: [], url: null, forOwner: false, urgent: false },
  ],
});

test('a Codex task starts in its own worktree under .mainframe/worktrees', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchWithCodex(main);
  const id = await startTask(page, 'Fix login', '', 'codex');

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
  const id = await startTask(page, 'Fix login', '', 'codex');
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
  const id = await startTask(first.page, 'Fix login', '', 'codex');
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
  // The fake codex prints only the environment context until the test writes this file.
  const promptInput = join(fakeLogDir(dataDir), 'codex-prompt-input.json');

  await page.getByTestId('new-task').click();
  await expect(page.getByTestId('new-task-codex-note')).toHaveCount(0);
  await page.getByTestId('new-task-agent-codex').check();
  const note = page.getByTestId('new-task-codex-note');
  await expect(note).toContainText(`Codex won't read this project's CLAUDE.md. Add this line at the top of ${join(codexHome, 'config.toml')} (or, if the file already has project_doc_fallback_filenames, add "CLAUDE.md" to that list), then start the task:`);
  await expect(note).toContainText('project_doc_fallback_filenames = ["CLAUDE.md"]');
  await expect(page.getByTestId('new-task-codex-note-copy')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-task-title')).toHaveCount(0);

  // Codex loads the project's instructions now, as after the line was added.
  const loaded = { type: 'message', role: 'user', content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${main}\n\n# Rules\n` }] };
  const environment = { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n</environment_context>' }] };
  writeFileSync(promptInput, JSON.stringify([loaded, environment]));
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

test("the manager starts on Codex with Mainframe's server, its tools' approvals and its role, the token only in its environment", async () => {
  const main = repo();
  const { app, dataDir } = await launchWithCodex(main, {}, ON_CODEX);
  // On the arguments: the stand-in creates its file before it writes them.
  await expect.poll(() => managerLaunches(dataDir)[0]?.args[0]).toBe('-c');
  const [launch] = managerLaunches(dataDir);
  expect(realpathSync(launch.cwd)).toBe(realpathSync(main));
  expect(launch.args).not.toContain('resume');
  expect(launch.args).toContainEqual(expect.stringMatching(/^mcp_servers\.mainframe\.url="http:\/\/127\.0\.0\.1:/));
  expect(launch.args).toContain('mcp_servers.mainframe.tools.start_task.approval_mode="prompt"');
  expect(launch.args).toContainEqual(expect.stringMatching(/^developer_instructions=.*call list_sessions/s));

  const token = envOf(launch).MAINFRAME_MCP_TOKEN;
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(launch.args.filter((arg) => arg.includes(token))).toEqual([]);
  await app.close();
});

test('after a tool call names the chat, the next start resumes it', async () => {
  const main = repo();
  const id = '01a1e9f7-dc3e-7483-81d3-5c390b1a5b42';
  const first = await launchWithCodex(main, { FAKE_CODEX_SESSION_ID: id }, ON_CODEX);
  const { dataDir } = first;
  await expect.poll(() => managerLaunches(dataDir)[0]?.args[0]).toBe('-c');
  // The stand-in's list_sessions call, naming the chat as Codex does, was answered: it records the answer's status.
  const called = managerLaunches(dataDir)[0].file.replace(/\.argv$/, '.called');
  await expect.poll(() => existsSync(called) && readFileSync(called, 'utf8')).toBe('200');
  await first.app.close();

  const second = await launchWithCodex(main, { MAINFRAME_DATA_DIR: dataDir }, ON_CODEX);
  await expect.poll(() => managerLaunches(dataDir)[1]?.args.slice(0, 2)).toEqual(['resume', '-c']);
  expect(managerLaunches(dataDir)[1].args).toContain(id);
  await second.app.close();
});

test('a sync on Codex finds the connector, then reads with only the confirmed tools', async () => {
  const { app, page, dataDir } = await launchWithCodex(repo(), {}, ON_CODEX);
  writeFileSync(join(fakeLogDir(dataDir), 'codex-mcp-list.json'), JSON.stringify([{ name: 'tracker', enabled: true }]));
  const panel = page.getByTestId('todo-panel');
  codexSyncReply(dataDir, TOOLS);
  await page.getByTestId('todo-toggle').click();
  await page.getByTestId('todo-sync').click();
  await expect(panel.getByTestId('todo-confirm-tools')).toBeVisible();

  const [discover] = syncLaunches(dataDir);
  expect(discover.args).toContain('mcp_servers.tracker.default_tools_approval_mode="prompt"');
  expect(discover.args).toContain('--output-schema');

  codexSyncReply(dataDir, CARDS);
  await panel.getByTestId('todo-confirm-tools').click();
  await expect(panel.getByTestId('todo-item')).toHaveCount(1);
  await expect(panel.getByTestId('todo-item')).toContainText('Search ignores accents');
  const read = syncLaunches(dataDir)[1];
  expect(read.args).toContain('mcp_servers.tracker.enabled_tools=["get_cards"]');
  expect(read.args).toContain('mcp_servers.tracker.tools.get_cards.approval_mode="approve"');
  await app.close();
});
