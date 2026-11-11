import { test, expect, type Locator } from '@playwright/test';
import { cleanUp, launchApp } from './launch';
import {
  appRegion, box, boxOf, closePaneKey, dragBy, expectInOneRow, expectStripAt, isOnTop, projectPane as pane, railRow as row, report,
  repo, ROW_HEIGHT, rowButton, sendLine, startIn,
} from './tasks';

test.afterEach(cleanUp);

test("the row holds Projects, then the project's Todo, Manager, name and New task, and Next that needs you at its right end; every panel starts under it", async () => {
  const { app, page } = await launchApp();
  const inRow = [
    page.getByTestId('projects-toggle'),
    page.getByTestId('todo-toggle'),
    page.getByTestId('manager-toggle'),
    page.locator('.tb-project'),
    page.getByTestId('new-task'),
    page.getByTestId('jump-next'),
  ];
  const boxes = await Promise.all(inRow.map(boxOf));
  // Left to right, apart, on one centre line, and nothing over any of them.
  expectInOneRow(boxes);
  for (const el of inRow) expect(await isOnTop(el)).toBe(true);
  const next = boxes.at(-1)!;
  expect(next.x + next.width).toBeGreaterThanOrEqual((await page.evaluate(() => window.innerWidth)) - 20);

  for (const testId of ['project-rail', 'manager-column', 'side-panel']) expect((await box(page, testId)).y).toBe(ROW_HEIGHT);
  await app.close();
});

// Review Focus 3.
test("the first project's part starts right after Projects with the list open, folded or off, the next part lines up with its pane and follows the divider, and Cmd+W hands the first place on", async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({}, [acme, globex]);
  await (await rowButton(page, globex, 'rail-beside')).click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  const projects = page.getByTestId('projects-toggle');
  const rail = page.getByTestId('project-rail');

  // Projects to the first part's Todo is the gap from that Todo to its Manager: the three read as one group.
  const expectOneGroup = async (dir: string) => {
    const p = await boxOf(projects);
    const t = await boxOf(pane(page, dir).getByTestId('todo-toggle'));
    const m = await boxOf(pane(page, dir).getByTestId('manager-toggle'));
    expect(Math.abs(t.x - (p.x + p.width) - (m.x - (t.x + t.width)))).toBeLessThanOrEqual(1);
  };
  await expectOneGroup(acme);
  await projects.click();
  await expect(rail).toBeHidden();
  await expectOneGroup(acme);
  await projects.click();
  await expect(rail).toBeVisible();
  await page.getByTestId('rail-fold').click();
  await expect(page.getByTestId('rail-strip')).toBeVisible();
  await expectOneGroup(acme);
  await page.getByTestId('rail-strip').click();
  await expect(rail).toBeVisible();

  // The next part starts at its own pane's left edge, and moves with the divider.
  const expectOverItsPane = async (dir: string) =>
    expect(Math.abs((await boxOf(pane(page, dir).getByTestId('project-bar'))).x - (await boxOf(pane(page, dir))).x)).toBeLessThanOrEqual(1);
  await expectOverItsPane(globex);
  const before = await boxOf(pane(page, globex));
  await dragBy(page, 'pane-divider', 100);
  expect(Math.abs((await boxOf(pane(page, globex))).x - (before.x + 100))).toBeLessThanOrEqual(2);
  await expectOverItsPane(globex);

  // Next that needs you is the window's, once, at the end of its top row: in the last part.
  await expect(page.getByTestId('jump-next')).toHaveCount(1);
  await expect(pane(page, globex).getByTestId('jump-next')).toHaveCount(1);

  // Acme taken off screen, globex is first: its part takes the place after Projects, and acme's gives it up.
  await row(page, acme).getByTestId('rail-show').click();
  await page.keyboard.press(closePaneKey);
  await expect(pane(page, acme)).toHaveAttribute('data-shown', 'false');
  await expect(pane(page, acme)).toHaveAttribute('data-first', 'false');
  await expect(pane(page, globex)).toHaveAttribute('data-first', 'true');
  await expectOneGroup(globex);
  await expect(page.getByTestId('jump-next')).toHaveCount(1);
  await expect(pane(page, globex).getByTestId('jump-next')).toHaveCount(1);
  await app.close();
});

/**
 * Where `locator` ends along its centre line as it shows: its box's right edge, or short of it where something it is in
 * clips it. Hit testing honours clipping, and finds it under whatever is laid over it.
 */
const shownRight = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    let x = Math.ceil(r.right) - 1;
    while (x > r.left && !document.elementsFromPoint(x, y).some((hit) => el.contains(hit))) x -= 1;
    return x + 1;
  });

test("a part too narrow for its buttons keeps them in its own pane: none shows past its right edge, and the next pane's buttons are on top", async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({}, [acme, globex]);
  await (await rowButton(page, globex, 'rail-beside')).click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  // With the list off, the first part starts furthest into its pane; dragged to its narrowest, the pane has least room.
  await page.getByTestId('projects-toggle').click();
  await expect(page.getByTestId('project-rail')).toBeHidden();
  await dragBy(page, 'pane-divider', 300 - (await boxOf(pane(page, acme))).width);
  await expect.poll(async () => Math.round((await boxOf(pane(page, acme))).width)).toBe(360);

  // On the Mac, after the window buttons, its part has less room than its buttons need, even with their words dropped
  // and its name cut to its square.
  const first = await boxOf(pane(page, acme));
  const inFirst = ['todo-toggle', 'manager-toggle', 'new-task'].map((testId) => pane(page, acme).getByTestId(testId));
  for (const el of [...inFirst, pane(page, acme).locator('.tb-project')]) {
    expect(await shownRight(el)).toBeLessThanOrEqual(first.x + first.width + 1);
  }
  for (const testId of ['todo-toggle', 'manager-toggle']) {
    expect(await isOnTop(pane(page, globex).getByTestId(testId))).toBe(true);
  }
  await app.close();
});

test('in the grid, a project in a lower row has its part at its own pane\'s top, and its buttons act on it', async () => {
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page } = await launchApp({}, [a, b, c]);
  await (await rowButton(page, b, 'rail-beside')).click();
  await (await rowButton(page, c, 'rail-beside')).click();
  await page.getByTestId('arrange-grid').click();
  await expect(page.getByTestId('panes')).toHaveAttribute('data-arrangement', 'grid');

  const lower = await boxOf(pane(page, c));
  expect(lower.y).toBeGreaterThan(ROW_HEIGHT);
  expect(Math.abs((await boxOf(pane(page, c).getByTestId('project-bar'))).y - lower.y)).toBeLessThanOrEqual(1);
  await pane(page, c).getByTestId('todo-toggle').click();
  await expect(pane(page, c).getByTestId('todo-panel')).toBeVisible();
  for (const dir of [a, b]) await expect(pane(page, dir).getByTestId('todo-panel')).toBeHidden();

  // Next that needs you ends the window's top row: the grid's top row, not the last pane.
  await expect(page.getByTestId('jump-next')).toHaveCount(1);
  await expect(pane(page, b).getByTestId('jump-next')).toHaveCount(1);
  await app.close();
});

// Review Focus 2.
test("each project's row buttons, folds and strips act on that project only, and a project taken off screen and back keeps its panels as they were", async () => {
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page } = await launchApp({}, [a, b, c]);
  await (await rowButton(page, b, 'rail-beside')).click();
  await expect(pane(page, b)).toHaveAttribute('data-shown', 'true');
  const [inA, inB] = [pane(page, a), pane(page, b)];

  await inA.getByTestId('manager-toggle').click();
  await expect(inA.getByTestId('manager-column')).toBeVisible();
  await expect(inB.getByTestId('manager-column')).toBeHidden();

  await inA.getByTestId('todo-toggle').click();
  await inA.getByTestId('todo-fold').click();
  await expect(inA.getByTestId('todo-strip')).toBeVisible();
  await expect(inB.getByTestId('todo-strip')).toHaveCount(0);

  // C takes a's place, and a comes back to it.
  await row(page, a).getByTestId('rail-show').click();
  await row(page, c).getByTestId('rail-show').click();
  await expect(inA).toHaveAttribute('data-shown', 'false');
  await row(page, a).getByTestId('rail-show').click();
  await expect(inA).toHaveAttribute('data-shown', 'true');
  await expect(inA.getByTestId('todo-strip')).toBeVisible();
  await expect(inA.getByTestId('manager-column')).toBeVisible();
  // B is as it was.
  await expect(inB.getByTestId('manager-column')).toBeHidden();
  await expect(inB.getByTestId('todo-strip')).toHaveCount(0);
  await expect(inB.getByTestId('todo-toggle')).toHaveAttribute('aria-pressed', 'false');
  await app.close();
});

// CDP clicks skip native drag regions, so this pins the styles; the owner checks the window buttons with a real mouse.
test("on the Mac the row is the window's title bar: nothing that takes clicks starts in its first 80 px, and a lower grid row's part doesn't drag", async () => {
  test.skip(process.platform !== 'darwin', "CDP can't press native drag regions, and Windows and Linux have none");
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page } = await launchApp({}, [a, b, c]);

  // What takes clicks over the row's start: a no-drag element after it in the page, as macOS carves them out of it in
  // that order. None starts within its first 80 px, where the window buttons are. Over it by a pixel or more.
  const starts = await page.getByTestId('top-row').evaluate((bar) => {
    const s = bar.getBoundingClientRect();
    return [...document.querySelectorAll('*')]
      .filter((el) => bar.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      .filter((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag')
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.left < s.right && s.left < r.right && r.top <= s.bottom - 1 && s.top <= r.bottom - 1)
      .map((r) => r.left - s.left);
  });
  expect(starts.length).toBeGreaterThan(0);
  expect(Math.min(...starts)).toBeGreaterThanOrEqual(80);
  expect(await appRegion(pane(page, a).getByTestId('project-bar'))).toBe('drag');

  // With the list off, the panes off screen start at x 0 under the window buttons; their bars' children must not
  // carve no-drag holes there, as only the bars of panes on screen are part of the drag region.
  await page.getByTestId('projects-toggle').click();
  await expect(page.getByTestId('projects-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(pane(page, b)).toHaveAttribute('data-shown', 'false');
  const offScreen = await pane(page, b)
    .getByTestId('project-bar')
    .evaluate((bar) =>
      [...bar.children]
        .filter((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag')
        .map((el) => el.getBoundingClientRect().left),
    );
  expect(offScreen.filter((left) => left < 80)).toEqual([]);
  await page.getByTestId('projects-toggle').click();
  await expect(page.getByTestId('projects-toggle')).toHaveAttribute('aria-pressed', 'true');

  // In the grid, the top row's parts are the window's title bar; a lower row's is not.
  await (await rowButton(page, b, 'rail-beside')).click();
  await (await rowButton(page, c, 'rail-beside')).click();
  await page.getByTestId('arrange-grid').click();
  await expect(page.getByTestId('panes')).toHaveAttribute('data-arrangement', 'grid');
  for (const dir of [a, b]) expect(await appRegion(pane(page, dir).getByTestId('project-bar'))).toBe('drag');
  expect(await appRegion(pane(page, c).getByTestId('project-bar'))).not.toBe('drag');
  await app.close();
});

test("Projects turns the list off and on; off, it counts the sessions waiting in projects off screen, and focus in the list goes to it. The list folds into a strip at the window's left that counts them too, and opens again from it; Projects stays lit, and the focus goes from one to the other", async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page } = await launchApp({}, [acme, globex]);
  const id = await startIn(page, globex, 'Question');
  await sendLine(page, id, report('blocked:kind=question'));
  await expect(row(page, globex).getByTestId('rail-count')).toHaveText('1');
  const projects = page.getByTestId('projects-toggle');
  const rail = page.getByTestId('project-rail');
  const fold = page.getByTestId('rail-fold');
  const strip = page.getByTestId('rail-strip');
  // On, the list shows the count itself.
  await expect(projects).toHaveAttribute('aria-pressed', 'true');
  await expect(projects).toHaveAttribute('title', 'Hide the projects list');
  await expect(projects).toHaveText('Projects');

  await row(page, acme).getByTestId('rail-show').focus();
  await projects.click();
  await expect(rail).toBeHidden();
  await expect(projects).toBeFocused();
  await expect(projects).toHaveAttribute('aria-pressed', 'false');
  await expect(projects).toHaveAttribute('title', 'Show the projects list');
  await expect(projects).toContainText('1');
  await expect(projects).toHaveAccessibleName(/1 need you/);
  // The panes take the list's room.
  expect((await boxOf(pane(page, acme))).x).toBeLessThanOrEqual(9);

  await projects.click();
  await expect(rail).toBeVisible();
  await expect(projects).toHaveText('Projects');

  // Folded, while globex is still off screen.
  await fold.click();
  await expect(rail).toBeHidden();
  await expect(strip).toBeFocused();
  const s = await box(page, 'rail-strip');
  expectStripAt(s, 'left', 8);
  expect(s.y).toBe(ROW_HEIGHT);
  await expect(strip).toHaveAccessibleName('Show projects, 1 need you');
  await expect(strip).toContainText('1');
  await expect(projects).toHaveAttribute('aria-pressed', 'true');

  // With globex on screen, no session waits off screen, and the strip has no count.
  await page.keyboard.press('Control+Tab');
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');
  await expect(strip).toHaveAccessibleName('Show projects');
  await expect(strip).not.toContainText('1');

  // Opened from the strip, the focus goes to the fold button: right of the arrange buttons, on their centre line, in a
  // header that still holds its whole title (spec §7).
  await strip.click();
  await expect(rail).toBeVisible();
  await expect(fold).toBeFocused();
  expectInOneRow([await boxOf(page.getByTestId('arrange-grid')), await boxOf(fold)]);
  const title = rail.locator('.rail-header h2');
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const t = await boxOf(title);
  expect(t.x + t.width).toBeLessThan((await boxOf(page.getByTestId('arrange-columns'))).x);

  // Folded, Projects turns it off: no strip and no list, and the strip's focus goes to the button.
  await fold.click();
  await expect(strip).toBeFocused();
  await projects.click();
  await expect(strip).toHaveCount(0);
  await expect(rail).toHaveCount(0);
  await expect(projects).toBeFocused();

  // On again, it opens fully, not as its strip.
  await projects.click();
  await expect(rail).toBeVisible();
  await expect(strip).toHaveCount(0);
  await app.close();
});
