import { existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, git, ids, repo, startTask } from './tasks';

test.afterEach(cleanUp);

/**
 * Mainframe on a repo with one task, Fix login, whose worktree has a committed `a.txt` of 200 lines
 * and an untracked `b.txt` with blank lines in it, once the panel lists both.
 */
async function withTask() {
  const main = repo();
  const launched = await launchApp({}, main);
  const { page } = launched;
  await startTask(page, 'Fix login');
  // What `claude -w fix-login` would do, then a commit and an untracked file.
  const worktree = join(main, '.claude', 'worktrees', 'fix-login');
  git('-C', main, 'worktree', 'add', '-b', 'worktree-fix-login', worktree, 'origin/stage');
  writeFileSync(join(worktree, 'a.txt'), Array.from({ length: 200 }, (_, i) => `line ${i + 1}\n`).join(''));
  git('-C', worktree, 'add', 'a.txt');
  git('-C', worktree, 'commit', '-m', 'a');
  writeFileSync(join(worktree, 'b.txt'), 'first\n\n\nfourth\n  indented\n');
  const rows = page.getByTestId('changed-file');
  await expect(rows).toHaveCount(2, { timeout: 12_000 });
  return { ...launched, main, worktree, rows };
}

/** Clicks the row and resolves with the diff window it opens. */
async function openFrom(app: ElectronApplication, row: Locator): Promise<Page> {
  const opened = app.waitForEvent('window');
  await row.click();
  return opened;
}

/**
 * Presses Esc in the diff window and resolves once it has closed. Only the key's down: the page closes
 * on it, so there is no page left for the key's up to reach.
 */
async function pressEsc(diff: Page): Promise<void> {
  const closed = diff.waitForEvent('close');
  await diff.keyboard.down('Escape');
  await closed;
}

/** Every window's title, and whether its parent is Mainframe's window, the one without a parent. */
const windowsOf = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const mainframe = all.find((w) => w.getParentWindow() === null)!;
    return all.filter((w) => w !== mainframe).map((w) => ({ title: w.getTitle(), aboveMainframe: w.getParentWindow() === mainframe }));
  });

test("clicking a changed file opens the diff window above Mainframe's, titled for the task and project, at that file", async () => {
  const { app, main, rows } = await withTask();
  const diff = await openFrom(app, rows.nth(1));

  const sections = diff.getByTestId('diff-file');
  await expect(sections).toHaveCount(2);
  await expect(diff.locator('[data-testid=diff-file][data-path="a.txt"] .diff-line[data-kind=add]')).toHaveCount(200);
  await expect(diff.locator('[data-testid=diff-list-row][data-path="b.txt"]')).toHaveAttribute('aria-current', 'true');
  await expect(diff.locator('[data-testid=diff-file][data-path="b.txt"]')).toBeInViewport();
  expect(await windowsOf(app)).toEqual([{ title: `Changes · Fix login · ${basename(main)}`, aboveMainframe: true }]);
  await app.close();
});

test("selecting a file's lines copies only the code, blank lines kept", async () => {
  const { app, rows } = await withTask();
  const diff = await openFrom(app, rows.nth(1));
  const code = diff.locator('[data-testid=diff-file][data-path="b.txt"] .code');
  await expect(code).toHaveCount(5);
  const selected = await code.evaluateAll((spans) => {
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 0);
    range.setEnd(spans[4].firstChild!, spans[4].textContent!.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    return getSelection()!.toString();
  });
  expect(selected).toBe('first\n\n\nfourth\n  indented');
  await app.close();
});

test('a second click reuses the window, reads the changes again, and loads another task into it', async () => {
  const { app, page, main, worktree, rows } = await withTask();
  const diff = await openFrom(app, rows.nth(1));
  await expect(diff.getByTestId('diff-file')).toHaveCount(2);

  writeFileSync(join(worktree, 'c.txt'), 'c\n');
  await rows.nth(1).click();
  await expect(diff.getByTestId('diff-file')).toHaveCount(3);
  expect(app.windows()).toHaveLength(2);

  const other = await startTask(page, 'Other');
  const otherTree = join(main, '.claude', 'worktrees', 'other');
  git('-C', main, 'worktree', 'add', '-b', 'worktree-other', otherTree, 'origin/stage');
  writeFileSync(join(otherTree, 'o.txt'), 'o\n');
  await card(page, other).click();
  await expect(rows).toHaveCount(1, { timeout: 12_000 });
  await rows.nth(0).click();

  await expect(diff.getByTestId('diff-file')).toHaveCount(1);
  await expect(diff.getByTestId('diff-file')).toHaveAttribute('data-path', 'o.txt');
  expect(app.windows()).toHaveLength(2);
  expect(await windowsOf(app)).toEqual([{ title: `Changes · Other · ${basename(main)}`, aboveMainframe: true }]);
  await app.close();
});

test('two quick opens end on the later one', async () => {
  const { app, page, main } = await withTask();
  const [id] = await ids(page);
  const opened = app.waitForEvent('window');
  const first = page.evaluate(([dir, task]) => window.mainframe.openDiff(dir, task, 'a.txt'), [main, id] as const);
  await page.evaluate(([dir, task]) => window.mainframe.openDiff(dir, task, 'b.txt'), [main, id] as const);
  await first;
  const diff = await opened;
  await expect(diff.locator('[data-testid=diff-list-row][data-path="b.txt"]')).toHaveAttribute('aria-current', 'true');
  await app.close();
});

test('Esc and Cmd+W (Ctrl+W off the Mac) close the diff window, and a click opens it again', async () => {
  const { app, rows } = await withTask();
  const diff = await openFrom(app, rows.nth(1));
  await expect(diff.getByTestId('diff-file')).toHaveCount(2);

  await pressEsc(diff);
  expect(app.windows()).toHaveLength(1);

  const again = await openFrom(app, rows.nth(0));
  await expect(again.getByTestId('diff-file')).toHaveCount(2);
  expect(app.windows()).toHaveLength(2);

  // Only the keys' downs, as in pressEsc.
  const closed = again.waitForEvent('close');
  await again.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await again.keyboard.down('w');
  await closed;
  expect(app.windows()).toHaveLength(1);
  await app.close();
});

test('the diff window opens at the size it was left', async () => {
  const { app, dataDir, rows } = await withTask();
  const diff = await openFrom(app, rows.nth(1));
  await expect(diff.getByTestId('diff-file')).toHaveCount(2);
  const diffWindow = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getParentWindow() !== null)!.getSize());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getParentWindow() !== null)!.setSize(900, 600));

  await pressEsc(diff);
  expect(existsSync(join(dataDir, 'diff-window.json'))).toBe(true);

  const again = await openFrom(app, rows.nth(1));
  await expect(again.getByTestId('diff-file')).toHaveCount(2);
  expect(await diffWindow()).toEqual([900, 600]);
  await app.close();
});

test("closing Mainframe's window with the diff window open ends the app", async () => {
  const { app, rows } = await withTask();
  const diff = await openFrom(app, rows.nth(1));
  await expect(diff.getByTestId('diff-file')).toHaveCount(2);

  const ended = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getParentWindow() === null)!.close());
  await ended;
});
