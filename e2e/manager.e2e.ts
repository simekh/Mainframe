import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { ROLE_PROMPT } from '../src/main/manager/rolePrompt';
import { cleanUp, launchApp } from './launch';
import {
  card, cardIn, ids, launches, managerDir, managerLaunches, managerScreen, managerTermSize, mcpCall, report, repo, run,
  screen, sendLine, sendManagerLine, startTask,
} from './tasks';

test.afterEach(cleanUp);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/** What a tool answered: the JSON in its one text block. */
async function callTool(dataDir: string, name: string, args: Record<string, unknown>) {
  const { status, body } = await mcpCall(dataDir, 'tools/call', { name, arguments: args });
  expect(status).toBe(200);
  return JSON.parse(body!.result!.content![0].text);
}

test("the manager starts with the app in the main checkout, with Mainframe's tools allowed", async () => {
  const main = repo();
  const { app, page, dataDir } = await launchApp({ MAINFRAME_PROJECT_DIR: main });
  await expect.poll(() => managerLaunches(dataDir)).toHaveLength(1);
  const [{ cwd, args }] = managerLaunches(dataDir);
  const { mcp, settings } = filesOf(dataDir);
  expect(realpathSync(cwd)).toBe(realpathSync(main));
  expect(args).toEqual([
    '-n', 'main-manager', '--session-id', expect.stringMatching(UUID), '--mcp-config', mcp, '--settings', settings,
    '--append-system-prompt', ROLE_PROMPT,
  ]);

  const { hooks, permissions } = JSON.parse(readFileSync(settings, 'utf8'));
  expect(permissions).toEqual({ allow: ['mcp__mainframe__*'] });
  expect(hooks.SessionStart[0].hooks[0].command).toContain(join(managerDir(dataDir), 'session-start.json'));

  expect(statSync(mcp).mode & 0o777).toBe(0o600);
  const server = JSON.parse(readFileSync(mcp, 'utf8')).mcpServers.mainframe;
  expect(server).toEqual({
    type: 'http',
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
    headers: { Authorization: expect.stringMatching(/^Bearer [0-9a-f]{64}$/) },
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
  expect(listed.body!.result!.tools!.map((tool) => tool.name)).toEqual(['list_sessions', 'start_task']);

  // New task selects the task it starts; the manager's start leaves the selection, and the focus, where they are.
  const alpha = await startTask(page, 'Alpha');
  const { taskId } = await callTool(dataDir, 'start_task', { title: 'From the manager', brief: 'Say hi' });
  await expect(cardIn(page, 'working', taskId)).toBeVisible();
  await expect.poll(() => screen(page, taskId)).toContain('$');
  await expect(card(page, taskId)).toHaveAttribute('data-selected', 'false');
  await expect(card(page, alpha)).toHaveAttribute('data-selected', 'true');
  expect(await page.evaluate(() => document.activeElement?.closest('.well > .terminal:not(.terminal--hidden)') != null)).toBe(
    true,
  );

  // What a session last reported, with its message, is what the manager reads.
  await sendLine(page, alpha, "printf '\\033]7501;state=blocked:kind=permission:msg=YXBwcm92ZSBCYXNoOiBscw==\\033\\\\'");
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
  const [started] = managerLaunches(dataDir);
  const id = started.args[started.args.indexOf('--session-id') + 1];

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
  // At the window's left, its full height and 400 px wide.
  const height = await page.evaluate(() => window.innerHeight);
  expect(await page.getByTestId('manager-column').boundingBox()).toEqual({ x: 0, y: 0, width: 400, height });

  await expect.poll(() => managerScreen(page)).toContain('$');
  await page.getByTestId('manager-column').click();
  const size = (await managerTermSize(page))!;
  await run(page, 'stty size');
  await expect.poll(() => managerScreen(page)).toMatch(new RegExp(`^${size.rows} ${size.cols}$`, 'm'));
  expect(await managerTermSize(page)).toEqual(size);
  await app.close();
});
