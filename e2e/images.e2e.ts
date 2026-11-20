import { rmSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, dropFile, managerScreen, pngFile, TASK_TERMINAL, projectPane, railRow, repo, screen, startIn, startTask } from './tasks';

test.afterEach(cleanUp);

const MANAGER_TERMINAL = '[data-testid=manager-column] .terminal';

/** A terminal on the page: its element, and the task it shows, or none for the manager's. */
type Where = { selector: string; taskId?: string };

/**
 * Moves onto the terminal's `text` from the row below, then clicks it with the system's link key held (Cmd on the Mac,
 * Ctrl on Windows and Linux).
 */
function linkClick(page: Page, where: Where, text: string): Promise<void> {
  const held = process.platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
  return page.evaluate(
    ([{ selector, taskId }, wanted, keys]) => {
      const e2e = window.__mainframeE2E;
      const screenEl = document.querySelector(`${selector} .xterm-screen`)!;
      const lines = (taskId ? e2e.screenText(taskId) : e2e.managerScreen()).split('\n');
      const size = (taskId ? e2e.termSize(taskId) : e2e.managerTermSize())!;
      const box = screenEl.getBoundingClientRect();
      const row = lines.findIndex((line) => line.includes(wanted));
      if (row < 0) throw new Error(`"${wanted}" is not on the screen`);
      const col = lines[row].indexOf(wanted) + wanted.length / 2;
      const at = (r: number, c: number) => ({ clientX: box.left + (c / size.cols) * box.width, clientY: box.top + ((r + 0.5) / size.rows) * box.height });
      const fire = (type: string, r: number, c: number) =>
        screenEl.dispatchEvent(
          new MouseEvent(type, { ...at(r, c), bubbles: true, cancelable: true, view: window, button: 0, buttons: type === 'mousedown' ? 1 : 0, ...keys }),
        );
      fire('mousemove', size.rows - 1, 0);
      fire('mousemove', row, col);
      fire('mousedown', row, col);
      fire('mouseup', row, col);
    },
    [where, text, held] as const,
  );
}

/**
 * Cmd+clicks the label (Ctrl+click on Windows and Linux) until the full-size view opens: the label is a link only once
 * its image is listed, and xterm marks it a moment after the pointer moves onto it.
 */
async function openLabel(page: Page, where: Where, text: string): Promise<void> {
  const viewer = page.getByTestId('image-viewer');
  await expect.poll(async () => (await linkClick(page, where, text), viewer.isVisible())).toBe(true);
}

/** Starts a task whose agent labels images, and drops PNGs with these names on it, in order, each labelled. */
async function taskWithImages(page: Page, names = ['first.png', 'second.png']) {
  const a = await startTask(page);
  const paths = names.map((name) => pngFile(name));
  for (const [i, path] of paths.entries()) {
    await dropFile(page, path, TASK_TERMINAL);
    await expect.poll(() => screen(page, a)).toContain(`[Image #${i + 1}]`);
  }
  return { a, paths };
}

test('Cmd+click on [Image #2] opens it full size; arrows step, Esc and the close button close it', async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  const { a } = await taskWithImages(page);
  const where = { selector: TASK_TERMINAL, taskId: a };
  const viewer = page.getByTestId('image-viewer');
  await expect(viewer).toBeHidden();

  await openLabel(page, where, '[Image #2]');
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#2');
  await expect(viewer).toContainText('second.png');
  await expect(viewer).toContainText('1 × 1');
  await expect(viewer.getByRole('button', { name: /^Show in (Finder|Explorer|Folder)$/ })).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#1');
  await expect(viewer).toContainText('first.png');
  // At the first image, left stays there.
  await page.keyboard.press('ArrowLeft');
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#1');
  await page.keyboard.press('ArrowRight');
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#2');

  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  await openLabel(page, where, '[Image #1]');
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#1');
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();
  await app.close();
});

test('an image whose file is gone shows Not available', async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  const { a, paths } = await taskWithImages(page, ['first.png', 'second.png', 'third.png']);
  const where = { selector: TASK_TERMINAL, taskId: a };
  const viewer = page.getByTestId('image-viewer');
  // Shown once while the file is there: the page has it loaded.
  await openLabel(page, where, '[Image #2]');
  await expect(viewer).toContainText('1 × 1');
  await page.keyboard.press('Escape');
  // The dialog closes a moment later: a click before then would land in the open one.
  await expect(viewer).toBeHidden();
  rmSync(paths[1]);
  await openLabel(page, where, '[Image #2]');
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#2');
  await expect(viewer).toContainText('Not available');
  await expect(viewer).toContainText('The file has been moved or deleted.');
  await expect(viewer).toContainText(paths[1]);
  await expect(viewer.getByRole('button', { name: /^Show in/ })).toHaveCount(0);
  const number = viewer.getByTestId('image-viewer-number');

  // The arrows still step from a missing image, onto a present one and back onto the missing one and past it.
  await page.keyboard.press('ArrowLeft');
  await expect(number).toHaveText('#1');
  await expect(viewer).toContainText('1 × 1');
  await page.keyboard.press('ArrowRight');
  await expect(number).toHaveText('#2');
  await expect(viewer).toContainText('Not available');
  await page.keyboard.press('ArrowRight');
  await expect(number).toHaveText('#3');
  await expect(viewer).toContainText('1 × 1');
  await expect(viewer.getByRole('button', { name: /^Show in/ })).toBeVisible();
  await app.close();
});

test("the manager's image labels open its own images", async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  await expect.poll(() => managerScreen(page)).toContain('$');
  await dropFile(page, pngFile('plan.png'), MANAGER_TERMINAL);
  await expect.poll(() => managerScreen(page)).toContain('[Image #1]');
  // The task's terminal has none of it.
  const a = await startTask(page);
  expect(await screen(page, a)).not.toContain('[Image #1]');
  await openLabel(page, { selector: MANAGER_TERMINAL }, '[Image #1]');
  await expect(page.getByTestId('image-viewer')).toContainText('plan.png');
  await app.close();
});

test("two projects side by side each open their own images", async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' }, [acme, globex]);
  await railRow(page, globex).hover();
  await railRow(page, globex).getByTestId('rail-beside').click();
  await expect(projectPane(page, globex)).toHaveAttribute('data-shown', 'true');

  const tasks = { [acme]: await startIn(page, acme, 'Acme'), [globex]: await startIn(page, globex, 'Globex') };
  for (const dir of [acme, globex]) await card(page, tasks[dir]).click();
  const where = (dir: string) => ({ selector: `[data-testid=project-pane][data-project=${JSON.stringify(dir)}] ${TASK_TERMINAL}`, taskId: tasks[dir] });
  const drops = [
    { dir: acme, name: 'acme.png', label: '[Image #1]' },
    { dir: globex, name: 'globex-1.png', label: '[Image #1]' },
    { dir: globex, name: 'globex-2.png', label: '[Image #2]' },
  ];
  for (const { dir, name, label } of drops) {
    await dropFile(page, pngFile(name), where(dir).selector);
    await expect.poll(() => screen(page, tasks[dir])).toContain(label);
  }

  const viewer = page.getByTestId('image-viewer');
  await openLabel(page, where(globex), '[Image #2]');
  await expect(viewer).toContainText('globex-2.png');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await openLabel(page, where(acme), '[Image #1]');
  await expect(viewer).toContainText('acme.png');
  await app.close();
});

test('a label Claude Code broke onto the next row is recorded, and opens its image from either row', async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1', FAKE_CLAUDE_WRAP_LABELS: '1' });
  const a = await startTask(page);
  await dropFile(page, pngFile('wrapped.png'), TASK_TERMINAL);
  // Split across two rows: neither holds the whole label.
  await expect.poll(() => screen(page, a)).toMatch(/\[Image\s*\n\s*#1\]/);
  expect(await screen(page, a)).not.toContain('[Image #1]');
  const where = { selector: TASK_TERMINAL, taskId: a };
  const viewer = page.getByTestId('image-viewer');
  for (const part of ['[Image', '#1]']) {
    await openLabel(page, where, part);
    await expect(viewer).toContainText('wrapped.png');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
  }
  await app.close();
});
