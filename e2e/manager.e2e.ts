import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { ROLE_PROMPT } from '../src/main/manager/rolePrompt';
import { cleanUp, launchApp, setWindowWidth } from './launch';
import {
  box, card, cardIn, ids, isOnTop, launches, managerDir, managerLaunches, managerScreen, managerTermSize, mcpCall, report,
  repo, run, screen, sendLine, sendManagerLine, sessionIdOf, settled, startTask, terminalHasFocus, termSize, UUID,
} from './tasks';

test.afterEach(cleanUp);

const STOPPED_NOTE = 'The manager stopped. Restart continues its chat.';

/** The id of the conversation the manager's first launch began. */
const firstConversation = (dataDir: string) => sessionIdOf(managerLaunches(dataDir)[0].args);

/** The files of the manager's that each of its launches names. */
const filesOf = (dataDir: string) => ({
  mcp: join(managerDir(dataDir), 'mcp.json'),
  settings: join(managerDir(dataDir), 'settings.json'),
});

/** The manager's launch that resumes the conversation `id`, with `prompt` after the role prompt. */
const resumeArgs = (dataDir: string, id: string, ...prompt: string[]) => [
  '--resume', id, '--mcp-config', filesOf(dataDir).mcp, '--settings', filesOf(dataDir).settings,
  '--append-system-prompt', ROLE_PROMPT, ...prompt,
];

const focusInManager = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-testid=manager-column]') != null);

const focusInManagerTerminal = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-testid=manager-column] .terminal') != null);

/**
 * Runs `stty size` in a session until it gives `size`. A terminal's resize reaches its session up to
 * 33 ms later, so one asked at once can still give the size before.
 */
const expectSessionSize = (
  size: { rows: number; cols: number },
  send: (line: string) => Promise<void>,
  read: () => Promise<string>,
) =>
  expect
    .poll(async () => {
      await send('stty size');
      return read();
    })
    .toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));

/** What a tool answered: the JSON in its one text block. */
async function callTool(dataDir: string, name: string, args: Record<string, unknown>) {
  const { status, body } = await mcpCall(dataDir, 'tools/call', { name, arguments: args });
  expect(status).toBe(200);
  return JSON.parse(body!.result!.content![0].text);
}

test("the manager starts with the app in the main checkout, with Mainframe's tools allowed", async () => {
  const main = repo();
  const { app, page, dataDir } = await launchApp({}, main);
  await expect.poll(() => managerLaunches(dataDir)).toHaveLength(1);
  const [{ cwd, args }] = managerLaunches(dataDir);
  const { mcp, settings } = filesOf(dataDir);
  expect(realpathSync(cwd)).toBe(realpathSync(main));
  expect(args).toEqual([
    '-n', 'main-manager', '--session-id', expect.stringMatching(UUID), '--mcp-config', mcp, '--settings', settings,
    '--append-system-prompt', ROLE_PROMPT,
  ]);

  const { hooks, permissions } = JSON.parse(readFileSync(settings, 'utf8'));
  expect(permissions).toEqual({ allow: ['mcp__mainframe__list_sessions', 'mcp__mainframe__sync_todo'] });
  expect(hooks.SessionStart[0].hooks[0].command).toContain(join(managerDir(dataDir), 'session-start.json'));

  expect(statSync(mcp).mode & 0o777).toBe(0o600);
  const server = JSON.parse(readFileSync(mcp, 'utf8')).mcpServers.mainframe;
  expect(server).toEqual({
    type: 'http',
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
    headers: { Authorization: expect.stringMatching(/^Bearer [0-9a-f]{64}$/) },
    timeout: 360000,
  });
  // The token reaches the manager through the file alone.
  expect(args.join(' ')).not.toContain(server.headers.Authorization.slice('Bearer '.length));

  // It is no task.
  await expect.poll(() => managerScreen(page)).toContain('$');
  expect(launches(dataDir)).toEqual([]);
  await expect(page.getByTestId('task-card')).toHaveCount(0);
  expect(await ids(page)).toEqual([]);
  await app.close();
  expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).tasks).toEqual([]);
});

test("the manager's tools answer only with the token, and start_task starts a task that isn't selected", async () => {
  const { app, page, dataDir } = await launchApp();
  await expect.poll(() => managerScreen(page)).toContain('$');
  expect((await mcpCall(dataDir, 'tools/list', {}, { token: null })).status).toBe(401);
  expect((await mcpCall(dataDir, 'tools/list', {}, { token: 'not-the-token' })).status).toBe(401);
  const listed = await mcpCall(dataDir, 'tools/list', {});
  expect(listed.status).toBe(200);
  expect(listed.body!.result!.tools!.map((tool) => tool.name)).toEqual(['list_sessions', 'start_task', 'sync_todo']);

  // New task selects the task it starts; the manager's start leaves the selection, and the focus, where they are.
  const alpha = await startTask(page, 'Alpha');
  const { taskId } = await callTool(dataDir, 'start_task', { title: 'From the manager', brief: 'Say hi' });
  await expect(cardIn(page, 'working', taskId)).toBeVisible();
  await expect.poll(() => screen(page, taskId)).toContain('$');
  await expect(card(page, taskId)).toHaveAttribute('data-selected', 'false');
  await expect(card(page, alpha)).toHaveAttribute('data-selected', 'true');
  expect(await terminalHasFocus(page)).toBe(true);

  // What a session last reported, with its message, is what the manager reads.
  await sendLine(page, alpha, report('blocked:kind=permission:msg=YXBwcm92ZSBCYXNoOiBscw=='));
  await expect(cardIn(page, 'needs-you', alpha)).toHaveCount(1);
  const { sessions } = await callTool(dataDir, 'list_sessions', {});
  expect(sessions).toEqual([
    expect.objectContaining({ taskId: alpha, title: 'Alpha', running: true, state: 'blocked', msg: 'approve Bash: ls' }),
    expect.objectContaining({ taskId, title: 'From the manager', running: true, state: null }),
  ]);
  await app.close();
});

test("quitting resumes the manager's chat at the next start, carrying on a turn it was in", async () => {
  const first = await launchApp();
  const { dataDir } = first;
  await expect.poll(() => managerScreen(first.page)).toContain('$');
  // The echo comes after the report on the same stream, so its output shows once main has the report.
  await sendManagerLine(first.page, `${report('working')}; echo working-$((1+1))`);
  await expect.poll(() => managerScreen(first.page)).toContain('working-2');
  await first.app.close();
  const id = firstConversation(dataDir);

  const second = await launchApp({ MAINFRAME_DATA_DIR: dataDir });
  await expect.poll(() => managerLaunches(dataDir).length).toBe(2);
  expect(managerLaunches(dataDir)[1].args).toEqual(resumeArgs(dataDir, id, 'Continue where you left off.'));
  // The carry-on prompt takes, as it would once Claude works on it, and the turn ends before the quit.
  await expect.poll(() => managerScreen(second.page)).toContain('$');
  await sendManagerLine(second.page, `${report('working')}; ${report('idle')}; echo idle-$((1+1))`);
  await expect.poll(() => managerScreen(second.page)).toContain('idle-2');
  await second.app.close();

  const third = await launchApp({ MAINFRAME_DATA_DIR: dataDir });
  await expect.poll(() => managerLaunches(dataDir).length).toBe(3);
  expect(managerLaunches(dataDir)[2].args).toEqual(resumeArgs(dataDir, id));
  expect(launches(dataDir)).toEqual([]);
  await third.app.close();
});

test('a manager chat that Claude Code never saved is not resumed: the next start begins a new one', async () => {
  const first = await launchApp();
  const { dataDir } = first;
  await expect.poll(() => managerScreen(first.page)).toContain('$');
  // The fake saves its chat as it starts, naming the transcript in the file the hook writes; nobody typed to
  // this manager, so the real one would have saved nothing.
  const id = firstConversation(dataDir);
  const hookFile = join(managerDir(dataDir), 'session-start.json');
  await expect.poll(() => existsSync(hookFile) && readFileSync(hookFile, 'utf8')).toContain(`${id}.jsonl"}`);
  rmSync(JSON.parse(readFileSync(hookFile, 'utf8')).transcript_path);
  await first.app.close();

  const second = await launchApp({ MAINFRAME_DATA_DIR: dataDir });
  await expect.poll(() => managerLaunches(dataDir).length).toBe(2);
  const [{ args: began }, { args }] = managerLaunches(dataDir);
  // The first form again, under another id.
  expect(args).toEqual([...began.slice(0, 3), expect.stringMatching(UUID), ...began.slice(4)]);
  expect(args[3]).not.toBe(id);
  await expect.poll(() => managerScreen(second.page)).toContain('$');
  await expect(second.page.getByTestId('manager-restart')).toHaveCount(0);
  await expect(second.page.getByTestId('manager-column').getByText(STOPPED_NOTE)).toHaveCount(0);
  await second.app.close();
});

test('the manager never takes the focus by itself', async () => {
  const { app, page } = await launchApp();
  await expect.poll(() => managerScreen(page)).toContain('$');
  expect(await focusInManager(page)).toBe(false);

  const id = await startTask(page);
  await run(page, 'echo task-only');
  await expect.poll(() => screen(page, id)).toContain('task-only');
  expect(await managerScreen(page)).not.toContain('task-only');

  await page.getByTestId('manager-column').click();
  expect(await focusInManager(page)).toBe(true);
  await run(page, 'echo manager-only');
  await expect.poll(() => managerScreen(page)).toContain('manager-only');
  expect(await screen(page, id)).not.toContain('manager-only');
  await app.close();
});

test("the manager's terminal fits its column", async () => {
  const { app, page } = await launchApp();
  // Right of the project list, its full height 8 px in, and 400 px wide.
  const height = await page.evaluate(() => window.innerHeight);
  const rail = await box(page, 'project-rail');
  expect(await box(page, 'manager-column')).toEqual({ x: rail.x + rail.width + 8, y: 8, width: 400, height: height - 16 });

  await expect.poll(() => managerScreen(page)).toContain('$');
  await page.getByTestId('manager-column').click();
  const size = (await managerTermSize(page))!;
  await expectSessionSize(size, (line) => run(page, line), () => managerScreen(page));
  expect(await managerTermSize(page)).toEqual(size);
  await app.close();
});

// CDP clicks skip native drag regions, so this pins the styles; the owner checks the window buttons' padding.
test('the manager column sits left of the board, and its top strip holds the window buttons', async () => {
  const { app, page } = await launchApp();
  const column = await box(page, 'manager-column');
  expect(column.x + column.width).toBeLessThanOrEqual((await box(page, 'board')).x);

  const strip = page.getByTestId('manager-title-bar');
  expect(await strip.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag');
  expect((await strip.boundingBox())!.height).toBe(46);
  // What takes clicks over the strip: a no-drag element after it in the page, as macOS carves them
  // out of it in that order. None starts within its first 90 px, where the window buttons are. Over
  // it by a pixel or more: the text in the row under it reaches a tenth of one up into it.
  const starts = await strip.evaluate((bar) => {
    const s = bar.getBoundingClientRect();
    return [...document.querySelectorAll('*')]
      .filter((el) => bar.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      .filter((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag')
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.left < s.right && s.left < r.right && r.top <= s.bottom - 1 && s.top <= r.bottom - 1)
      .map((r) => r.left - s.left);
  });
  expect(Math.min(...starts)).toBeGreaterThanOrEqual(90);

  // The board's top bar no longer makes room for them.
  expect(await page.locator('.topbar').evaluate((el) => getComputedStyle(el).paddingLeft)).not.toBe('90px');
  // A drag region takes no pointer events, so the project chip is carved out of the top bar's, for its folder to show
  // on hover.
  expect(await page.locator('.tb-project').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  await app.close();
});

test("the manager's arrow puts it away, and the pill at the pane's left edge brings it back", async () => {
  const { app, page } = await launchApp();
  await expect.poll(() => managerScreen(page)).toContain('$');
  const column = page.getByTestId('manager-column');
  const toggle = page.getByTestId('manager-toggle');
  const show = page.getByTestId('manager-show');
  await expect(column).toHaveAttribute('data-pinned', 'true');
  await expect(show).toBeHidden();
  const pinned = await box(page, 'manager-column');

  await page.getByTestId('manager-hide').click();
  await expect(column).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Pinned, it gives its room back to the board.
  expect((await box(page, 'board')).x).toBeLessThan(pinned.x + 100);
  await expect(show).toBeFocused();
  expect(Math.abs((await box(page, 'manager-show')).x - (await box(page, 'project-pane')).x)).toBeLessThanOrEqual(1);

  await show.click();
  await expect(column).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('manager-hide')).toBeFocused();
  await expect(show).toBeHidden();
  await app.close();
});

test('unpinned, the manager floats over the board under its top bar, a press on the board puts it away, and hidden and shown, its terminal keeps its size', async () => {
  const first = await launchApp();
  const { page, dataDir } = first;
  // Room on the board right of the floating column.
  await setWindowWidth(first.app, page, 1600);
  await expect.poll(() => managerScreen(page)).toContain('$');
  const size = (await managerTermSize(page))!;
  const column = page.getByTestId('manager-column');
  const pin = page.getByTestId('manager-pin');

  await pin.click();
  await expect(column).toHaveAttribute('data-pinned', 'false');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await expect(column).toHaveAttribute('data-open', 'true');
  // Over the board, which starts under it, and under the board's top bar, whose Manager button stays in reach.
  const floating = await box(page, 'manager-column');
  const board = await box(page, 'board');
  expect(board.x).toBeLessThan(floating.x + floating.width);
  expect(await isOnTop(page.getByTestId('manager-toggle'))).toBe(true);
  // Shorter than pinned by the top bar, its terminal loses rows, never columns.
  await expect.poll(async () => (await managerTermSize(page))!.rows).toBeLessThan(size.rows);
  const floatingSize = (await managerTermSize(page))!;
  expect(floatingSize.cols).toBe(size.cols);

  // The bottom of the board, right of the column.
  await page.getByTestId('board').click({ position: { x: floating.x + floating.width - board.x + 40, y: board.height - 40 } });
  await expect(column).toHaveAttribute('data-open', 'false');
  await expect(column).toBeHidden();
  // A hidden manager that comes to need the owner shows from its way back.
  const show = page.getByTestId('manager-show');
  await sendManagerLine(page, report('blocked:kind=question'));
  await expect(show.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'ask');
  await expect(show).toHaveAccessibleName('Show manager, Needs input');

  await show.click();
  await expect(column).toBeVisible();
  await expect(page.getByTestId('manager-hide')).toBeFocused();
  await page.getByTestId('manager-hide').click();
  await expect(column).toBeHidden();
  await expect(show).toBeFocused();
  expect(await managerTermSize(page)).toEqual(floatingSize);
  await expectSessionSize(floatingSize, (line) => sendManagerLine(page, line), () => managerScreen(page));
  await first.app.close();

  // The pin is the project's, kept for the next start.
  const { app, page: again } = await launchApp({ MAINFRAME_DATA_DIR: dataDir });
  await expect(again.getByTestId('manager-column')).toHaveAttribute('data-pinned', 'false');
  await app.close();
});

test('Ctrl+Tab skips the manager', async () => {
  const { app, page, dataDir } = await launchApp();
  await expect.poll(() => managerScreen(page)).toContain('$');
  // A task at work and not selected: the manager's start leaves the selection as it is.
  const { taskId } = await callTool(dataDir, 'start_task', { title: 'At work', brief: 'Say hi' });
  await expect(cardIn(page, 'working', taskId)).toBeVisible();

  const column = page.getByTestId('manager-column');
  await column.click();
  await run(page, report('blocked:kind=question'));
  await expect(page.getByTestId('manager-state')).toHaveText('Needs input');
  await expect(column.getByTestId('task-glyph')).toHaveAttribute('data-glyph', 'ask');

  // Nothing on the board needs the owner, and the manager is no stop on the way.
  await page.keyboard.press('Control+Tab');
  await expect(card(page, taskId)).toHaveAttribute('data-selected', 'false');
  await expect(page.getByTestId('panel-title')).toHaveCount(0);
  expect(await focusInManagerTerminal(page)).toBe(true);
  await expect(page.getByTestId('manager-state')).toHaveText('Needs input');
  await app.close();
});

test("Restart continues the manager's chat after it exits", async () => {
  const { app, page, dataDir } = await launchApp();
  await expect.poll(() => managerScreen(page)).toContain('$');
  const column = page.getByTestId('manager-column');
  const restart = page.getByTestId('manager-restart');
  await expect(restart).toHaveCount(0);
  await expect(page.getByTestId('manager-title')).toHaveText('Manager');

  await column.click();
  await run(page, 'exit');
  await expect(restart).toBeVisible();
  await expect(column.getByText(STOPPED_NOTE)).toBeVisible();
  // Its last output stays on screen.
  await expect.poll(() => managerScreen(page)).toContain('[Process exited]');

  await restart.click();
  await expect.poll(() => managerLaunches(dataDir).length).toBe(2);
  expect(managerLaunches(dataDir)[1].args).toEqual(resumeArgs(dataDir, firstConversation(dataDir)));
  await expect(restart).toHaveCount(0);
  await expect(column.getByText(STOPPED_NOTE)).toHaveCount(0);
  // The owner's click was on Restart: the new terminal has the focus, and what is typed reaches it.
  await expect.poll(() => focusInManagerTerminal(page)).toBe(true);
  await expect.poll(() => managerScreen(page)).toContain('$');
  await run(page, 'echo restarted-$((1+1))');
  await expect.poll(() => managerScreen(page)).toContain('restarted-2');
  await app.close();
});

test('a Restart that fails shows why', async () => {
  const { app, page, dataDir } = await launchApp();
  await expect.poll(() => managerScreen(page)).toContain('$');
  await sendManagerLine(page, 'exit');
  const restart = page.getByTestId('manager-restart');
  await expect(restart).toBeVisible();

  // As a newer Mainframe would leave it.
  const record = join(managerDir(dataDir), 'manager.json');
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), version: 2 }));
  await restart.click();
  const column = page.getByTestId('manager-column');
  await expect(column.getByRole('alert')).toHaveText(/^The manager's record .+ was written by a newer Mainframe/);
  await expect(column.getByText(STOPPED_NOTE)).toBeVisible();
  expect(managerLaunches(dataDir)).toHaveLength(1);
  await app.close();
});

// Review Focus 5: the window is narrow with the column and the pinned session panel both showing.
test("dragging the manager's edge resizes it, keeps the width, and its terminal fits", async () => {
  const first = await launchApp();
  const { page, dataDir } = first;
  await setWindowWidth(first.app, page, 1600);
  const id = await startTask(page);
  await expect.poll(() => managerScreen(page)).toContain('$');
  const before = { manager: (await managerTermSize(page))!, task: (await termSize(page, id))! };

  const handle = page.getByTestId('manager-resize');
  const edge = await box(page, 'manager-resize');
  const x = edge.x + edge.width / 2;
  // Above the hide pill, which sits on the edge's middle.
  const y = edge.y + edge.height / 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 8 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '480');
  // The arrow keys move the edge too: right widens.
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '496');
  expect((await box(page, 'manager-column')).width).toBe(496);

  // The pinned session panel gives up what the column took: its clamp leaves the board 360 px of the
  // project's pane less the column's width (the column's margin comes on top, so the board itself gets less).
  const paneWidth = (await box(page, 'project-pane')).width;
  await expect(page.getByTestId('panel-resize')).toHaveAttribute('aria-valuenow', String(paneWidth - 496 - 360));

  // Both terminals fit what they show now, and their sessions come to that size.
  await settled(page);
  const manager = (await managerTermSize(page))!;
  const task = (await termSize(page, id))!;
  expect(manager.cols).toBeGreaterThan(before.manager.cols);
  expect(task.cols).toBeLessThan(before.task.cols);
  await expectSessionSize(manager, (line) => sendManagerLine(page, line), () => managerScreen(page));
  await expectSessionSize(task, (line) => sendLine(page, id, line), () => screen(page, id));
  await first.app.close();

  const { app, page: again } = await launchApp({ MAINFRAME_DATA_DIR: dataDir });
  await setWindowWidth(app, again, 1600);
  await expect(again.getByTestId('manager-resize')).toHaveAttribute('aria-valuenow', '496');
  expect((await box(again, 'manager-column')).width).toBe(496);
  await app.close();
});
