import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, cardIn, git, launches, repo, run, screen, sendLine, startTask } from './tasks';

test.afterEach(cleanUp);

const CLOSED_NOTE = 'Closed. Reopen continues this chat.';
const HINT = 'Enter sends it to the session. Shift+Enter adds a line.';
const BLOCKED_HINT = 'Answer Claude in the terminal first. Your message stays here.';

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
  // fake-claude makes no worktree: git finds none yet while the session runs.
  await expect(files).toHaveAttribute('data-count', '0');
  await expect(heading.locator('.label')).toHaveText('No changes yet');
  await expect(heading).toBeDisabled();

  // What `claude -w fix-login` would do, then a commit and an untracked file.
  const worktree = join(main, '.claude', 'worktrees', 'fix-login');
  git('-C', main, 'worktree', 'add', '-b', 'worktree-fix-login', worktree, 'origin/stage');
  writeFileSync(join(worktree, 'a.txt'), 'a\n');
  git('-C', worktree, 'add', 'a.txt');
  git('-C', worktree, 'commit', '-m', 'a');
  writeFileSync(join(worktree, 'u.txt'), 'u\n');

  await expect(files).toHaveAttribute('data-count', '2', { timeout: 12_000 });
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

  // The worktree goes away while the session still runs: the next poll finds no worktree.
  git('-C', main, 'worktree', 'remove', '--force', worktree);
  await expect(heading.locator('.label')).toHaveText('Worktree removed', { timeout: 12_000 });
  await expect(files).toHaveAttribute('data-count', '0');
  await expect(heading).toBeDisabled();
  await expect(files.locator('.file-list')).toBeHidden();
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

/** Runs `cat -v` with bracketed paste on; resolves once xterm has seen it switched on. */
async function catWithBracketedPaste(page: Page, taskId: string): Promise<void> {
  await run(page, "printf '\\033[?2004h'; echo ready; cat -v");
  await expect.poll(() => screen(page, taskId)).toMatch(/^ready$/m);
}

test('several lines arrive as one bracketed paste, then Enter', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  await catWithBracketedPaste(page, id);
  await page.getByTestId('message-field').click();
  await page.keyboard.type('first');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page, id)).toContain('^[[200~first');
  await expect.poll(() => screen(page, id)).toContain('second^[[201~');
  await app.close();
});

test('a second message waits until the first one has had its Enter', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  await catWithBracketedPaste(page, id);
  const field = page.getByTestId('message-field');
  const send = page.getByTestId('message-send');
  // 40 lines, so the first message's Enter comes 500 ms after its paste. All in one task of the page:
  // that Enter's timer can't run between these steps. The events go to the field's own handlers.
  const during = await page.evaluate((first) => {
    const area = document.querySelector<HTMLTextAreaElement>('[data-testid=message-field]')!;
    const button = document.querySelector<HTMLButtonElement>('[data-testid=message-send]')!;
    const type = (value: string) => {
      area.value = value;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // False when a handler prevented it.
    const enter = () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    type(first);
    const firstTaken = !enter();
    const afterFirst = area.value;
    type('second');
    const sendDisabled = button.disabled;
    const secondTaken = !enter();
    return { firstTaken, afterFirst, sendDisabled, secondTaken, afterSecond: area.value };
  }, Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'));
  expect(during).toEqual({ firstTaken: true, afterFirst: '', sendDisabled: true, secondTaken: true, afterSecond: 'second' });
  await expect.poll(() => screen(page, id)).toContain('^[[200~line 0');

  await expect(send).toBeEnabled();
  await field.press('Enter');
  await expect(field).toHaveValue('');
  // Its own paste on its own line: the first message's Enter came before it.
  await expect.poll(() => screen(page, id)).toMatch(/^\^\[\[200~second\^\[\[201~$/m);
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

test('while Claude waits in the terminal, the message field keeps its draft and sends nothing', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  const field = page.getByTestId('message-field');
  const send = page.getByTestId('message-send');
  await sendLine(page, id, blocked);
  await expect(field).toHaveAttribute('placeholder', 'Claude is waiting for your answer in the terminal');
  await expect(page.getByText(BLOCKED_HINT, { exact: true })).toBeVisible();

  await field.click();
  await page.keyboard.type('echo held-$((6*7))');
  await expect(send).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('echo held-$((6*7))');
  await expect(send).toBeDisabled();
  // Nothing reached the shell: a line written after the Enter runs on its own, and nothing ran before it.
  await sendLine(page, id, 'echo probe-$((1+1))');
  await expect.poll(() => screen(page, id)).toMatch(/^probe-2$/m);
  expect(await screen(page, id)).not.toContain('held');

  await sendLine(page, id, working);
  await expect(field).toHaveAttribute('placeholder', 'Message this session');
  await expect(page.getByText(HINT, { exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  await field.press('Enter');
  await expect.poll(() => screen(page, id)).toMatch(/^held-42$/m);
  await expect(field).toHaveValue('');
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

  // The pin and the resize handle come first in the panel, so a drag box over them would take their clicks.
  const b = await box(bar);
  const p = await box(pin);
  const overlaps = (o: { x: number; y: number; width: number; height: number }) =>
    b.x < o.x + o.width && o.x < b.x + b.width && b.y < o.y + o.height && o.y < b.y + b.height;
  expect(overlaps(p)).toBe(false);
  expect(overlaps(await box(page.getByTestId('panel-resize')))).toBe(false);
  // The title row still lines up with the project and branch row under it, 16px in.
  const glyph = await box(page.getByTestId('side-panel').getByTestId('task-glyph'));
  expect(Math.round(glyph.x)).toBe(Math.round((await box(page.getByTestId('panel-project'))).x));
  // The actions sit just left of the pin, in one row with it.
  const r = await box(page.getByTestId('panel-reopen'));
  expect(Math.round(p.x - (r.x + r.width))).toBe(6);
  expect(Math.round(r.y + r.height / 2)).toBe(Math.round(p.y + p.height / 2));
  await app.close();
});
