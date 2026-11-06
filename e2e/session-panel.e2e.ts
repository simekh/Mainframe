import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, cardIn, fitSize, git, launches, repo, run, screen, sendLine, startTask, termSize } from './tasks';

test.afterEach(cleanUp);

const CLOSED_NOTE = 'Closed. Reopen continues this chat.';

const working = "printf '\\033]7501;state=working\\033\\\\'";

test('the header shows the task, project and branch, with Close session and then Reopen', async () => {
  const main = repo();
  const { app, page, dataDir } = await launchApp({ MAINFRAME_PROJECT_DIR: main });
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

  const { app, page } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir });
  await card(page, id).click();
  await expect(page.getByTestId('panel-title')).toHaveText('Fix login');
  await expect(page.getByText(CLOSED_NOTE)).toBeVisible();

  await page.getByTestId('panel-reopen').click();
  await expect(page.getByText(CLOSED_NOTE)).toHaveCount(0);
  await expect.poll(() => screen(page, id)).toContain('$');
  await app.close();
});

test('changed files lists what the task changed in its worktree', async () => {
  const main = repo();
  const { app, page } = await launchApp({ MAINFRAME_PROJECT_DIR: main });
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

/** Two frames: a layout change has been measured and any fit it caused has run. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

test('switching tasks resizes no terminal off screen, and none whose panel looks as it did', async () => {
  const main = repo();
  const { app, page } = await launchApp({ MAINFRAME_PROJECT_DIR: main });
  const files = page.getByTestId('changed-files');
  const a = await startTask(page, 'Alpha');
  // Three changed files in Alpha's worktree, as `claude -w alpha` and its edits would leave them.
  const worktree = join(main, '.claude', 'worktrees', 'alpha');
  git('-C', main, 'worktree', 'add', '-b', 'worktree-alpha', worktree, 'origin/stage');
  for (const name of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(worktree, name), `${name}\n`);
  await expect(files).toHaveAttribute('data-count', '3', { timeout: 12_000 });
  await settled(page);
  // Its own list grew while it showed, so it fitted the smaller well: that is its shown size.
  const shown = { [a]: (await termSize(page, a))! };

  const b = await startTask(page, 'Beta');
  await expect(files).toHaveAttribute('data-count', '0');
  await settled(page);
  shown[b] = (await termSize(page, b))!;
  expect(shown[b].rows).toBeGreaterThan(shown[a].rows);
  expect(await termSize(page, a)).toEqual(shown[a]);

  for (const [show, hidden, count] of [[a, b, '3'], [b, a, '0'], [a, b, '3'], [b, a, '0']]) {
    // Off screen long enough to have lost its WebGL renderer, which comes back as it shows.
    await page.waitForTimeout(1_100);
    await card(page, show).click();
    await expect(card(page, show)).toHaveAttribute('data-selected', 'true');
    await expect(files).toHaveAttribute('data-count', count);
    await settled(page);
    expect(await termSize(page, show)).toEqual(shown[show]);
    expect(await termSize(page, hidden)).toEqual(shown[hidden]);
  }

  // Alpha's own list collapsing fits it at once. Collapsed, the list takes no room, so both panels
  // have the same height from here: a switch alone leaves the well as it is.
  await card(page, a).click();
  await expect(files).toHaveAttribute('data-count', '3');
  await files.locator('.pane-heading').click();
  await expect(files.locator('.file-list')).toBeHidden();
  await settled(page);
  expect((await termSize(page, a))!.rows).toBeGreaterThan(shown[a].rows);
  shown[a] = (await termSize(page, a))!;
  expect(await termSize(page, b)).toEqual(shown[b]);

  // A wider panel fits the terminal on screen at once, and the other one as soon as it shows,
  // though the switch doesn't change the well.
  await card(page, b).click();
  await expect(files).toHaveAttribute('data-count', '0');
  await settled(page);
  expect(await termSize(page, b)).toEqual(shown[b]);
  await page.getByTestId('panel-resize').focus();
  await page.keyboard.press('ArrowLeft');
  await settled(page);
  expect((await termSize(page, b))!.cols).toBeGreaterThan(shown[b].cols);
  shown[b] = (await termSize(page, b))!;
  expect(await termSize(page, a)).toEqual(shown[a]);
  await card(page, a).click();
  await expect(card(page, a)).toHaveAttribute('data-selected', 'true');
  await settled(page);
  expect((await termSize(page, a))!.cols).toBeGreaterThan(shown[a].cols);
  shown[a] = (await termSize(page, a))!;
  expect(await fitSize(page, a)).toEqual(shown[a]);
  expect(await termSize(page, b)).toEqual(shown[b]);

  // The sessions have the sizes their terminals show, the one off screen too.
  for (const id of [a, b]) {
    await sendLine(page, id, 'stty size');
    await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${shown[id].rows} ${shown[id].cols}$`, 'm'));
  }
  await app.close();
});

async function expectRow(row: Locator, want: { status: string; letter: string; path: string; diff: string }) {
  await expect(row).toHaveAttribute('data-status', want.status);
  await expect(row.locator('.st')).toHaveText(want.letter);
  await expect(row.locator('.path')).toHaveText(want.path);
  await expect(row.locator('.diff')).toHaveText(want.diff);
}

test('the terminal runs to the bottom of the panel', async () => {
  const { app, page } = await launchApp();
  const id = await startTask(page);
  await settled(page);

  // The well ends where the panel's padding does: as far from the panel's bottom edge as from its sides.
  const panel = await box(page.getByTestId('side-panel'));
  const well = await box(page.locator('.well'));
  const gap = panel.y + panel.height - (well.y + well.height);
  expect(gap).toBeLessThanOrEqual(16);
  expect(Math.abs(gap - (well.x - panel.x))).toBeLessThanOrEqual(1);

  // The session has the size its terminal shows, now the well is taller.
  const size = (await termSize(page, id))!;
  await sendLine(page, id, 'stty size');
  await expect.poll(() => screen(page, id)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  await app.close();
});

const borderColor = (well: Locator) => well.evaluate((el) => getComputedStyle(el).borderTopColor);

test("the terminal's well shows the focus ring while the terminal has the focus", async () => {
  const { app, page } = await launchApp();
  await startTask(page);
  const well = page.locator('.well');
  // --border-focus, then --island-border.
  await expect.poll(() => borderColor(well)).toBe('rgb(103, 217, 237)');
  // The title takes no focus, so a click on it leaves the focus on the page itself.
  await page.getByTestId('panel-title').click();
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
