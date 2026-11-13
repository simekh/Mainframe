import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { BOARD_ROOM, STRIP_WIDTH } from '../src/renderer/src/panel/panelPrefs';
import { IPC } from '../src/shared/ipc';
import { cleanUp, launchApp, removeAfterTest, setWindowWidth } from './launch';
import {
  box, card, cardIn, closeTask, edgesWhile, expectSlide, expectStripAt, heldSyncs, holdSyncs, ids, isOnTop, launches, middle,
  openedLinks, projectPane as pane, railRow, releaseSyncs, repoAhead, stoppedSyncs, syncLaunches, syncReply, terminalHasFocus,
  todoDir,
} from './tasks';

test.afterEach(cleanUp);

/** A project folder of its own, removed after the test. */
const folder = () => removeAfterTest(mkdtempSync(join(tmpdir(), 'mainframe-todo-')));

/**
 * Resolves once the floating panel has slid in. It is visible from the slide's start, and measured while it
 * slides its box is off by a float's rounding (303.99998 for 304, Windows CI).
 */
const slidIn = (panel: Locator) =>
  panel.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });

/** What the first sync answers: the connector that holds the list, and its tools that only read. */
const TOOLS = { kind: 'tools', connector: 'Tracker', readTools: ['mcp__tracker__get_list'] };

/** What a sync with those tools answers: the list's cards, in its order. */
const CARDS = {
  kind: 'cards',
  source: { kind: 'Tracker', board: 'Shop', list: 'To do', url: 'https://tracker.example/shop/to-do' },
  cards: [
    {
      id: 'c128',
      number: '#128',
      title: 'Search ignores accents',
      description: 'Searching for "creme" finds nothing.\nIt should find "crème" too.',
      labels: ['UI'],
      checklists: [
        {
          name: 'Done when',
          items: [
            { text: 'Accents fold in search', done: true },
            { text: 'A test covers it', done: false },
          ],
        },
      ],
      url: 'https://tracker.example/c/128',
      forOwner: false,
      urgent: false,
    },
    {
      id: 'c131',
      number: '#131',
      title: 'Export drops the last row',
      description: '',
      labels: [],
      checklists: [],
      url: null,
      forOwner: false,
      urgent: false,
    },
  ],
};

/** A card the sync marked as the owner's, which has no Start in the list. */
const OWNER_CARD = {
  ...CARDS.cards[1],
  id: 'c119',
  number: '#119',
  title: 'Decide on the refund window',
  labels: ['Decision'],
  forOwner: true,
};

/** The project's first sync, as the owner makes it: Sync, allow the tools it asks about, and the cards show. */
async function syncFirstTime(scope: Page | Locator, dataDir: string, answer: { cards: unknown[] } = CARDS): Promise<void> {
  syncReply(dataDir, TOOLS);
  await scope.getByTestId('todo-toggle').click();
  await scope.getByTestId('todo-sync').click();
  await expect(scope.getByTestId('todo-confirm-tools')).toBeVisible();
  syncReply(dataDir, answer);
  await scope.getByTestId('todo-confirm-tools').click();
  await expect(scope.getByTestId('todo-item')).toHaveCount(answer.cards.length);
}

/**
 * Holds main's answers to the renderer's calls on `channel` until `releaseHeld`, and then answers each with `outcome`,
 * as does every later call: a start check, or a start, slow enough for the owner to act in the meantime.
 */
const holdAnswers = (app: ElectronApplication, channel: string, outcome: { value: unknown } | { error: string }) =>
  app.evaluate(
    ({ ipcMain }, { channel, outcome }) => {
      const held: Array<() => void> = [];
      let released = false;
      const answer = () => ('error' in outcome ? Promise.reject(new Error(outcome.error)) : Promise.resolve(outcome.value));
      (globalThis as { releaseHeld?: () => void }).releaseHeld = () => {
        released = true;
        for (const release of held.splice(0)) release();
      };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => (released ? answer() : new Promise((resolve) => held.push(() => resolve(answer())))));
    },
    { channel, outcome },
  );

const releaseHeld = (app: ElectronApplication) => app.evaluate(() => (globalThis as { releaseHeld?: () => void }).releaseHeld!());

/** The row of the item with this key in the Todo panel's list. */
const itemRow = (scope: Page | Locator, key: string) => scope.locator(`[data-testid=todo-item][data-key="${key}"]`);

/** The project's tasks as main keeps them: the title and description each started with. */
const taskBriefs = (page: Page) =>
  page.evaluate(async () => {
    const [{ dir }] = await window.mainframe.listProjects();
    return (await window.mainframe.listTasks(dir)).map(({ title, description }) => ({ title, description }));
  });

test('Sync finds the connector and asks to allow its read tools; allowed, it shows the list, and the list is kept across a restart', async () => {
  const project = folder();
  const first = await launchApp({}, project);
  const { page, dataDir } = first;
  const panel = page.getByTestId('todo-panel');
  syncReply(dataDir, TOOLS);
  await page.getByTestId('todo-toggle').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Not synced yet')).toBeVisible();
  await expect(panel.getByText('Sync reads your to-do list through the connector you use for it.', { exact: false })).toBeVisible();
  await page.getByTestId('todo-sync').click();

  // The first run reads nothing: it names the connector and the tools that would read the list.
  const allow = panel.getByTestId('todo-confirm-tools');
  await expect(allow).toHaveText('Allow and sync');
  await expect(
    panel.getByText('Sync wants to read your to-do list in Tracker with these tools. Allow them only if none of them can change it:'),
  ).toBeVisible();
  await expect(panel.locator('code')).toHaveText(['mcp__tracker__get_list']);
  await expect(panel.getByTestId('todo-reset')).toHaveCount(0);
  const [discover] = syncLaunches(dataDir);
  expect(realpathSync(discover.cwd)).toBe(realpathSync(project));
  expect(discover.args[0]).toBe('-p');
  expect(discover.args[discover.args.indexOf('--tools') + 1]).toBe('');
  expect(discover.stdin).toContain("don't call any tool");
  const settings = () => JSON.parse(readFileSync(join(todoDir(dataDir), 'sync-settings.json'), 'utf8'));
  expect(settings().permissions).toBeUndefined();
  // In the background: no task, no terminal.
  expect(launches(dataDir)).toEqual([]);

  syncReply(dataDir, CARDS);
  await allow.click();
  const items = panel.getByTestId('todo-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveAttribute('data-key', 'card:c128');
  await expect(items.first()).toHaveAttribute('data-for-owner', 'false');
  await expect(items.first()).toContainText('#128');
  await expect(items.first()).toContainText('Search ignores accents');
  await expect(items.first()).toContainText('UI');
  await expect(items.nth(1)).toContainText('Export drops the last row');
  await expect(panel.getByTestId('todo-source')).toHaveText('Tracker ↗ · Shop · To do');
  // The service's name opens the list where it lives, in the browser.
  const sourceLink = panel.getByTestId('todo-source-link');
  await expect(sourceLink).toHaveText('Tracker ↗');
  await expect(sourceLink).toHaveAttribute('title', 'Open in Tracker');
  await sourceLink.click();
  await expect.poll(() => openedLinks(first.app)).toEqual(['https://tracker.example/shop/to-do']);
  await expect(panel.getByText('Synced just now')).toBeVisible();
  await expect(allow).toHaveCount(0);
  await expect(panel.getByTestId('todo-reset')).toHaveText('Set up again');
  expect(syncLaunches(dataDir)).toHaveLength(2);
  expect(settings().permissions).toEqual({ allow: ['mcp__tracker__get_list'] });
  await first.app.close();

  // Kept, and shown without a sync: an unpinned panel waits for the button.
  const again = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, project);
  await expect(again.page.getByTestId('todo-panel')).toBeHidden();
  await again.page.getByTestId('todo-toggle').click();
  await expect(again.page.getByTestId('todo-item')).toHaveCount(2);
  await expect(again.page.getByTestId('todo-item').first()).toContainText('#128');
  expect(syncLaunches(dataDir)).toHaveLength(2);
  await again.app.close();
});

test('a sync that fails says why and keeps the list', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);

  syncReply(dataDir, { kind: 'none', message: 'The tracker could not be reached.' });
  await page.getByTestId('todo-sync').click();
  await expect(page.getByTestId('todo-error')).toHaveText('The tracker could not be reached.');
  await expect(page.getByTestId('todo-item')).toHaveCount(2);
  await expect(page.getByTestId('todo-sync')).toHaveText('Sync');

  // Set up again forgets the allowed tools, so the next sync asks again; the list stays meanwhile.
  await page.getByTestId('todo-reset').click();
  await expect(page.getByTestId('todo-reset')).toHaveCount(0);
  await expect(page.getByTestId('todo-error')).toHaveCount(0);
  await expect(page.getByTestId('todo-item')).toHaveCount(2);
  await app.close();
});

test('Stop ends a running sync quietly: the list stays, a reply from the stopped run changes nothing, and Sync starts a fresh run', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);
  const panel = page.getByTestId('todo-panel');
  const items = page.getByTestId('todo-item');
  const [search, exported] = CARDS.cards;

  // The second sync waits without replying. What the reply file holds is what that run prints as it is stopped.
  holdSyncs(dataDir);
  syncReply(dataDir, { ...CARDS, cards: [{ ...search, id: 'c999', number: '#999', title: 'From the stopped run' }] });
  await page.getByTestId('todo-sync').click();
  const stop = page.getByTestId('todo-stop-sync');
  await expect(stop).toHaveText('Stop');
  await expect(stop).toHaveAttribute('aria-label', 'Stop the sync');
  await expect(page.getByTestId('todo-sync')).toHaveCount(0);
  await expect(panel.getByText('Syncing…')).toBeVisible();
  await expect.poll(() => heldSyncs(dataDir)).toBe(1);

  await stop.click();

  // Quiet: Sync is back, no error shows, and the list and its synced time are as they were.
  await expect(page.getByTestId('todo-sync')).toHaveText('Sync');
  await expect(page.getByTestId('todo-stop-sync')).toHaveCount(0);
  await expect(page.getByTestId('todo-error')).toHaveCount(0);
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Search ignores accents');
  await expect(panel.getByText('Synced just now')).toBeVisible();

  // The run got SIGTERM, and printed its reply as it went: the list is still as it was.
  await expect.poll(() => stoppedSyncs(dataDir)).toBe(1);
  await expect(panel.getByText('From the stopped run')).toHaveCount(0);
  await expect(page.getByTestId('todo-error')).toHaveCount(0);

  // Sync after a Stop starts a fresh run.
  releaseSyncs(dataDir);
  syncReply(dataDir, { ...CARDS, cards: [{ ...search, title: 'Search ignores accents and case' }, exported] });
  await page.getByTestId('todo-sync').click();
  await expect(items.first()).toContainText('Search ignores accents and case');
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId('todo-sync')).toHaveText('Sync');
  expect(syncLaunches(dataDir)).toHaveLength(4);
  await app.close();
});

test("a sync past two minutes says so, and the line's Stop ends the run", async () => {
  const dir = folder();
  const { app, page, dataDir } = await launchApp({}, dir);
  await syncFirstTime(page, dataDir);
  holdSyncs(dataDir);
  await page.getByTestId('todo-sync').click();
  await expect.poll(() => heldSyncs(dataDir)).toBe(1);

  // Main's own timer waits the real two minutes: main sends the view it would send then.
  const view = await page.evaluate((dir) => window.mainframe.getTodo(dir), dir);
  expect(view.syncing).toBe(true);
  await app.evaluate(
    ({ BrowserWindow }, { channel, dir, view }) => BrowserWindow.getAllWindows()[0].webContents.send(channel, { dir, view }),
    { channel: IPC.todoChanged, dir, view: { ...view, longSync: true } },
  );
  const line = page.getByTestId('todo-long-sync');
  await expect(line.locator('p')).toHaveText('Still syncing (2 min). Large syncs can use a lot of tokens.', { useInnerText: true });
  await expect(line.getByTestId('todo-keep-going')).toBeVisible();

  await line.getByTestId('todo-long-stop').click();
  await expect.poll(() => stoppedSyncs(dataDir)).toBe(1);
  await expect(page.getByTestId('todo-sync')).toHaveText('Sync');
  await expect(line).toHaveCount(0);
  releaseSyncs(dataDir);
  await app.close();
});

test('a sync that changes a card updates its row in place, and the other rows stay as they were', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);
  // Marks the rows the first sync built: a row built anew would drop the focus of a button in it.
  const items = page.getByTestId('todo-item');
  await items.evaluateAll((rows) => rows.forEach((row) => row.setAttribute('data-first-sync', '')));

  const [search, exported] = CARDS.cards;
  syncReply(dataDir, { ...CARDS, cards: [{ ...search, title: 'Search ignores accents and case' }, exported] });
  await page.getByTestId('todo-sync').click();
  await expect(items.first()).toContainText('Search ignores accents and case');
  await expect(page.locator('[data-testid=todo-item][data-first-sync]')).toHaveCount(2);
  await app.close();
});

test('two projects side by side keep their own lists', async () => {
  const [acme, globex] = [folder(), folder()];
  const { app, page, dataDir } = await launchApp({}, [acme, globex]);
  const row = railRow(page, globex);
  await row.hover();
  await row.getByTestId('rail-beside').click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');

  await syncFirstTime(pane(page, acme), dataDir);
  await pane(page, globex).getByTestId('todo-toggle').click();
  const other = pane(page, globex).getByTestId('todo-panel');
  await expect(other).toBeVisible();
  await expect(other.getByText('Not synced yet')).toBeVisible();
  await expect(other.getByTestId('todo-item')).toHaveCount(0);
  await expect(pane(page, acme).getByTestId('todo-item')).toHaveCount(2);
  await expect(pane(page, acme).getByTestId('todo-source')).toHaveText('Tracker ↗ · Shop · To do');

  // Each pane has its own ticket, and Esc closes the one in the project the owner works in.
  await itemRow(pane(page, acme), 'card:c128').click();
  await pane(page, globex).getByTestId('todo-add-note').click();
  const [acmeTicket, globexTicket] = [acme, globex].map((dir) => pane(page, dir).getByTestId('ticket-panel'));
  await expect(acmeTicket.getByRole('heading', { level: 3 })).toHaveText('#128 Search ignores accents');
  await expect(globexTicket.getByLabel('Title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(globexTicket).toHaveCount(0);
  await expect(acmeTicket).toBeVisible();
  // The focus was in the ticket that went: it goes back to what opened it.
  await expect(pane(page, globex).getByTestId('todo-add-note')).toBeFocused();
  await app.close();
});

test("pinned, the Todo panel takes the pane's left edge and the manager sits right of it, and folds into a strip in its place; unpinned, it floats over the manager beside its strip, and a press on the board folds it", async () => {
  const project = folder();
  const first = await launchApp({}, project);
  const { page, dataDir } = first;
  const panel = page.getByTestId('todo-panel');
  const toggle = page.getByTestId('todo-toggle');
  const pin = page.getByTestId('todo-pin');
  const fold = page.getByTestId('todo-fold');
  const strip = page.getByTestId('todo-strip');
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // Floating, it takes no room: in the window as it opens, beside the pinned manager, it has its own width and can
  // grow to its maximum.
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('manager-column')).toHaveAttribute('data-pinned', 'true');
  await slidIn(panel);
  expect((await box(page, 'todo-panel')).width).toBe(320);
  await expect(page.getByTestId('todo-resize')).toHaveAttribute('aria-valuemax', '480');

  // Room for the Todo panel and the manager beside the board and the session panel at their own widths.
  await setWindowWidth(first.app, page, 1700);
  await pin.click();
  await expect(panel).toHaveAttribute('data-pinned', 'true');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  const paneBox = await box(page, 'project-pane');
  const pinned = await box(page, 'todo-panel');
  expect(Math.abs(pinned.x - (paneBox.x + 8))).toBeLessThanOrEqual(1);
  expect(pinned.width).toBe(320);
  const manager = await box(page, 'manager-column');
  expect(pinned.x + pinned.width).toBeLessThanOrEqual(manager.x);
  expect(manager.width).toBe(400);
  expect((await box(page, 'board')).x).toBeGreaterThanOrEqual(manager.x + manager.width);
  await expect(page.getByTestId('side-panel')).toHaveAttribute('data-pinned', 'true');

  // Folded, the manager's strip sits right of the Todo panel.
  await page.getByTestId('manager-fold').click();
  await expect(page.getByTestId('manager-column')).toBeHidden();
  expect((await box(page, 'manager-strip')).x).toBeGreaterThanOrEqual(pinned.x + pinned.width);
  await page.getByTestId('manager-strip').click();
  await expect(page.getByTestId('manager-column')).toBeVisible();
  // It slides back in: measured below once it is in.
  await slidIn(page.getByTestId('manager-column'));

  // Folded, it slides away from where it stands, never stepping right first to where a floating one sits, and ends past
  // the pane's edge; its strip takes its place and the focus, and Todo stays lit.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const folding = await edgesWhile(page, 'todo-panel', 'left', () => fold.click());
  expectSlide(folding, 'left', { from: pinned.x });
  expect(folding.at(-1)! + pinned.width).toBeLessThanOrEqual(paneBox.x);
  await expect(panel).toBeHidden();
  await expect(strip).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expectStripAt(await box(page, 'todo-strip'), 'left', paneBox.x + 8);
  // From the strip it slides back in and lands where it stood, without a step at either end.
  const opening = await edgesWhile(page, 'todo-panel', 'left', () => strip.click());
  expectSlide(opening, 'right', { to: pinned.x });
  await expect(fold).toBeFocused();
  await expect(strip).toHaveCount(0);

  // The arrow keys move its edge: left narrows.
  const edge = page.getByTestId('todo-resize');
  await edge.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(edge).toHaveAttribute('aria-valuenow', '304');

  // Unpinned, it floats over the manager column, above it.
  await pin.click();
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(panel).toHaveAttribute('data-open', 'true');
  const floating = await box(page, 'todo-panel');
  const under = await box(page, 'manager-column');
  expect(floating.x).toBeLessThan(under.x + under.width);
  expect(under.x).toBeLessThan(floating.x + floating.width);
  // From that column's top, under the top row, its tab on the manager's title line.
  expect(Math.abs(floating.y - under.y)).toBeLessThanOrEqual(1);
  expect(await isOnTop(panel)).toBe(true);

  // Its fold button folds it into its strip, which takes the focus, and Todo stays lit; the strip opens it again.
  await fold.click();
  await expect(panel).toBeHidden();
  await expect(strip).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await strip.click();
  await expect(panel).toBeVisible();
  await expect(fold).toBeFocused();

  // Out, the strip folds it as the fold button does, and keeps the focus; folded, it opens it, with the focus on the
  // fold button. Its name says which it does.
  await strip.click();
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(strip).toBeFocused();
  await expect(strip).toHaveAccessibleName('Show Todo');
  await strip.click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(fold).toBeFocused();
  await expect(strip).toHaveAccessibleName('Fold the Todo panel');

  // A press on the board right of the islands folds it into its strip, and it stays on; the pinned manager stays.
  const board = await box(page, 'board');
  await page.getByTestId('board').click({ position: { x: under.x + under.width - board.x + 40, y: board.height - 40 } });
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('manager-column')).toBeVisible();
  await first.app.close();

  // The pin and the width are the project's, kept for the next start. Unpinned, it starts off, with no strip.
  const again = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, project);
  await setWindowWidth(again.app, again.page, 1700);
  const panelAgain = again.page.getByTestId('todo-panel');
  await expect(panelAgain).toHaveAttribute('data-pinned', 'false');
  await expect(panelAgain).toBeHidden();
  await expect(again.page.getByTestId('todo-strip')).toHaveCount(0);
  await expect(again.page.getByTestId('todo-toggle')).toHaveAttribute('aria-pressed', 'false');
  await again.page.getByTestId('todo-toggle').click();
  await expect(panelAgain).toBeVisible();
  await slidIn(panelAgain);
  expect((await box(again.page, 'todo-panel')).width).toBe(304);
  await again.page.getByTestId('todo-pin').click();
  await expect(panelAgain).toHaveAttribute('data-pinned', 'true');
  await again.app.close();

  // Pinned, it is out from the start.
  const third = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, project);
  const panelThird = third.page.getByTestId('todo-panel');
  await expect(panelThird).toBeVisible();
  await expect(panelThird).toHaveAttribute('data-pinned', 'true');
  await expect(panelThird).toHaveAttribute('data-open', 'true');
  await expect(third.page.getByTestId('todo-toggle')).toHaveAttribute('aria-pressed', 'true');
  await third.app.close();
});

test('the Todo button turns the panel off, from open or folded, leaving no strip, and on again opens it fully; the focus in it goes to the button, and its ticket closes', async () => {
  const { app, page } = await launchApp({}, folder());
  // Off goes at once, without the slide that folding has.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const panel = page.getByTestId('todo-panel');
  const toggle = page.getByTestId('todo-toggle');
  const strip = page.getByTestId('todo-strip');
  const ticket = page.getByTestId('ticket-panel');

  // On, it opens floating over the pinned manager, so its strip shows beside it.
  await toggle.click();
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(strip).toBeVisible();

  // Off from folded leaves no strip, and the focus on the strip goes to the button, not nowhere.
  await page.getByTestId('todo-fold').click();
  await expect(strip).toBeFocused();
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(strip).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeFocused();

  // On, it opens fully, though it was folded when it went off.
  await toggle.click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(panel).toBeVisible();

  // Off with the cursor in its ticket: the focus goes to the button, and the ticket goes with the panel, at once.
  await page.getByTestId('todo-add-note').click();
  await expect(ticket.getByLabel('Title')).toBeFocused();
  await toggle.click();
  expect(await panel.evaluate((el) => el.getAnimations().length)).toBe(0);
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(ticket).toHaveCount(0);

  // On again, it holds no ticket.
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(ticket).toHaveCount(0);
  await app.close();
});

test("a strip whose panel is off leaves no gap, and the pinned session panel's widest counts the strips", async () => {
  const { app, page } = await launchApp({}, folder());
  await setWindowWidth(app, page, 1600);
  const edge = page.getByTestId('panel-resize');
  await page.getByTestId('manager-fold').click();
  await page.getByTestId('todo-toggle').click();
  await expect(page.getByTestId('todo-panel')).toHaveAttribute('data-pinned', 'false');
  await expect(page.getByTestId('side-panel')).toHaveAttribute('data-pinned', 'true');

  // The floating Todo panel's strip at the pane's edge, then the folded manager's: both take room from the board.
  const pane = await box(page, 'project-pane');
  const todoStrip = await box(page, 'todo-strip');
  expectStripAt(todoStrip, 'left', pane.x + 8);
  expect((await box(page, 'manager-strip')).x).toBeGreaterThanOrEqual(todoStrip.x + todoStrip.width);
  await expect(edge).toHaveAttribute('aria-valuemax', String(Math.round(pane.width) - 2 * STRIP_WIDTH - BOARD_ROOM.pinned));
  // Out right of the strips, the floating panel starts under the top row as they do: none of it shows above.
  expect((await box(page, 'todo-panel')).y).toBe((await box(page, 'manager-strip')).y);

  // Off, the Todo panel's strip goes, and the manager's moves into its place.
  await page.getByTestId('todo-toggle').click();
  await expect(page.getByTestId('todo-strip')).toHaveCount(0);
  expectStripAt(await box(page, 'manager-strip'), 'left', pane.x + 8);
  await expect(edge).toHaveAttribute('aria-valuemax', String(Math.round(pane.width) - STRIP_WIDTH - BOARD_ROOM.pinned));
  await app.close();
});

test('floating together, the Todo panel and the manager sit right of both strips, the one used last on top; the strip of the one under brings it up, and a press in it does too', async () => {
  const { app, page } = await launchApp({}, folder());
  await setWindowWidth(app, page, 1600);
  const todo = page.getByTestId('todo-panel');
  const manager = page.getByTestId('manager-column');
  const todoStrip = page.getByTestId('todo-strip');
  const managerStrip = page.getByTestId('manager-strip');
  await page.getByTestId('manager-pin').click();
  await expect(manager).toHaveAttribute('data-pinned', 'false');
  await page.getByTestId('todo-toggle').click();
  await expect(todo).toHaveAttribute('data-pinned', 'false');
  await slidIn(todo);
  await slidIn(manager);

  // Both strips stay in reach, and both panels float right of them, one over the other.
  expect(await isOnTop(todoStrip)).toBe(true);
  expect(await isOnTop(managerStrip)).toBe(true);
  const [t, m, s] = [await box(page, 'todo-panel'), await box(page, 'manager-column'), await box(page, 'manager-strip')];
  expect(t.x).toBeGreaterThanOrEqual(s.x + s.width);
  expect(Math.abs(t.x - m.x)).toBeLessThanOrEqual(1);
  // The Todo panel, opened last, is on top; the manager's strip says it shows the manager, not that it folds it.
  expect(await isOnTop(todo)).toBe(true);
  await expect(managerStrip).toHaveAccessibleName(/^Show manager/);

  // Its strip brings the manager up, still open, and the Todo panel stays open under it.
  await managerStrip.click();
  await expect(manager).toHaveAttribute('data-open', 'true');
  await expect(todo).toHaveAttribute('data-open', 'true');
  expect(await isOnTop(manager)).toBe(true);
  await expect(page.getByTestId('manager-fold')).toBeFocused();
  await expect(managerStrip).toHaveAccessibleName('Fold the manager');
  await expect(todoStrip).toHaveAccessibleName('Show Todo');

  // And the Todo panel's strip brings it back up.
  await todoStrip.click();
  await expect(manager).toHaveAttribute('data-open', 'true');
  expect(await isOnTop(todo)).toBe(true);

  // A press on the part of the manager the Todo panel leaves uncovered brings the manager up too.
  await page.mouse.click(t.x + t.width + 20, middle(m));
  expect(await isOnTop(manager)).toBe(true);
  await expect(todo).toHaveAttribute('data-open', 'true');
  await app.close();
});

test('Start on a card starts its task at once: under Working, selected; its prompt names the card and asks the session to read it first; the card leaves the list, and comes back with Reopen once the task closes', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);
  const items = page.getByTestId('todo-item');
  const search = itemRow(page, 'card:c128');
  const start = search.getByTestId('todo-start');
  const ticket = page.getByTestId('ticket-panel');
  await expect(start).toHaveAccessibleName('Start Search ignores accents');
  // A note being written stays open through another item's Start, here pressed from the keyboard.
  await page.getByTestId('todo-add-note').click();
  await ticket.getByLabel('Title').fill('Half a thought');
  await start.focus();
  await page.keyboard.press('Enter');

  // On the content: fake-claude creates its file before it writes the arguments.
  await expect.poll(() => launches(dataDir)[0]?.args.at(-1)).toContain('read the live card with your Tracker connector');
  const prompt = launches(dataDir)[0].args.at(-1)!;
  expect(prompt).toContain('Task: #128 Search ignores accents');
  expect(prompt).toContain('https://tracker.example/c/128');
  const [id] = await ids(page);
  await expect(cardIn(page, 'working', id)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('panel-title')).toHaveText('Search ignores accents');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute('data-key', 'card:c131');
  // Typing goes to the started task's terminal, as after New task; the note keeps its text.
  await expect.poll(() => terminalHasFocus(page)).toBe(true);
  await expect(ticket.getByLabel('Title')).toHaveValue('Half a thought');
  await ticket.getByTestId('ticket-close').click();

  // Closed, it comes back with Reopen and no Start; its ticket offers Reopen too, which continues the task.
  await closeTask(page, id);
  await expect(items).toHaveCount(2);
  await expect(search.getByTestId('todo-start')).toHaveCount(0);
  await expect(search.getByTestId('todo-reopen')).toHaveAccessibleName('Reopen Search ignores accents');
  await search.click();
  await expect(ticket.getByTestId('ticket-start')).toHaveCount(0);
  await expect(ticket.getByTestId('ticket-no-questions')).toHaveCount(0);
  await ticket.getByTestId('ticket-reopen').click();
  await expect.poll(() => launches(dataDir).length).toBe(2);
  expect(launches(dataDir)[1].args).toContain('--resume');
  await expect(ticket).toHaveCount(0);
  await expect(items).toHaveCount(1);

  await closeTask(page, id);
  await search.getByTestId('todo-reopen').click();
  await expect.poll(() => launches(dataDir).length).toBe(3);
  await expect(items).toHaveCount(1);
  await expect(ticket).toHaveCount(0);
  await expect.poll(() => ids(page)).toEqual([id]);
  await app.close();
});

test("a Start from the list whose check warns leaves the ticket the owner opened meanwhile, with its text, and the card on the list", async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);
  const logs: string[] = [];
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));

  // The start check is out while the owner begins a note.
  await holdAnswers(app, IPC.startCheck, { value: { ahead: 1, branch: 'stage', base: 'origin/stage' } });
  await itemRow(page, 'card:c128').getByTestId('todo-start').click();
  await page.getByTestId('todo-add-note').click();
  const ticket = page.getByTestId('ticket-panel');
  await ticket.getByLabel('Title').fill('Half a thought');
  await releaseHeld(app);

  // Its warning was logged, not shown: the note's ticket is still the one open, with its text.
  await expect.poll(() => logs.filter((line) => line.startsWith('warning: [todo]') && line.includes('card:c128'))).toHaveLength(1);
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('New todo');
  await expect(ticket.getByLabel('Title')).toHaveValue('Half a thought');
  await expect(itemRow(page, 'card:c128').getByTestId('todo-start')).toBeVisible();
  expect(launches(dataDir)).toEqual([]);
  await app.close();
});

test('a Start from the list that fails leaves the ticket the owner opened meanwhile, with its text, and logs why', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);
  const logs: string[] = [];
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));

  // The start is out while the owner begins a note.
  await holdAnswers(app, IPC.startTodoItem, { error: 'The tracker went away' });
  await itemRow(page, 'card:c128').getByTestId('todo-start').click();
  await page.getByTestId('todo-add-note').click();
  const ticket = page.getByTestId('ticket-panel');
  await ticket.getByLabel('Title').fill('Half a thought');
  await releaseHeld(app);

  await expect
    .poll(() => logs.filter((line) => line.startsWith('error: [todo] could not start card:c128') && line.includes('The tracker went away')))
    .toHaveLength(1);
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('New todo');
  await expect(ticket.getByLabel('Title')).toHaveValue('Half a thought');
  await expect(ticket.getByTestId('ticket-error')).toHaveCount(0);
  await expect(itemRow(page, 'card:c128').getByTestId('todo-start')).toBeVisible();
  expect(launches(dataDir)).toEqual([]);
  await app.close();
});

test('a Start from the list whose start check fails starts the card anyway, as its ticket does, and logs why', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  await syncFirstTime(page, dataDir);
  const logs: string[] = [];
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
  await holdAnswers(app, IPC.startCheck, { error: 'git went away' });
  await releaseHeld(app);

  await itemRow(page, 'card:c128').getByTestId('todo-start').click();
  await expect.poll(() => launches(dataDir)).toHaveLength(1);
  await expect(page.getByTestId('ticket-panel')).toHaveCount(0);
  expect(logs.filter((line) => line.startsWith('error: [todo] start check failed for') && line.includes('git went away'))).toHaveLength(1);
  await app.close();
});

test("a task started from a card shows its number on the board, and the session panel's link opens the card", async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  const [search, exported] = CARDS.cards;
  // The second card has no number, and a URL that is no web address: no link to open.
  await syncFirstTime(page, dataDir, { ...CARDS, cards: [search, { ...exported, number: null, url: 'file:///etc/hosts' }] });
  const startFrom = async (key: string) => {
    const before = await ids(page);
    await itemRow(page, key).getByTestId('todo-start').click();
    await expect.poll(async () => (await ids(page)).length).toBe(before.length + 1);
    return (await ids(page)).find((id) => !before.includes(id))!;
  };
  const searchId = await startFrom('card:c128');
  const exportedId = await startFrom('card:c131');

  // The number comes before the title, and the title's first letter is on the number's line.
  const number = card(page, searchId).getByTestId('task-card-number');
  await expect(number).toHaveText('#128');
  const name = card(page, searchId).locator('.card-name');
  await expect(name).toHaveText('#128 Search ignores accents');
  const sameLine = await number.evaluate((el) => {
    const letter = document.createRange();
    letter.setStart(el.nextSibling!, 0);
    letter.setEnd(el.nextSibling!, 1);
    return Math.abs(letter.getBoundingClientRect().top - el.getBoundingClientRect().top) < 4;
  });
  expect(sameLine).toBe(true);
  await expect(card(page, exportedId).getByTestId('task-card-number')).toHaveCount(0);

  // The started task is on show, and its card has no link to open.
  await expect(page.getByTestId('panel-title')).toHaveText('Export drops the last row');
  await expect(page.getByTestId('panel-card-link')).toHaveCount(0);

  // The link opens the card and leaves the focus in the terminal.
  await card(page, searchId).locator('.card-title').click();
  await expect(page.getByTestId('panel-title')).toHaveText('Search ignores accents');
  await expect.poll(() => terminalHasFocus(page)).toBe(true);
  const link = page.getByTestId('panel-card-link');
  await expect(link).toHaveText('Open in Tracker ↗');
  await link.click();
  await expect.poll(() => openedLinks(app)).toEqual(['https://tracker.example/c/128']);
  expect(await terminalHasFocus(page)).toBe(true);
  await app.close();
});

test('the ticket shows the whole card; Open in Tracker opens its link; Esc, ✕, a press on the board and a second click close it; another card swaps in place', async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  // The second card has a URL that is no web address, which the browser hand-off would not open.
  await syncFirstTime(page, dataDir, { ...CARDS, cards: [CARDS.cards[0], { ...CARDS.cards[1], url: 'file:///etc/hosts' }] });
  const [search, exported] = [itemRow(page, 'card:c128'), itemRow(page, 'card:c131')];
  const ticket = page.getByTestId('ticket-panel');
  await expect(ticket).toHaveCount(0);

  await search.click();
  await expect(search).toHaveAttribute('data-open', 'true');
  await expect(exported).not.toHaveAttribute('data-open', 'true');
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('#128 Search ignores accents');
  await expect(ticket.getByText('UI', { exact: true })).toBeVisible();
  // The description keeps its line breaks.
  expect(await ticket.getByText('Searching for "creme" finds nothing.', { exact: false }).innerText()).toBe(
    'Searching for "creme" finds nothing.\nIt should find "crème" too.',
  );
  const checklist = ticket.getByRole('list', { name: 'Done when' });
  await expect(ticket.getByText('Done when', { exact: true })).toBeVisible();
  await expect(checklist.getByRole('checkbox', { name: 'Accents fold in search' })).toBeChecked();
  await expect(checklist.getByRole('checkbox', { name: 'A test covers it' })).not.toBeChecked();
  await expect(checklist.getByRole('checkbox', { name: 'A test covers it' })).toBeDisabled();
  await expect(ticket.getByText('The card as of the last sync, just now')).toBeVisible();
  await expect(ticket.getByTestId('ticket-start')).toHaveText('Start');
  await expect(ticket.getByTestId('ticket-no-questions')).not.toBeChecked();
  await expect(ticket.getByTestId('ticket-warning')).toHaveCount(0);

  // Joined to the Todo panel's right edge, and over the manager.
  const panel = await box(page, 'todo-panel');
  const at = await box(page, 'ticket-panel');
  expect(Math.abs(at.x - (panel.x + panel.width))).toBeLessThanOrEqual(1);
  const manager = await box(page, 'manager-column');
  expect(at.x).toBeLessThan(manager.x + manager.width);
  expect(await isOnTop(ticket)).toBe(true);

  const link = ticket.getByTestId('ticket-link');
  await expect(link).toHaveText('Open in Tracker ↗');
  await link.click();
  await expect.poll(() => openedLinks(app)).toEqual(['https://tracker.example/c/128']);

  // Another card swaps in place; it has no link to open, as its URL is no web address.
  await exported.click();
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('#131 Export drops the last row');
  await expect(exported).toHaveAttribute('data-open', 'true');
  await expect(search).not.toHaveAttribute('data-open', 'true');
  await expect(ticket.getByTestId('ticket-link')).toHaveCount(0);
  expect(await box(page, 'ticket-panel')).toEqual(at);

  // A second click on the open card closes it, as Esc and ✕ do.
  await exported.click();
  await expect(ticket).toHaveCount(0);
  await expect(exported).not.toHaveAttribute('data-open', 'true');
  await search.click();
  await page.keyboard.press('Escape');
  await expect(ticket).toHaveCount(0);
  await search.click();
  await ticket.getByTestId('ticket-close').click();
  await expect(ticket).toHaveCount(0);

  // A sync that drops the open card takes its ticket along, and the card coming back doesn't bring it.
  await search.click();
  syncReply(dataDir, { ...CARDS, cards: [CARDS.cards[1]] });
  await page.getByTestId('todo-sync').click();
  await expect(search).toHaveCount(0);
  await expect(ticket).toHaveCount(0);
  syncReply(dataDir, CARDS);
  await page.getByTestId('todo-sync').click();
  await expect(search).toHaveCount(1);
  await expect(ticket).toHaveCount(0);

  // The Todo panel going away, folded or off, takes it along; back, the panel shows no ticket.
  await search.click();
  await page.getByTestId('todo-fold').click();
  await page.getByTestId('todo-strip').click();
  await expect(page.getByTestId('todo-panel')).toBeVisible();
  await expect(ticket).toHaveCount(0);
  await search.click();
  await expect(ticket).toBeVisible();
  await page.getByTestId('todo-toggle').click();
  await page.getByTestId('todo-toggle').click();
  await expect(page.getByTestId('todo-panel')).toBeVisible();
  await expect(ticket).toHaveCount(0);

  // Pinned, the Todo panel stays put when the board is pressed; the ticket goes.
  await page.getByTestId('todo-pin').click();
  await search.click();
  await expect(ticket).toBeVisible();
  const board = await box(page, 'board');
  await page.getByTestId('board').click({ position: { x: board.width - 40, y: board.height - 40 } });
  await expect(ticket).toHaveCount(0);
  await expect(page.getByTestId('todo-panel')).toBeVisible();
  expect(launches(dataDir)).toEqual([]);
  await app.close();
});

test('a start the check warns about opens the ticket with the warning, and Start anyway starts it', async () => {
  const { app, page, dataDir } = await launchApp({}, repoAhead());
  await syncFirstTime(page, dataDir);

  await itemRow(page, 'card:c128').getByTestId('todo-start').click();
  const ticket = page.getByTestId('ticket-panel');
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('#128 Search ignores accents');
  // The New task dialog's warning, word for word.
  await expect(ticket.getByTestId('ticket-warning')).toHaveText(
    "stage has 1 commit that isn't on origin/stage. New worktrees start from origin/stage, so this task won't have it. Push stage first, or start anyway.",
  );
  expect(launches(dataDir)).toEqual([]);

  const start = ticket.getByTestId('ticket-start');
  await expect(start).toHaveText('Start anyway');
  await ticket.getByTestId('ticket-no-questions').check();
  await start.click();
  await expect.poll(() => launches(dataDir)[0]?.args.at(-1)).toContain('No questions on this task');
  expect(launches(dataDir)[0].args.at(-1)).toContain('Task: #128 Search ignores accents');
  await expect(ticket).toHaveCount(0);
  await expect(page.getByTestId('todo-item')).toHaveCount(1);

  // A ticket opened by a click warns as well.
  await itemRow(page, 'card:c131').click();
  await expect(ticket.getByTestId('ticket-warning')).toBeVisible();
  await expect(start).toHaveText('Start anyway');
  await app.close();
});

test('a note is added, edited, kept across a restart, and started as a task, which takes it off the list', async () => {
  const project = folder();
  const first = await launchApp({}, project);
  const ticket = first.page.getByTestId('ticket-panel');
  await first.page.getByTestId('todo-toggle').click();

  // Quick Add sits in the panel's top bar, between its name and Sync, and the fold button and the pin after them, apart
  // and on one line even at the panel's narrowest, where Sync drops its word (spec §7). Its hover says that what it
  // adds stays in Mainframe.
  await expect(first.page.getByTestId('todo-add-note')).toHaveText('Quick Add');
  await expect(first.page.getByTestId('todo-add-note')).toHaveAttribute(
    'title',
    "Add a todo that stays in Mainframe. It isn't added to your tracker: Sync only reads from it.",
  );
  const edge = first.page.getByTestId('todo-resize');
  await edge.focus();
  // One step narrower than its 320 px, Sync's word doesn't run into the fold button.
  await first.page.keyboard.press('ArrowLeft');
  await expect(edge).toHaveAttribute('aria-valuenow', '304');
  const worded = await box(first.page, 'todo-sync');
  expect(worded.x + worded.width).toBeLessThan((await box(first.page, 'todo-fold')).x);
  for (let i = 0; i < 2; i++) await first.page.keyboard.press('ArrowLeft');
  await expect(edge).toHaveAttribute('aria-valuenow', '280');
  const name = (await first.page.getByRole('heading', { name: 'Todo', level: 2 }).boundingBox())!;
  const add = await box(first.page, 'todo-add-note');
  const sync = await box(first.page, 'todo-sync');
  const fold = await box(first.page, 'todo-fold');
  const pin = await box(first.page, 'todo-pin');
  expect(name.x + name.width).toBeLessThan(add.x);
  expect(add.x + add.width).toBeLessThan(sync.x);
  expect(sync.x + sync.width).toBeLessThan(fold.x);
  expect(fold.x + fold.width).toBeLessThan(pin.x);
  for (const b of [add, sync, fold, pin]) expect(Math.abs(middle(b) - middle(name))).toBeLessThanOrEqual(1);
  await expect(first.page.getByTestId('todo-sync')).toHaveAccessibleName('Sync');

  await first.page.getByTestId('todo-add-note').click();
  await expect(ticket.getByLabel('Title')).toBeFocused();
  await expect(ticket.getByTestId('note-save')).toHaveText('Save todo');
  await expect(ticket.getByTestId('note-delete')).toHaveCount(0);
  await ticket.getByLabel('Title').fill('Tidy the flags');
  await ticket.getByLabel('Text').fill('Remove the old flags.\nKeep the new ones.');
  await ticket.getByTestId('note-save').click();
  const items = first.page.getByTestId('todo-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Tidy the flags');
  await expect(items.first()).toContainText('Todo');
  await expect(ticket).toHaveCount(0);

  await items.first().click();
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('Todo');
  await expect(ticket.getByTestId('note-delete')).toHaveText('Delete todo');
  await expect(ticket.getByLabel('Title')).toHaveValue('Tidy the flags');
  await expect(ticket.getByLabel('Text')).toHaveValue('Remove the old flags.\nKeep the new ones.');
  await ticket.getByLabel('Title').fill('Tidy the feature flags');
  await ticket.getByTestId('note-save').click();
  await expect(items.first()).toContainText('Tidy the feature flags');

  // Delete todo takes it away.
  await first.page.getByTestId('todo-add-note').click();
  await ticket.getByLabel('Title').fill('Scratch');
  await ticket.getByTestId('note-save').click();
  await expect(items).toHaveCount(2);
  await items.nth(1).click();
  await ticket.getByTestId('note-delete').click();
  await expect(items).toHaveCount(1);
  await expect(ticket).toHaveCount(0);
  await first.app.close();

  const { app, page, dataDir } = await launchApp({ MAINFRAME_DATA_DIR: first.dataDir }, project);
  const again = page.getByTestId('todo-item');
  await page.getByTestId('todo-toggle').click();
  await expect(again).toHaveCount(1);
  await expect(again.first()).toContainText('Tidy the feature flags');

  // Start saves the edits first, and the note leaves the list once its task has started.
  await again.first().click();
  await page.getByTestId('ticket-panel').getByLabel('Text').fill('Remove the old flags.');
  // Start waits for the start check that opening the ticket runs, and a disabled button can't take the focus.
  await expect(page.getByTestId('ticket-start')).toBeEnabled();
  await page.getByTestId('ticket-start').focus();
  await expect(page.getByTestId('ticket-start')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => taskBriefs(page)).toEqual([{ title: 'Tidy the feature flags', description: 'Remove the old flags.' }]);
  await expect(again).toHaveCount(0);
  await expect(page.getByTestId('ticket-panel')).toHaveCount(0);
  await expect(page.getByTestId('panel-title')).toHaveText('Tidy the feature flags');
  await expect.poll(() => terminalHasFocus(page)).toBe(true);
  // The terminal has focus before the session's program has started and logged its launch.
  await expect.poll(() => launches(dataDir)).toHaveLength(1);

  // A new note's Start starts a task as New task does, and keeps no note.
  await page.getByTestId('todo-add-note').click();
  await page.getByTestId('ticket-panel').getByLabel('Title').fill('Write the changelog');
  await page.getByTestId('ticket-panel').getByLabel('Text').fill('For the next release.');
  await page.getByTestId('ticket-start').click();
  await expect.poll(() => taskBriefs(page)).toEqual([
    { title: 'Tidy the feature flags', description: 'Remove the old flags.' },
    { title: 'Write the changelog', description: 'For the next release.' },
  ]);
  await expect(page.getByTestId('ticket-panel')).toHaveCount(0);
  await expect(again).toHaveCount(0);
  await expect(page.getByTestId('panel-title')).toHaveText('Write the changelog');
  await expect.poll(() => terminalHasFocus(page)).toBe(true);
  await app.close();
});

test("a note's unsaved typing is kept as a draft when its ticket closes, by Esc, ✕, the board or another row, and goes once saved or started", async () => {
  const { app, page } = await launchApp({}, folder());
  const ticket = page.getByTestId('ticket-panel');
  const items = page.getByTestId('todo-item');
  const title = ticket.getByLabel('Title');
  const text = ticket.getByLabel('Text');
  await page.getByTestId('todo-toggle').click();
  await page.getByTestId('todo-pin').click();

  // The new note: Esc closes it, and Quick Add brings back what was typed. Saved, the next new note starts empty.
  await page.getByTestId('todo-add-note').click();
  await title.fill('Tidy the flags');
  await text.fill('Remove the old flags.');
  await page.keyboard.press('Escape');
  await expect(ticket).toHaveCount(0);
  await page.getByTestId('todo-add-note').click();
  await expect(title).toHaveValue('Tidy the flags');
  await expect(text).toHaveValue('Remove the old flags.');
  await ticket.getByTestId('note-save').click();
  await expect(items).toHaveCount(1);
  await page.getByTestId('todo-add-note').click();
  await expect(title).toHaveValue('');
  await expect(text).toHaveValue('');
  await title.fill('Scratch');
  await ticket.getByTestId('note-save').click();
  await expect(items).toHaveCount(2);

  // A saved note's edits survive another row, ✕ and a press on the board; the list keeps the saved text.
  await items.first().click();
  await text.fill('Remove the old flags, and their tests.');
  await items.nth(1).click();
  await expect(title).toHaveValue('Scratch');
  await items.first().click();
  await expect(text).toHaveValue('Remove the old flags, and their tests.');
  await ticket.getByTestId('ticket-close').click();
  await items.first().click();
  await expect(text).toHaveValue('Remove the old flags, and their tests.');
  const board = await box(page, 'board');
  await page.getByTestId('board').click({ position: { x: board.width - 40, y: board.height - 40 } });
  await expect(ticket).toHaveCount(0);
  await expect(items.first()).toContainText('Remove the old flags.');
  await items.first().click();
  await expect(text).toHaveValue('Remove the old flags, and their tests.');

  // Saved, the draft is the note: closing and opening shows the saved text.
  await ticket.getByTestId('note-save').click();
  await expect(items.first()).toContainText('and their tests.');
  await page.keyboard.press('Escape');
  await items.first().click();
  await expect(text).toHaveValue('Remove the old flags, and their tests.');
  await page.keyboard.press('Escape');

  // A new note started as a task keeps no draft.
  await page.getByTestId('todo-add-note').click();
  await title.fill('Write the changelog');
  await page.getByTestId('ticket-start').click();
  await expect.poll(() => taskBriefs(page)).toEqual([{ title: 'Write the changelog', description: '' }]);
  await page.getByTestId('todo-add-note').click();
  await expect(title).toHaveValue('');
  await app.close();
});

test("a card for the owner has no Start in the list; its ticket says it is marked as yours and Start anyway starts it, and a closed one offers Reopen", async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  const [search] = CARDS.cards;
  await syncFirstTime(page, dataDir, { ...CARDS, cards: [search, OWNER_CARD] });

  const owner = itemRow(page, 'card:c119');
  await expect(owner).toHaveAttribute('data-for-owner', 'true');
  await expect(owner.getByTestId('todo-start')).toHaveCount(0);
  await expect(owner.getByTestId('todo-reopen')).toHaveCount(0);
  await owner.click();
  const ticket = page.getByTestId('ticket-panel');
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('#119 Decide on the refund window');
  await expect(ticket.getByText('Decision', { exact: true })).toBeVisible();
  await expect(ticket.getByTestId('ticket-reopen')).toHaveCount(0);

  // The footer every card has, with one quiet line above the one button.
  await expect(ticket.getByText('This card is marked as yours.')).toBeVisible();
  await expect(ticket.getByTestId('ticket-start')).toHaveCount(0);
  const startAnyway = ticket.getByTestId('ticket-start-owner');
  await expect(startAnyway).toHaveText('Start anyway');
  await expect(ticket.getByTestId('ticket-no-questions')).not.toBeChecked();
  await expect(ticket.getByTestId('ticket-warning')).toHaveCount(0);
  expect(launches(dataDir)).toEqual([]);

  // It starts the task as the ticket's Start does: under Working and selected, the choice of no questions kept, the
  // ticket closed, the card off the list.
  await ticket.getByTestId('ticket-no-questions').check();
  await startAnyway.click();
  await expect.poll(() => launches(dataDir)[0]?.args.at(-1)).toContain('No questions on this task');
  expect(launches(dataDir)[0].args.at(-1)).toContain('Task: #119 Decide on the refund window');
  const [id] = await ids(page);
  await expect(cardIn(page, 'working', id)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('panel-title')).toHaveText('Decide on the refund window');
  await expect(ticket).toHaveCount(0);
  await expect(owner).toHaveCount(0);

  // Closed, it comes back greyed with Reopen, in the list and in its ticket, and still no Start.
  await closeTask(page, id);
  await expect(owner.getByTestId('todo-reopen')).toHaveAccessibleName('Reopen Decide on the refund window');
  await expect(owner.getByTestId('todo-start')).toHaveCount(0);
  await expect(owner).toHaveAttribute('data-for-owner', 'true');
  await owner.click();
  await expect(ticket.getByTestId('ticket-reopen')).toBeVisible();
  await expect(ticket.getByTestId('ticket-start-owner')).toHaveCount(0);
  await expect(ticket.getByText('This card is marked as yours.')).toHaveCount(0);
  await app.close();
});

test("a card for the owner whose start the check warns about shows the warning above the same Start anyway", async () => {
  const { app, page, dataDir } = await launchApp({}, repoAhead());
  await syncFirstTime(page, dataDir, { ...CARDS, cards: [OWNER_CARD] });

  await itemRow(page, 'card:c119').click();
  const ticket = page.getByTestId('ticket-panel');
  await expect(ticket.getByTestId('ticket-warning')).toBeVisible();
  await expect(ticket.getByText('This card is marked as yours.')).toBeVisible();
  await expect(ticket.getByTestId('ticket-start')).toHaveCount(0);
  await expect(ticket.getByTestId('ticket-start-owner')).toHaveText('Start anyway');
  expect(launches(dataDir)).toEqual([]);

  await ticket.getByTestId('ticket-start-owner').click();
  await expect.poll(() => launches(dataDir)[0]?.args.at(-1)).toContain('Task: #119 Decide on the refund window');
  await expect(ticket).toHaveCount(0);
  await app.close();
});

test('Hide my tasks waits for a card for the owner, then leaves those out and counts them; an open ticket of one closes; the choice is kept across a restart', async () => {
  const project = folder();
  const first = await launchApp({}, project);
  const { page, dataDir } = first;
  const [search] = CARDS.cards;
  const items = page.getByTestId('todo-item');
  const hide = page.getByTestId('todo-hide-mine');

  // Nothing in the list is for the owner, so there is nothing to hide: no switch.
  await syncFirstTime(page, dataDir);
  await expect(hide).toHaveCount(0);

  syncReply(dataDir, { ...CARDS, cards: [search, OWNER_CARD] });
  await page.getByTestId('todo-sync').click();
  await expect(hide).toBeVisible();
  await expect(hide).toHaveText('Hide my tasks');
  await expect(hide).toHaveAttribute('aria-pressed', 'false');
  await expect(items).toHaveCount(2);
  await expect(itemRow(page, 'card:c119')).toBeVisible();

  // The card for the owner leaves and the card for a session stays; the ticket of the one that left goes with it.
  await itemRow(page, 'card:c119').click();
  await expect(page.getByTestId('ticket-panel')).toBeVisible();
  await hide.click();
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute('data-key', 'card:c128');
  await expect(page.getByTestId('ticket-panel')).toHaveCount(0);
  await expect(hide).toContainText('1 hidden');
  await first.app.close();

  // Kept for the project, and applied before any sync.
  const again = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, project);
  const [list, switchAgain] = [again.page.getByTestId('todo-item'), again.page.getByTestId('todo-hide-mine')];
  await again.page.getByTestId('todo-toggle').click();
  await expect(switchAgain).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveCount(1);
  await expect(switchAgain).toContainText('1 hidden');

  // A list of nothing but the owner's cards says so, and the switch stays, so it can be turned off.
  syncReply(dataDir, { ...CARDS, cards: [OWNER_CARD] });
  await again.page.getByTestId('todo-sync').click();
  await expect(again.page.getByText('Every card on the list is one of yours.')).toBeVisible();
  await expect(list).toHaveCount(0);
  await expect(switchAgain).toContainText('1 hidden');
  await expect(again.page.getByTestId('todo-add-note')).toBeVisible();

  syncReply(dataDir, { ...CARDS, cards: [search, OWNER_CARD] });
  await again.page.getByTestId('todo-sync').click();
  await expect(list).toHaveCount(1);
  await expect(again.page.getByText('Every card on the list is one of yours.')).toHaveCount(0);

  // Off, the card comes back, and the count goes.
  await switchAgain.click();
  await expect(switchAgain).toHaveAttribute('aria-pressed', 'false');
  await expect(switchAgain).toHaveText('Hide my tasks');
  await expect(list).toHaveCount(2);
  await expect(itemRow(again.page, 'card:c119')).toBeVisible();
  await again.app.close();
});

test("a card's description shows its Markdown in the ticket, never as HTML, and its row previews the text without the marks", async () => {
  const { app, page, dataDir } = await launchApp({}, folder());
  const description = [
    '## Steps to reproduce',
    '',
    '- Open **Search**',
    '- Type `creme`',
    '',
    'See [the report](https://example.com/x) for more, or [a bad one](javascript:window.__pwned=1).',
    '',
    'Built: [![build](https://ci.example/badge.svg)](https://ci.example/run/1), ![](https://example.com/blank.png) ![a shot](https://example.com/shot.png)',
    '',
    '<img src=x onerror="window.__pwned=1">',
  ].join('\n');
  await syncFirstTime(page, dataDir, { ...CARDS, cards: [{ ...CARDS.cards[0], description }] });

  // The row: what a reader sees, with no `**`, no backticks and no `#`.
  const row = itemRow(page, 'card:c128');
  await expect(row.locator('.todo-body')).toHaveText(
    'Steps to reproduce Open Search Type creme See the report for more, or a bad one. Built: build, a shot <img src=x onerror="window.__pwned=1">',
  );

  await row.click();
  const ticket = page.getByTestId('ticket-panel');
  const desc = ticket.locator('.md');
  await expect(desc.getByRole('heading', { name: 'Steps to reproduce' })).toBeVisible();
  await expect(desc.locator('li')).toHaveText(['Open Search', 'Type creme']);
  await expect(desc.locator('strong')).toHaveText('Search');
  await expect(desc.locator('code')).toHaveText('creme');

  // A web link opens in the owner's browser, as Open in Tracker does, and the window itself goes nowhere. Any other
  // address is text, not a link.
  await expect(desc.getByRole('link')).toHaveCount(2);
  await expect(desc.getByText('a bad one')).toBeVisible();
  await desc.getByRole('link', { name: 'the report' }).click();
  await expect.poll(() => openedLinks(app)).toEqual(['https://example.com/x']);
  await expect(ticket).toBeVisible();
  // An image is its alt text, and no link of its own: a badge opens where its link goes, not the picture.
  await expect(desc.getByRole('link', { name: 'build' })).toHaveAttribute('href', 'https://ci.example/run/1');
  await expect(desc.locator('p', { hasText: 'Built:' })).toHaveText('Built: build, a shot');
  await expect(desc.locator('a a, a:empty')).toHaveCount(0);

  // The text of an image tag shows as text: no image is made, and nothing it carries runs.
  await expect(desc.getByText('<img src=x onerror="window.__pwned=1">', { exact: true })).toBeVisible();
  await expect(page.getByTestId('todo-panel').locator('img')).toHaveCount(0);
  await expect(ticket.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await app.close();
});
