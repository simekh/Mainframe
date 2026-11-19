import { rmSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import { card, dropFile, managerScreen, pngFile, TASK_TERMINAL, projectPane, railRow, repo, screen, startIn, startTask } from './tasks';

test.afterEach(cleanUp);

const MANAGER_TERMINAL = '[data-testid=manager-column] .terminal';

const thumbs = (scope: Page | Locator) => scope.getByTestId('image-thumb');

/**
 * Moves onto the shown task terminal's `text` from the row below, then clicks it with the system's link key held (Cmd on
 * the Mac, Ctrl on Windows and Linux); whether the terminal had marked a link there.
 */
function linkClick(page: Page, taskId: string, text: string): Promise<boolean> {
  const held = process.platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
  return page.evaluate(
    ([id, wanted, keys, sel]) => {
      const screenEl = document.querySelector(`${sel} .xterm-screen`)!;
      const lines = window.__mainframeE2E.screenText(id).split('\n');
      const size = window.__mainframeE2E.termSize(id)!;
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
      const hovered = screenEl.classList.contains('xterm-cursor-pointer');
      fire('mousedown', row, col);
      fire('mouseup', row, col);
      return hovered;
    },
    [taskId, text, held, TASK_TERMINAL] as const,
  );
}

/** Starts a task whose agent labels images, and drops PNGs with these names on it, in order. */
async function taskWithImages(page: Page, names = ['first.png', 'second.png']) {
  const a = await startTask(page);
  const paths = names.map(pngFile);
  for (const [i, path] of paths.entries()) {
    await dropFile(page, path, TASK_TERMINAL);
    await expect.poll(() => screen(page, a)).toContain(`[Image #${i + 1}]`);
    await expect(thumbs(page.locator('.session'))).toHaveCount(i + 1);
  }
  return { a, paths };
}

test('dropped images show in the strip under the terminal, numbered', async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  const a = await startTask(page);
  await expect(page.getByTestId('image-strip')).toHaveCount(0);
  for (const [i, path] of [pngFile('first.png'), pngFile('second.png')].entries()) {
    await dropFile(page, path, TASK_TERMINAL);
    await expect.poll(() => screen(page, a)).toContain(`[Image #${i + 1}]`);
  }
  const strip = page.locator('.session').getByTestId('image-strip');
  await expect(thumbs(strip)).toHaveText(['#1', '#2']);
  // Under the terminal's well, and both loaded.
  const [well, stripBox] = await Promise.all([page.locator('.session .well').boundingBox(), strip.boundingBox()]);
  expect(stripBox!.y).toBeGreaterThanOrEqual(well!.y + well!.height);
  await expect(strip.locator('img')).toHaveCount(2);
  await expect.poll(() => strip.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth))).toEqual([1, 1]);
  await app.close();
});

test('Cmd+click on [Image #2] opens it full size; arrows step, Esc closes', async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  const { a } = await taskWithImages(page);
  const viewer = page.getByTestId('image-viewer');
  await expect(viewer).toBeHidden();

  expect(await linkClick(page, a, '[Image #2]')).toBe(true);
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

  // A thumbnail opens it too, and the close button closes it.
  await thumbs(page.locator('.session')).first().click();
  await expect(viewer.getByTestId('image-viewer-number')).toHaveText('#1');
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();
  await app.close();
});

test('an image whose file is gone shows Not available', async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  const { paths } = await taskWithImages(page, ['first.png', 'second.png', 'third.png']);
  const viewer = page.getByTestId('image-viewer');
  // Shown once while the file is there: the page has it loaded, thumbnail and full size.
  await thumbs(page.locator('.session')).nth(1).click();
  await expect(viewer).toContainText('1 × 1');
  await page.keyboard.press('Escape');
  rmSync(paths[1]);
  await thumbs(page.locator('.session')).nth(1).click();
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

test("the manager's terminal has its own strip", async () => {
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' });
  await expect.poll(() => managerScreen(page)).toContain('$');
  const column = page.getByTestId('manager-column');
  await expect(column.getByTestId('image-strip')).toHaveCount(0);
  await dropFile(page, pngFile('plan.png'), MANAGER_TERMINAL);
  await expect.poll(() => managerScreen(page)).toContain('[Image #1]');
  await expect(thumbs(column)).toHaveText(['#1']);
  // The task's panel has none of it.
  const a = await startTask(page);
  expect(await screen(page, a)).not.toContain('[Image #1]');
  await expect(page.locator('.session').getByTestId('image-strip')).toHaveCount(0);
  await thumbs(column).click();
  await expect(page.getByTestId('image-viewer')).toContainText('plan.png');
  await app.close();
});

test('two projects side by side each show their own images', async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({ FAKE_CLAUDE_IMAGES: '1' }, [acme, globex]);
  await railRow(page, globex).hover();
  await railRow(page, globex).getByTestId('rail-beside').click();
  await expect(projectPane(page, globex)).toHaveAttribute('data-shown', 'true');

  const drops = [
    { dir: acme, name: 'acme.png' },
    { dir: globex, name: 'globex-1.png' },
    { dir: globex, name: 'globex-2.png' },
  ];
  const tasks = { [acme]: await startIn(page, acme, 'Acme'), [globex]: await startIn(page, globex, 'Globex') };
  for (const dir of [acme, globex]) await card(page, tasks[dir]).click();
  for (const { dir, name } of drops) {
    await dropFile(page, pngFile(name), `[data-testid=project-pane][data-project=${JSON.stringify(dir)}] ${TASK_TERMINAL}`);
  }
  await expect(thumbs(projectPane(page, acme).locator('.session'))).toHaveText(['#1']);
  await expect(thumbs(projectPane(page, globex).locator('.session'))).toHaveText(['#1', '#2']);

  await thumbs(projectPane(page, globex).locator('.session')).nth(1).click();
  await expect(page.getByTestId('image-viewer')).toContainText('globex-2.png');
  await app.close();
});
