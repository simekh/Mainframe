import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { closeFakeTrellos, FAKE_USERNAME, fakeCardId, fakeId, startFakeTrello, type FakeBoard, type FakeCard, type FakeTrello } from './fakeTrello';
import { cleanUp, launchApp, removeAfterTest } from './launch';
import { openedLinks, projectPane as pane, railRow, syncLaunches } from './tasks';

test.afterEach(async () => {
  await cleanUp();
  await closeFakeTrellos();
});

/** A project folder of its own, removed after the test. */
const folder = () => removeAfterTest(mkdtempSync(join(tmpdir(), 'mainframe-trello-')));

const SEARCH = {
  number: 12,
  name: 'Search ignores accents',
  desc: 'Searching for "creme" finds nothing.',
  labels: ['UI'],
  checklists: [
    {
      name: 'Done when',
      items: [
        { name: 'Accents fold in search', done: true },
        { name: 'A test covers it', done: false },
      ],
    },
  ],
};
const EXPORT = { number: 15, name: 'Export drops the last row', labels: ['red'] };
const REFUND = { number: 19, name: 'Decide on the refund window', labels: ['Owner'] };
const INVOICE = { number: 21, name: 'Invoices show the wrong date' };

/** A board with two lists to read from; its third label has no name, so it goes by its colour. */
const shop = (todo: FakeCard[] = [SEARCH, EXPORT, REFUND]): FakeBoard => ({
  name: 'Shop',
  labels: [
    { name: 'UI', color: 'green' },
    { name: 'Owner', color: 'yellow' },
    { name: '', color: 'red' },
  ],
  lists: [
    { name: 'To do', cards: todo },
    { name: 'Doing', cards: [INVOICE] },
  ],
});

/** The same board without its To do list: deleted, or no longer shared. */
const shopWithoutTodo = (): FakeBoard => ({ ...shop(), lists: shop().lists.filter((l) => l.name !== 'To do') });

const launch = (fake: FakeTrello, projects: string | string[] = folder()) => launchApp({ MAINFRAME_E2E_TRELLO_URL: fake.url }, projects);

/**
 * Plays the browser for a Connect just pressed: opens the authorize link the app asked to open, which the fake sends
 * straight back to the app's loopback with a code. Resolves once the app has read the username, so that request
 * can't take an answer a test sets up next.
 */
async function signIn(app: ElectronApplication, fake: FakeTrello): Promise<URL> {
  const authorize = async () => (await openedLinks(app)).filter((link) => link.startsWith(`${fake.url}/authorize`)).at(-1);
  await expect.poll(authorize).toBeTruthy();
  const link = (await authorize())!;
  const answer = await fetch(link);
  // The tab's text; the loopback may close the connection as it answers.
  await answer.text().catch(() => '');
  await expect.poll(() => fake.requests).toContain('GET /1/members/me?fields=username');
  return new URL(link);
}

const openSettings = async (page: Page) => {
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
};

const closeSettings = async (page: Page) => {
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
};

/**
 * Sets the project in `scope` up on a Trello list from its Todo panel: Trello in the choice, Connect there unless
 * `signedIn`, then the board, the list and the labels that mark the owner's cards.
 */
async function setUpTrello(
  scope: Page | Locator,
  app: ElectronApplication,
  fake: FakeTrello,
  o: { list: string; mine?: string[]; signedIn?: boolean },
): Promise<void> {
  await scope.getByTestId('todo-toggle').click();
  await scope.getByTestId('todo-source-choice-trello').click();
  if (!o.signedIn) {
    await scope.getByTestId('todo-connect-trello').click();
    await signIn(app, fake);
  }
  const setup = scope.getByTestId('trello-setup');
  await setup.getByTestId('trello-board').selectOption({ label: 'Shop' });
  await setup.getByTestId('trello-list').selectOption({ label: o.list });
  for (const label of o.mine ?? []) await setup.getByTestId('trello-mine').getByRole('button', { name: label, exact: true }).click();
  await setup.getByTestId('trello-use').click();
  await expect(setup).toHaveCount(0);
  await expect(scope.getByTestId('todo-source')).toHaveText(`Trello ↗ · Shop · ${o.list}`);
}

/** The row of the card with this number on the Shop board. */
const cardRow = (scope: Page | Locator, number: number) =>
  scope.locator(`[data-testid=todo-item][data-key="card:${fakeCardId('Shop', number)}"]`);

test('Connect in Settings signs in through the browser and shows the username', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page } = await launch(fake);
  await openSettings(page);
  const connect = page.getByTestId('trello-connect');
  await expect(connect).toHaveText('Connect Trello');
  await connect.click();

  // The sign-in is the browser's: Mainframe opens Trello's page there, and waits for it to come back.
  const link = await signIn(app, fake);
  expect(link.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  expect(link.searchParams.get('code_challenge_method')).toBe('S256');
  expect(link.searchParams.get('code_challenge')).toBeTruthy();
  expect(link.searchParams.get('state')).toBeTruthy();
  expect(fake.requests).toContain('POST /oauth/token');

  await expect(page.getByTestId('trello-user')).toHaveText(`Connected as @${FAKE_USERNAME}`);
  await expect(page.getByTestId('trello-disconnect')).toBeVisible();
  await expect(connect).toHaveCount(0);
  await expect(page.getByTestId('trello-error')).toHaveCount(0);
  await app.close();
});

test('a project set up on Trello shows its list with numbers, labels and checklists, without a sync run', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page, dataDir } = await launch(fake);
  await setUpTrello(page, app, fake, { list: 'To do', mine: ['Owner'] });

  // In the list's order, which the app takes from each card's place, not from the order Trello sends them in.
  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(3);
  await expect(items.first()).toHaveAttribute('data-key', `card:${fakeCardId('Shop', 12)}`);
  await expect(items.first()).toContainText('#12');
  await expect(items.first()).toContainText('Search ignores accents');
  await expect(items.first()).toContainText('UI');
  // The label with no name shows its colour.
  await expect(cardRow(page, 15)).toContainText('#15');
  await expect(cardRow(page, 15)).toContainText('red');
  // The Mine label makes the card the owner's: it has no Start.
  await expect(cardRow(page, 19)).toHaveAttribute('data-for-owner', 'true');
  await expect(cardRow(page, 19).getByTestId('todo-start')).toHaveCount(0);
  await expect(cardRow(page, 12)).toHaveAttribute('data-for-owner', 'false');
  await expect(page.getByText('Synced just now')).toBeVisible();

  // A Trello list reads in a moment: Refresh, with nothing to stop.
  await expect(page.getByTestId('todo-refresh')).toBeVisible();
  await expect(page.getByTestId('todo-sync')).toHaveCount(0);

  // The ticket shows the card's description and checklist.
  await cardRow(page, 12).click();
  const ticket = page.getByTestId('ticket-panel');
  await expect(ticket.getByRole('heading', { level: 3 })).toHaveText('#12 Search ignores accents');
  await expect(ticket.getByText('Searching for "creme" finds nothing.')).toBeVisible();
  const checklist = ticket.getByRole('list', { name: 'Done when' });
  await expect(checklist.getByRole('checkbox', { name: 'Accents fold in search' })).toBeChecked();
  await expect(checklist.getByRole('checkbox', { name: 'A test covers it' })).not.toBeChecked();

  // Read from Trello itself: the list's cards, and no run of the agent.
  expect(fake.requests.some((r) => r.startsWith(`GET /1/lists/${fakeId('Shop', 'list', 'To do')}/cards?`))).toBe(true);
  expect(syncLaunches(dataDir)).toEqual([]);
  await app.close();
});

test('Refresh shows a card changed in Trello, in place', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page } = await launch(fake);
  await setUpTrello(page, app, fake, { list: 'To do' });
  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(3);
  // Marks the rows as they are: a row built anew would drop the mark.
  await items.evaluateAll((rows) => rows.forEach((row) => row.setAttribute('data-first-read', '')));

  fake.set([shop([{ ...SEARCH, name: 'Search ignores accents and case' }, EXPORT, REFUND])]);
  await page.getByTestId('todo-refresh').click();
  await expect(cardRow(page, 12)).toContainText('Search ignores accents and case');
  await expect(page.locator('[data-testid=todo-item][data-first-read]')).toHaveCount(3);
  await app.close();
});

test('window focus refreshes too', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page } = await launch(fake);
  await setUpTrello(page, app, fake, { list: 'To do' });
  await expect(page.getByTestId('todo-item')).toHaveCount(3);

  // A card added in Trello while the owner was in another app shows on coming back to Mainframe.
  fake.set([shop([SEARCH, EXPORT, REFUND, { number: 23, name: 'Receipts lose their logo' }])]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('todo-item')).toHaveCount(4);
  await expect(cardRow(page, 23)).toContainText('Receipts lose their logo');
  await app.close();
});

test('two projects on one board keep their own lists', async () => {
  const fake = await startFakeTrello([shop()]);
  const [acme, globex] = [folder(), folder()];
  const { app, page } = await launch(fake, [acme, globex]);
  const row = railRow(page, globex);
  await row.hover();
  await row.getByTestId('rail-beside').click();
  await expect(pane(page, globex)).toHaveAttribute('data-shown', 'true');

  // One sign-in serves both.
  await setUpTrello(pane(page, acme), app, fake, { list: 'To do' });
  await setUpTrello(pane(page, globex), app, fake, { list: 'Doing', signedIn: true });

  await expect(pane(page, acme).getByTestId('todo-item')).toHaveCount(3);
  await expect(pane(page, globex).getByTestId('todo-item')).toHaveCount(1);
  await expect(cardRow(pane(page, globex), 21)).toContainText('Invoices show the wrong date');
  await expect(cardRow(pane(page, acme), 21)).toHaveCount(0);

  // A refresh in one reads its own list, and leaves the other's as it was.
  fake.set([shop([{ ...SEARCH, name: 'Search ignores accents and case' }, EXPORT, REFUND])]);
  await pane(page, globex).getByTestId('todo-refresh').click();
  await expect(pane(page, globex).getByTestId('todo-source')).toHaveText('Trello ↗ · Shop · Doing');
  await pane(page, acme).getByTestId('todo-refresh').click();
  await expect(cardRow(pane(page, acme), 12)).toContainText('Search ignores accents and case');
  await expect(pane(page, globex).getByTestId('todo-item')).toHaveCount(1);
  await expect(pane(page, acme).getByTestId('todo-source')).toHaveText('Trello ↗ · Shop · To do');
  await app.close();
});

test('a 429 shows "Trello is busy; retrying" and the list stays', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page } = await launch(fake);
  await setUpTrello(page, app, fake, { list: 'To do' });
  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(3);

  // Trello asks to wait no time at all, so the next Refresh reads again.
  fake.respondNext(429, { 'retry-after': '0' });
  await page.getByTestId('todo-refresh').click();
  await expect(page.getByTestId('todo-notice')).toHaveText('Trello is busy; retrying');
  await expect(items).toHaveCount(3);
  await expect(page.getByTestId('todo-error')).toHaveCount(0);

  // The next read that goes through clears it.
  await page.getByTestId('todo-refresh').click();
  await expect(page.getByTestId('todo-notice')).toHaveCount(0);
  await expect(items).toHaveCount(3);
  await app.close();
});

test('a gone list says so; Set up again picks another', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page } = await launch(fake);
  await setUpTrello(page, app, fake, { list: 'To do' });
  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(3);

  fake.set([shopWithoutTodo()]);
  await page.getByTestId('todo-refresh').click();
  await expect(page.getByTestId('todo-error')).toHaveText(
    'This list is gone or you no longer have access. Set up again to pick another.',
  );
  // The last copy stays meanwhile.
  await expect(items).toHaveCount(3);

  // Set up again asks where the list lives, and Trello's side needs no new sign-in.
  await page.getByTestId('todo-reset').click();
  await page.getByTestId('todo-source-choice-trello').click();
  const setup = page.getByTestId('trello-setup');
  await setup.getByTestId('trello-board').selectOption({ label: 'Shop' });
  await expect(setup.getByTestId('trello-list').locator('option')).toHaveText(['Pick a list', 'Doing']);
  await setup.getByTestId('trello-list').selectOption({ label: 'Doing' });
  await setup.getByTestId('trello-use').click();

  await expect(page.getByTestId('todo-source')).toHaveText('Trello ↗ · Shop · Doing');
  await expect(items).toHaveCount(1);
  await expect(cardRow(page, 21)).toContainText('Invoices show the wrong date');
  await expect(page.getByTestId('todo-error')).toHaveCount(0);
  await app.close();
});

test('Disconnect shows Connect again, and the list stays on screen', async () => {
  const fake = await startFakeTrello([shop()]);
  const { app, page } = await launch(fake);
  await setUpTrello(page, app, fake, { list: 'To do' });
  await expect(page.getByTestId('todo-item')).toHaveCount(3);

  await openSettings(page);
  await expect(page.getByTestId('trello-user')).toHaveText(`Connected as @${FAKE_USERNAME}`);
  await page.getByTestId('trello-disconnect').click();
  await expect(page.getByTestId('trello-connect')).toHaveText('Connect Trello');
  await expect(page.getByTestId('trello-user')).toHaveCount(0);
  await closeSettings(page);

  // The last copy stays, from where it was read, and the panel offers Connect: the list can't be read until then.
  await expect(page.getByTestId('todo-item')).toHaveCount(3);
  await expect(page.getByTestId('todo-source')).toHaveText('Trello ↗ · Shop · To do');
  await expect(page.getByTestId('todo-reconnect')).toHaveText('Connect Trello');
  await expect(page.getByText('Not connected to Trello. The list shows the last copy.')).toBeVisible();
  await expect(page.getByTestId('todo-error')).toHaveCount(0);
  await app.close();
});
