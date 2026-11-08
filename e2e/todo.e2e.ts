import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { cleanUp, launchApp, removeAfterTest, setWindowWidth } from './launch';
import { box, launches, syncLaunches, syncReply, todoDir } from './tasks';

test.afterEach(cleanUp);

/** A project folder of its own, removed after the test. */
const folder = () => removeAfterTest(mkdtempSync(join(tmpdir(), 'mainframe-todo-')));

const pane = (page: Page, dir: string) => page.locator(`[data-testid=project-pane][data-project="${dir}"]`);

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
      checklists: [],
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

/** The project's first sync, as the owner makes it: Sync, allow the tools it asks about, and the cards show. */
async function syncFirstTime(scope: Page | Locator, dataDir: string): Promise<void> {
  syncReply(dataDir, TOOLS);
  await scope.getByTestId('todo-toggle').click();
  await scope.getByTestId('todo-sync').click();
  await expect(scope.getByTestId('todo-confirm-tools')).toBeVisible();
  syncReply(dataDir, CARDS);
  await scope.getByTestId('todo-confirm-tools').click();
  await expect(scope.getByTestId('todo-item')).toHaveCount(2);
}

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
  await expect(panel.getByText('Sync reads your to-do list in Tracker with these tools, which only read:')).toBeVisible();
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
  await expect(panel.getByText('Tracker · Shop · To do', { exact: true })).toBeVisible();
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
  await expect(page.getByTestId('todo-sync')).toBeEnabled();

  // Set up again forgets the allowed tools, so the next sync asks again; the list stays meanwhile.
  await page.getByTestId('todo-reset').click();
  await expect(page.getByTestId('todo-reset')).toHaveCount(0);
  await expect(page.getByTestId('todo-error')).toHaveCount(0);
  await expect(page.getByTestId('todo-item')).toHaveCount(2);
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
  const row = page.locator(`[data-testid=rail-project][data-project="${globex}"]`);
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
  await expect(pane(page, acme).getByText('Tracker · Shop · To do', { exact: true })).toBeVisible();
  await app.close();
});

test("pinned, the Todo panel takes the pane's left edge and the manager sits right of it; unpinned, it floats over the manager, and a press on the board puts it away", async () => {
  const project = folder();
  const first = await launchApp({}, project);
  const { page, dataDir } = first;
  const panel = page.getByTestId('todo-panel');
  const toggle = page.getByTestId('todo-toggle');
  const pin = page.getByTestId('todo-pin');
  await expect(panel).toHaveAttribute('data-pinned', 'false');
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // Floating, it takes no room: in the window as it opens, beside the pinned manager, it has its own width and can
  // grow to its maximum.
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('manager-column')).toHaveAttribute('data-pinned', 'true');
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

  // Put away, the manager's way back sits right of the Todo panel, not under it.
  await page.getByTestId('manager-hide').click();
  await expect(page.getByTestId('manager-column')).toBeHidden();
  expect((await box(page, 'manager-show')).x).toBeGreaterThanOrEqual(pinned.x + pinned.width);
  await page.getByTestId('manager-show').click();
  await expect(page.getByTestId('manager-column')).toBeVisible();

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
  const onTop = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(onTop).toBe(true);

  // Its arrow puts it away and hands the focus to the Todo button, which brings it back.
  await page.getByTestId('todo-hide').click();
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(panel).toBeVisible();

  // A press on the board right of the islands puts it away; the pinned manager stays.
  const board = await box(page, 'board');
  await page.getByTestId('board').click({ position: { x: under.x + under.width - board.x + 40, y: board.height - 40 } });
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('manager-column')).toBeVisible();
  await first.app.close();

  // The pin and the width are the project's, kept for the next start.
  const again = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, project);
  await setWindowWidth(again.app, again.page, 1700);
  const panelAgain = again.page.getByTestId('todo-panel');
  await expect(panelAgain).toHaveAttribute('data-pinned', 'false');
  await expect(panelAgain).toBeHidden();
  await again.page.getByTestId('todo-toggle').click();
  await expect(panelAgain).toBeVisible();
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
