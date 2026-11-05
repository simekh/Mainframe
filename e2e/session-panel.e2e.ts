import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { makeRepo } from '../src/main/testing/makeRepo';
import { cleanUp, launchApp, removeAfterTest } from './launch';
import { card, cardIn, launches, run, screen, sendLine, startTask } from './tasks';

test.afterEach(cleanUp);

function repo(): string {
  const { main } = makeRepo();
  removeAfterTest(dirname(main));
  return main;
}

function git(...args: string[]): void {
  execFileSync('git', args, { stdio: 'pipe' });
}

const CLOSED_NOTE = 'Closed. Reopen continues this chat.';
const HINT = 'Enter sends it to the session. Shift+Enter adds a line.';

const working = "printf '\\033]7501;state=working\\033\\\\'";
const blocked = "printf '\\033]7501;state=blocked:kind=question\\033\\\\'";

test('the header shows the task, project and branch, with Close session and then Reopen', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchApp({ THESOURCE_PROJECT_DIR: main });
  await startTask(page, 'Fix login');
  const panel = page.getByTestId('side-panel');
  const title = page.getByTestId('panel-title');
  await expect(title).toHaveText('Fix login');
  await expect(title).toHaveAttribute('title', 'Fix login');
  await expect(page.getByTestId('panel-project')).toHaveText('main');
  await expect(page.getByTestId('panel-branch')).toHaveText('worktree-fix-login');
  const state = page.getByTestId('panel-state');
  await expect(state.locator('.label')).toHaveText('Starting…');
  await expect(state.locator('.age')).toHaveText('');

  await run(page, working);
  await expect(panel.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'spin');
  await expect(state.locator('.label')).toHaveText('Working');
  await expect(state.locator('.label')).toHaveClass(/tone-accent/);
  await expect(state.locator('.age')).toHaveText('just now');
  await expect(page.getByTestId('close-session')).toHaveText('Close session');
  await expect(page.getByTestId('panel-reopen')).toHaveCount(0);

  await page.getByTestId('close-session').click();
  await expect(panel.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'dot');
  await expect(state.locator('.label')).toHaveText('Closed');
  await expect(state.locator('.age')).toHaveText('just now');
  await expect(page.getByTestId('close-session')).toHaveCount(0);
  await expect(page.getByTestId('panel-reopen')).toHaveText('Reopen');

  await page.getByTestId('panel-reopen').click();
  await expect(page.getByTestId('close-session')).toBeVisible();
  await expect(page.getByTestId('panel-reopen')).toHaveCount(0);
  await expect(state.locator('.label')).toHaveText('Starting…');
  await expect.poll(() => launches(dataDir).filter((l) => l.args.includes('--resume')).length).toBe(1);
  await app.close();
});

test('a task closed during this run keeps its terminal; one closed before it shows a note instead', async () => {
  const first = await launchApp();
  const id = await startTask(first.page, 'Fix login');
  await first.page.getByTestId('close-session').click();
  await expect(cardIn(first.page, 'closed', id)).toBeVisible();
  await expect.poll(() => screen(first.page, id)).toContain('[Process exited]');
  await expect(first.page.locator('.well > .terminal:not(.terminal--hidden)')).toBeVisible();
  await expect(first.page.getByText(CLOSED_NOTE)).toHaveCount(0);
  await first.app.close();

  const { app, page } = await launchApp({ THESOURCE_DATA_DIR: first.dataDir });
  await card(page, id).click();
  await expect(page.getByTestId('panel-title')).toHaveText('Fix login');
  await expect(page.getByText(CLOSED_NOTE)).toBeVisible();
  await expect(page.getByTestId('message-field')).toBeDisabled();

  await page.getByTestId('panel-reopen').click();
  await expect(page.getByText(CLOSED_NOTE)).toHaveCount(0);
  await expect.poll(() => screen(page, id)).toContain('$');
  await expect(page.getByTestId('message-field')).toBeEnabled();
  await app.close();
});

test('changed files lists what the task changed in its worktree', async () => {
  const main = repo();
  const { app, page } = await launchApp({ THESOURCE_PROJECT_DIR: main });
  await startTask(page, 'Fix login');
  const files = page.getByTestId('changed-files');
  const heading = files.locator('.pane-heading');
  // fake-claude makes no worktree: git finds none.
  await expect(heading.locator('.label')).toHaveText('Worktree removed');
  await expect(heading).toBeDisabled();

  // What `claude -w fix-login` would do, then a commit and an untracked file.
  const worktree = join(main, '.claude', 'worktrees', 'fix-login');
  git('-C', main, 'worktree', 'add', '-b', 'worktree-fix-login', worktree, 'origin/stage');
  writeFileSync(join(worktree, 'a.txt'), 'a\n');
  git('-C', worktree, 'add', 'a.txt');
  git('-C', worktree, 'commit', '-m', 'a');
  writeFileSync(join(worktree, 'u.txt'), 'u\n');

  await expect(files).toHaveAttribute('data-count', '2', { timeout: 7_000 });
  await expect(heading.locator('.label')).toHaveText('2 files changed');
  await expect(heading.locator('.diff')).toHaveText('+1');
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  const rows = files.getByTestId('changed-file');
  await expect(rows).toHaveCount(2);
  await expectRow(rows.nth(0), { status: 'A', letter: 'A', path: 'a.txt', diff: '+1' });
  await expectRow(rows.nth(1), { status: '?', letter: 'U', path: 'u.txt', diff: '' });

  // The heading collapses the list and opens it again.
  await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await expect(files.locator('.file-list')).toBeHidden();
  await heading.click();
  await expect(files.locator('.file-list')).toBeVisible();
  await app.close();
});

async function expectRow(row: Locator, want: { status: string; letter: string; path: string; diff: string }) {
  await expect(row).toHaveAttribute('data-status', want.status);
  await expect(row.locator('.st')).toHaveText(want.letter);
  await expect(row.locator('.path')).toHaveText(want.path);
  await expect(row.locator('.diff')).toHaveText(want.diff);
}

test('the message field sends one line as typed', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  const field = page.getByTestId('message-field');
  const send = page.getByTestId('message-send');
  await field.click();
  await expect(send).toBeDisabled();

  await page.keyboard.type('echo msg-$((2+2))');
  await expect(send).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page, id)).toContain('msg-4');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(send).toBeDisabled();

  // Blank: nothing is sent, so no empty prompt line comes before the next command.
  await page.keyboard.type('   ');
  await expect(send).toBeDisabled();
  await page.keyboard.press('Enter');
  await field.fill('echo msg-$((3+3))');
  await send.click();
  await expect.poll(() => screen(page, id)).toContain('msg-6');
  expect(await screen(page, id)).toMatch(/^msg-4\n[^\n]*\$ echo msg-\$\(\(3\+3\)\)\nmsg-6$/m);
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await app.close();
});

test('several lines arrive as one bracketed paste, then Enter', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  await run(page, "printf '\\033[?2004h'; cat -v");
  await page.getByTestId('message-field').click();
  await page.keyboard.type('first');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page, id)).toContain('^[[200~first');
  await expect.poll(() => screen(page, id)).toContain('second^[[201~');
  await app.close();
});

test('the message field tells when Claude waits in the terminal, and is off while the task is closed', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  const field = page.getByTestId('message-field');
  await expect(field).toBeEnabled();
  await expect(field).toHaveAttribute('placeholder', 'Message this session');
  await expect(page.getByText(HINT)).toBeVisible();

  await sendLine(page, id, blocked);
  await expect(field).toHaveAttribute('placeholder', 'Claude is waiting for your answer in the terminal');
  await sendLine(page, id, working);
  await expect(field).toHaveAttribute('placeholder', 'Message this session');

  await page.getByTestId('close-session').click();
  await expect(field).toBeDisabled();
  await expect(field).toHaveAttribute('placeholder', 'Reopen the session to send it a message');
  await expect(page.getByText(HINT)).toBeHidden();
  await expect(page.getByTestId('message-send')).toBeDisabled();
  await app.close();
});

test('a draft stays with the task it was written for', async () => {
  const { app, page } = await launchApp();
  const a = await startTask(page, 'Alpha');
  const b = await startTask(page, 'Beta');
  const field = page.getByTestId('message-field');
  await field.fill('for beta');
  await card(page, a).click();
  await expect(field).toHaveValue('');
  await expect(page.getByTestId('message-send')).toBeDisabled();
  await card(page, b).click();
  await expect(field).toHaveValue('for beta');
  await app.close();
});

const borderColor = (well: Locator) => well.evaluate((el) => getComputedStyle(el).borderTopColor);

test("the terminal's well shows the focus ring while the terminal has the focus", async () => {
  const { app, page } = await launchApp();
  await startTask(page);
  const well = page.locator('.well');
  // --border-focus, then --island-border.
  await expect.poll(() => borderColor(well)).toBe('rgb(103, 217, 237)');
  await page.getByTestId('message-field').click();
  await expect.poll(() => borderColor(well)).toBe('rgb(41, 52, 61)');
  await page.locator('.well > .terminal:not(.terminal--hidden)').click();
  await expect.poll(() => borderColor(well)).toBe('rgb(103, 217, 237)');
  await app.close();
});

const appRegion = (el: Locator) => el.evaluate((e) => getComputedStyle(e).getPropertyValue('-webkit-app-region'));

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

// CDP clicks skip native drag regions, so this pins the styles; Task 10 checks them with a real mouse.
test('the title bar drags the window, and its title, buttons and the pin take clicks', async () => {
  const { app, page } = await launchApp();
  await startTask(page, 'Fix login');
  const bar = page.locator('.p-title-bar');
  const pin = page.getByTestId('panel-pin');
  const title = page.getByTestId('panel-title');
  const close = page.getByTestId('close-session');

  // The empty space between the title and Close session is the bar itself.
  const t = await box(title);
  const c = await box(close);
  const empty = { x: (t.x + t.width + c.x) / 2, y: c.y + c.height / 2 };
  expect(c.x - (t.x + t.width)).toBeGreaterThan(20);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('p-title-bar'), empty)).toBe(
    true,
  );
  expect(await appRegion(bar)).toBe('drag');
  for (const el of [title, page.getByTestId('side-panel').getByTestId('task-glyph'), close, pin]) {
    expect(await appRegion(el)).toBe('no-drag');
  }
  await close.click();
  expect(await appRegion(page.getByTestId('panel-reopen'))).toBe('no-drag');

  // The pin comes first in the panel, so a drag box over it would take its clicks.
  const b = await box(bar);
  const p = await box(pin);
  const overlaps = b.x < p.x + p.width && p.x < b.x + b.width && b.y < p.y + p.height && p.y < b.y + b.height;
  expect(overlaps).toBe(false);
  // The actions sit just left of the pin, in one row with it.
  const r = await box(page.getByTestId('panel-reopen'));
  expect(Math.round(p.x - (r.x + r.width))).toBe(6);
  expect(Math.round(r.y + r.height / 2)).toBe(Math.round(p.y + p.height / 2));
  await app.close();
});
