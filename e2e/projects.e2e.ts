import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { cleanUp, launchApp, setWindowWidth } from './launch';
import { launches, managerLaunches, report, repo, screen, sendLine } from './tasks';

test.afterEach(cleanUp);

const pane = (page: Page, dir: string) => page.locator(`[data-testid=project-pane][data-project="${dir}"]`);
const row = (page: Page, dir: string) => page.locator(`[data-testid=rail-project][data-project="${dir}"]`);
const boxOf = async (locator: Locator) => (await locator.boundingBox())!;
const openProjects = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')).open;

/** Starts a task in the project through the bridge, on screen or not; resolves with its id once its prompt shows. */
async function startIn(page: Page, dir: string, title: string): Promise<string> {
  const task = await page.evaluate(
    ([d, t]) => window.mainframe.startTask(d, { title: t, description: '', noQuestions: false }),
    [dir, title] as const,
  );
  await expect.poll(() => screen(page, task.id)).toContain('$');
  return task.id;
}

/** A row's own buttons show while the pointer is on it. */
async function rowButton(page: Page, dir: string, testId: string): Promise<Locator> {
  await row(page, dir).hover();
  return row(page, dir).getByTestId(testId);
}

test('each open project has its own board and manager; the list shows one in place of another or puts one beside it', async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page, dataDir } = await launchApp({}, [acme, globex]);
  await expect(page.getByTestId('rail-project')).toHaveCount(2);
  await expect(pane(page, acme)).toHaveAttribute('data-shown', 'true');
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'false');

  const id = await startIn(page, globex, 'Globex work');
  await expect(pane(page, globex).locator(`[data-testid=task-card][data-task-id="${id}"]`)).toHaveCount(1);
  await expect(pane(page, acme).getByTestId('task-card')).toHaveCount(0);
  await expect.poll(() => managerLaunches(dataDir).map((l) => realpathSync(l.cwd)).sort()).toEqual(
    [acme, globex].map((dir) => realpathSync(dir)).sort(),
  );

  await row(page, globex).getByTestId('rail-show').click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  await expect(pane(page, acme)).toHaveAttribute('data-shown', 'false');

  await (await rowButton(page, acme, 'rail-beside')).click();
  await expect(pane(page, acme)).toHaveAttribute('data-shown', 'true');
  const before = { globex: await boxOf(pane(page, globex)), acme: await boxOf(pane(page, acme)) };
  // Side by side in the order they came on screen, sharing the width.
  expect(before.globex.x + before.globex.width).toBeLessThanOrEqual(before.acme.x + 1);
  expect(Math.abs(before.globex.width - before.acme.width)).toBeLessThanOrEqual(2);
  // For room, each leaves its manager out and floats its panel over its board; the Manager button brings one back.
  for (const dir of [acme, globex]) {
    await expect(pane(page, dir).getByTestId('manager-column')).toBeHidden();
    await expect(pane(page, dir).getByTestId('side-panel')).toHaveAttribute('data-pinned', 'false');
  }
  await pane(page, acme).getByTestId('manager-toggle').click();
  await expect(pane(page, acme).getByTestId('manager-column')).toBeVisible();
  await expect(pane(page, globex).getByTestId('manager-column')).toBeHidden();

  const divider = await boxOf(page.getByTestId('pane-divider'));
  const [x, y] = [divider.x + divider.width / 2, divider.y + divider.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 8 });
  await page.mouse.up();
  const dragged = (await boxOf(pane(page, globex))).width;
  expect(Math.abs(dragged - (before.globex.width + 100))).toBeLessThanOrEqual(2);
  await app.close();

  // A restart opens both again, on screen as they were, with the divider where it was left.
  const again = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, openProjects(dataDir));
  await expect(pane(again.page, acme)).toHaveAttribute('data-shown', 'true');
  await expect(pane(again.page, globex)).toHaveAttribute('data-shown', 'true');
  expect(Math.abs((await boxOf(pane(again.page, globex))).width - dragged)).toBeLessThanOrEqual(2);
  await again.app.close();
});

test('a project off screen shows how many of its sessions need you, and Ctrl+Tab brings it on screen', async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({}, [acme, globex]);
  const id = await startIn(page, globex, 'Question');
  await sendLine(page, id, report('blocked:kind=question'));

  await expect(row(page, globex).getByTestId('rail-count')).toHaveText('1');
  await expect(row(page, acme).getByTestId('rail-count')).toHaveCount(0);
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'false');

  await page.keyboard.press('Control+Tab');
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  await expect(row(page, globex)).toHaveAttribute('data-focused', 'true');
  await expect(pane(page, globex).getByTestId('panel-title')).toHaveText('Question');
  await expect(pane(page, globex).locator(`[data-testid=task-card][data-task-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
  await app.close();
});

/** The project of the element with the focus, and whether that is a task's terminal. */
const cursor = (page: Page) =>
  page.evaluate(() => ({
    project: document.activeElement?.closest('[data-testid=project-pane]')?.getAttribute('data-project') ?? null,
    inTask: document.activeElement?.closest('.well') != null,
  }));

test('a click in the list focuses a project and leaves the others on screen; Cmd+1 to Cmd+9 focus by place', async () => {
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page } = await launchApp({}, [a, b, c]);
  await (await rowButton(page, b, 'rail-beside')).click();
  await expect(row(page, b)).toHaveAttribute('data-focused', 'true');
  await expect(pane(page, b)).toHaveAttribute('data-focused', 'true');
  await expect(pane(page, a)).toHaveAttribute('data-focused', 'false');

  // One on screen is focused where it is, and the other stays.
  await row(page, a).getByTestId('rail-show').click();
  await expect(pane(page, a)).toHaveAttribute('data-focused', 'true');
  await expect(row(page, b)).toHaveAttribute('data-focused', 'false');
  await expect(pane(page, b)).toHaveAttribute('data-shown', 'true');

  // One off screen takes the focused one's place.
  await row(page, c).getByTestId('rail-show').click();
  await expect(pane(page, c)).toHaveAttribute('data-focused', 'true');
  await expect(pane(page, a)).toHaveAttribute('data-shown', 'false');
  expect((await boxOf(pane(page, c))).x).toBeLessThan((await boxOf(pane(page, b))).x);

  // A click in a pane focuses its project.
  const id = await startIn(page, b, 'Selected');
  await pane(page, b).locator(`[data-testid=task-card][data-task-id="${id}"]`).click();
  await expect(pane(page, b)).toHaveAttribute('data-focused', 'true');

  // Cmd+1 brings the list's first in place of b. Nothing selected there and no manager beside others:
  // the cursor leaves b, so no typing lands there unseen.
  await page.keyboard.press('Meta+1');
  await expect(pane(page, a)).toHaveAttribute('data-focused', 'true');
  await expect(pane(page, b)).toHaveAttribute('data-shown', 'false');
  expect((await boxOf(pane(page, c))).x).toBeLessThan((await boxOf(pane(page, a))).x);
  await expect.poll(() => cursor(page)).toEqual({ project: null, inTask: false });

  // Cmd+2 brings b back, with the cursor in its selected task's terminal.
  await page.keyboard.press('Meta+2');
  await expect(pane(page, b)).toHaveAttribute('data-focused', 'true');
  await expect.poll(() => cursor(page)).toEqual({ project: b, inTask: true });

  await pane(page, c).getByTestId('board').click();
  await expect(row(page, c)).toHaveAttribute('data-focused', 'true');
  await app.close();
});

test("each project's panel keeps its own pin", async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({}, [acme, globex]);
  await setWindowWidth(app, page, 1600);
  const pinned = (dir: string) => pane(page, dir).getByTestId('side-panel');

  await pane(page, acme).getByTestId('panel-pin').click();
  await expect(pinned(acme)).toHaveAttribute('data-pinned', 'false');
  await row(page, globex).getByTestId('rail-show').click();
  await expect(pinned(globex)).toHaveAttribute('data-pinned', 'true');
  await row(page, acme).getByTestId('rail-show').click();
  await expect(pinned(acme)).toHaveAttribute('data-pinned', 'false');
  await app.close();
});

test('closing a project stops its sessions, and opening it again carries them on', async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page, dataDir } = await launchApp({}, [acme, globex]);
  const id = await startIn(page, globex, 'Keep going');
  expect(launches(dataDir)).toHaveLength(1);

  await (await rowButton(page, globex, 'rail-close')).click();
  await row(page, globex).getByTestId('rail-close-confirm').click();
  await expect(page.getByTestId('rail-project')).toHaveCount(1);
  await expect(pane(page, globex)).toHaveCount(0);
  expect(openProjects(dataDir)).toEqual([acme]);
  // Still open in state.json, so it carries on when the project opens again.
  const task = () => JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).tasks.find((t: { id: string }) => t.id === id);
  expect(task().open).toBe(true);

  // Main looks the dialog up at each call.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, globex);
  await page.getByTestId('open-project').click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  await expect.poll(() => launches(dataDir)).toHaveLength(2);
  expect(launches(dataDir)[1].args).toContain('--resume');
  await expect.poll(() => screen(page, id)).toContain('$');
  await app.close();
});

test('the grid puts three projects on screen in two rows', async () => {
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page } = await launchApp({}, [a, b, c]);
  await (await rowButton(page, b, 'rail-beside')).click();
  await (await rowButton(page, c, 'rail-beside')).click();
  await page.getByTestId('arrange-grid').click();

  await expect(page.getByTestId('panes')).toHaveAttribute('data-arrangement', 'grid');
  await expect(page.getByTestId('pane-divider')).toHaveCount(0);
  const [boxA, boxB, boxC] = [await boxOf(pane(page, a)), await boxOf(pane(page, b)), await boxOf(pane(page, c))];
  expect(boxA.y).toBe(boxB.y);
  expect(boxA.x + boxA.width).toBeLessThanOrEqual(boxB.x);
  expect(boxC.y).toBeGreaterThanOrEqual(boxA.y + boxA.height);
  await app.close();
});
