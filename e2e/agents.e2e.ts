import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { ADAPTERS } from '../src/main/agents/adapters';
import { rolePrompt } from '../src/main/manager/rolePrompt';
import type { AppSettings } from '../src/main/setup/settings';
import { cleanUp, fakeOpencode, launchApp, launchWithOpencode } from './launch';
import {
  answerDialogs, card, computer, envOf, fakeLogDir, helperCalls, managerLaunches, mcpCall, opencodeSyncReply, projectPane, railRow, repo,
  rowButton, savedSettings, screen, SESSION_ID, startTask, syncLaunches,
} from './tasks';

test.afterEach(cleanUp);

const ON_OPENCODE: AppSettings = { welcomeSeen: true, defaultAgent: 'opencode' };

/** The OPENCODE_CONFIG_CONTENT a launch was given, parsed. */
const configOf = (launch: { file: string }) => JSON.parse(envOf(launch).OPENCODE_CONFIG_CONTENT);

/** The first sync answers with the connector and its tool that only reads, named as OpenCode names a connector's tools. */
const TOOLS = { kind: 'tools', connector: 'Tracker', readTools: ['tracker_get_list'] };

const CARDS = {
  kind: 'cards',
  source: { kind: 'Tracker', board: 'Shop', list: 'To do', url: 'https://tracker.example/shop/to-do' },
  cards: [
    { id: 'c128', number: '#128', title: 'Search ignores accents', description: '', labels: [], checklists: [], url: null, forOwner: false, urgent: false },
    { id: 'c131', number: '#131', title: 'Export drops the last row', description: '', labels: [], checklists: [], url: null, forOwner: false, urgent: false },
  ],
};

const SECRETS = ['sk-fake-secret', 'fake-agent-secret'];

/** Neither secret of the stand-in's lists is in the page as it shows now, or in settings.json. */
async function expectNoSecretIn(page: Page, dataDir: string): Promise<void> {
  const saved = readFileSync(join(dataDir, 'settings.json'), 'utf8');
  const content = await page.content();
  for (const secret of SECRETS) {
    expect(saved).not.toContain(secret);
    expect(content).not.toContain(secret);
  }
}

const openSettings = async (page: Page) => {
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
};

test('a first start with only OpenCode chooses it and opens a project', async () => {
  const pc = computer();
  const project = repo();
  const { app, page, dataDir } = await launchApp({ ...pc.env, MAINFRAME_OPENCODE_BIN: fakeOpencode }, undefined, { firstStart: true });

  const claude = page.getByTestId('setup-claude');
  await expect(claude).toHaveAttribute('data-state', 'missing');
  await expect(claude).not.toContainText('✗');
  // Claude Code's row in the agents step offers its install link.
  const claudeRow = page.locator('.setup-agent').filter({ has: page.getByTestId('setup-tick-claude') });
  await expect(claudeRow.getByTestId('setup-install-claude')).toBeVisible();
  await expect(page.getByTestId('setup-tick-opencode')).toBeChecked();
  await expect(page.getByTestId('setup-tick-claude')).toBeDisabled();
  await expect(page.getByTestId('setup-default-opencode')).toHaveCount(0);
  await expect(
    page.getByText('OpenCode runs everything: the manager, the Todo sync and your tasks. Settings can change this later.', { exact: true }),
  ).toBeVisible();

  await answerDialogs(app, project);
  await page.getByTestId('setup-choose-project').click();

  await expect(projectPane(page, project)).toHaveAttribute('data-shown', 'true');
  expect(savedSettings(dataDir)).toEqual({ welcomeSeen: true, defaultAgent: 'opencode', agents: { opencode: { enabled: true } } });
  await expect.poll(() => managerLaunches(dataDir)[0]?.args.slice(0, 2)).toEqual(['--standalone', '-s']);
  await app.close();
});

test('a later start whose ticked agent is gone offers Use OpenCode, which switches it on and starts', async () => {
  const pc = computer();
  const project = repo();
  const settings: AppSettings = { welcomeSeen: true, defaultAgent: 'claude', agents: { claude: { enabled: true }, opencode: { enabled: false } } };
  const { app, page, dataDir } = await launchApp({ ...pc.env, MAINFRAME_OPENCODE_BIN: fakeOpencode }, project, { settings });

  await expect(page.getByText('Something moved since last time, so I had another look around.')).toBeVisible();
  await expect(page.getByTestId('setup')).toContainText("OpenCode is here, but it's switched off: I can use it instead.");
  await expect(page.getByTestId('setup-use-opencode')).toHaveText('Use OpenCode');
  await page.getByTestId('setup-use-opencode').click();

  await expect(projectPane(page, project)).toHaveAttribute('data-shown', 'true');
  expect(savedSettings(dataDir)).toEqual({ welcomeSeen: true, defaultAgent: 'opencode', agents: { claude: { enabled: true }, opencode: { enabled: true } } });
  await expect.poll(() => managerLaunches(dataDir)[0]?.args.slice(0, 2)).toEqual(['--standalone', '-s']);
  await app.close();
});

test('a first start with both agents asks which is the default, and runs everything on the one picked', async () => {
  const pc = computer();
  const claude = pc.installClaude();
  const project = repo();
  const { app, page, dataDir } = await launchApp({ ...pc.env, MAINFRAME_OPENCODE_BIN: fakeOpencode }, undefined, { firstStart: true });

  await expect(page.getByTestId('setup-tick-claude')).toBeChecked();
  await expect(page.getByTestId('setup-tick-opencode')).toBeChecked();
  // Claude Code is first wherever a choice starts.
  await expect(page.getByTestId('setup-default-claude')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('setup-default-opencode')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('setup-default-opencode').click();
  await expect(page.getByTestId('setup-default-opencode')).toHaveAttribute('aria-checked', 'true');

  await answerDialogs(app, project);
  await page.getByTestId('setup-choose-project').click();

  await expect(projectPane(page, project)).toHaveAttribute('data-shown', 'true');
  expect(savedSettings(dataDir)).toEqual({
    welcomeSeen: true,
    defaultAgent: 'opencode',
    agents: { claude: { enabled: true, bin: claude }, opencode: { enabled: true } },
  });
  await expect.poll(() => managerLaunches(dataDir)[0]?.args.slice(0, 2)).toEqual(['--standalone', '-s']);
  await app.close();
});

test("the manager starts on OpenCode with Mainframe's server, its rules and its role prompt", async () => {
  const main = repo();
  const first = await launchWithOpencode(main, {}, ON_OPENCODE);
  const { dataDir } = first;
  // On the arguments: the stand-in creates its file before it writes them.
  await expect.poll(() => managerLaunches(dataDir)[0]?.args.length).toBe(3);
  const [launch] = managerLaunches(dataDir);
  expect(launch.args).toEqual(['--standalone', '-s', expect.stringMatching(SESSION_ID)]);
  expect(realpathSync(launch.cwd)).toBe(realpathSync(main));

  const config = configOf(launch);
  const server = config.mcp.servers.mainframe;
  expect(server).toEqual({
    type: 'remote',
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
    headers: { Authorization: expect.stringMatching(/^Bearer [0-9a-f]{64}$/) },
    oauth: false,
  });
  const rules = [
    { action: 'mainframe_list_sessions', resource: '*', effect: 'allow' },
    { action: 'mainframe_sync_todo', resource: '*', effect: 'allow' },
    { action: 'mainframe_start_task', resource: '*', effect: 'ask' },
  ];
  // At the top and under every agent `api agent.list` gives, as the chat may run on any of them.
  expect(config.permissions).toEqual(rules);
  expect(config.agents).toEqual({ build: { permissions: rules }, plan: { permissions: rules }, general: { permissions: rules } });
  expect(readFileSync(config.instructions[0], 'utf8')).toBe(rolePrompt(ADAPTERS.opencode.instructions));

  const listed = await mcpCall(dataDir, 'tools/call', { name: 'list_sessions', arguments: {} }, { server });
  expect(listed.status).toBe(200);
  await first.app.close();

  // A new start carries the same chat on.
  const second = await launchWithOpencode(main, { MAINFRAME_DATA_DIR: dataDir }, ON_OPENCODE);
  await expect.poll(() => managerLaunches(dataDir)[1]?.args[2]).toBe(launch.args[2]);
  expect(managerLaunches(dataDir)[1].args.slice(0, 2)).toEqual(['--standalone', '-s']);
  await second.app.close();
});

test('a sync on OpenCode asks for a model, finds the connector, and reads the list with only the confirmed tools', async () => {
  const { app, page, dataDir } = await launchWithOpencode(repo(), {}, ON_OPENCODE);
  const panel = page.getByTestId('todo-panel');
  await page.getByTestId('todo-toggle').click();
  await page.getByTestId('todo-sync').click();

  const models = panel.getByTestId('todo-model');
  // Each row names its model and, quieter, the provider's id that tells two alike apart.
  await expect(models).toHaveText([/Cheap model.*prov\/cheap/, /Dear model/, /price unknown/]);
  await expect(models.first()).toHaveAttribute('aria-checked', 'true');
  // The rows came from `api model.list`, whose cheap model carries a key.
  expect(helperCalls(dataDir).map((call) => call.args)).toContainEqual(['--standalone', 'api', 'model.list']);
  await expectNoSecretIn(page, dataDir);

  opencodeSyncReply(dataDir, TOOLS);
  await panel.getByTestId('todo-pick-model').click();
  await expect(panel.getByTestId('todo-confirm-tools')).toBeVisible();

  const [discover] = syncLaunches(dataDir);
  expect(discover.args).toEqual(['run', '--standalone', '--format', 'json', '--agent', 'mainframe-sync', '--title', 'sync', '--archived', '-m', 'prov/cheap']);
  const env = envOf(discover);
  // The stand-in records its folder as the system resolves it.
  expect(realpathSync(discover.cwd)).toBe(realpathSync(env.PWD));
  expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
  expect(configOf(discover).permissions[0]).toEqual({ action: '*', resource: '*', effect: 'ask' });

  opencodeSyncReply(dataDir, CARDS);
  await panel.getByTestId('todo-confirm-tools').click();
  await expect(panel.getByTestId('todo-item')).toHaveCount(CARDS.cards.length);
  const read = syncLaunches(dataDir)[1];
  expect(read.args).toEqual(discover.args);
  const readRules = [
    { action: '*', resource: '*', effect: 'deny' },
    { action: 'tracker_get_list', resource: '*', effect: 'allow' },
  ];
  expect(configOf(read).permissions).toEqual(readRules);
  expect(configOf(read).agents['mainframe-sync'].permissions).toEqual(readRules);

  await expect.poll(() => helperCalls(dataDir).map((call) => call.args)).toContainEqual(['--standalone', 'session', 'delete', 'ses_fake']);
  expect(savedSettings(dataDir).agents?.opencode?.syncModel).toBe('prov/cheap');
  await expectNoSecretIn(page, dataDir);

  // Settings lists OpenCode's agents and models, from `api agent.list` (whose build agent carries a header) and `api model.list`.
  const calls = helperCalls(dataDir).length;
  await openSettings(page);
  await expect(page.getByTestId('settings-manager-agent').locator('option')).toHaveText([/build/, 'build', 'plan']);
  await expect(page.getByTestId('settings-manager-agent-hint')).toHaveText(
    "A new manager chat starts on this agent. A chat that carries on keeps its agent until you switch it in the manager's terminal.",
  );
  await expect(page.getByTestId('settings-sync-model').locator('option')).toHaveCount(3);
  await expect(page.getByTestId('settings-sync-model').locator('option').first()).toHaveText(/^Cheap model, prov\/cheap \(/);
  expect(helperCalls(dataDir).slice(calls).map((call) => call.args)).toEqual(
    expect.arrayContaining([['--standalone', 'api', 'agent.list'], ['--standalone', 'api', 'model.list']]),
  );
  await expectNoSecretIn(page, dataDir);
  await app.close();
});

test("with a long model list, the model ask's button stays in the window", async () => {
  const { app, page, dataDir } = await launchWithOpencode(repo(), {}, ON_OPENCODE);
  const price = (input: number) => [{ input, output: input * 5, cache: { read: 0, write: 0 } }];
  const data = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`, modelID: `m${i}`, providerID: 'prov', name: `Model ${i}`, capabilities: {}, variants: [], time: { released: 1 },
    status: 'active', enabled: true, limit: { context: 1, output: 1 }, cost: price(i + 1),
  }));
  writeFileSync(join(fakeLogDir(dataDir), 'opencode-model.list.json'), JSON.stringify({ location: { directory: '/' }, data }));

  await page.getByTestId('todo-toggle').click();
  await page.getByTestId('todo-sync').click();
  const panel = page.getByTestId('todo-panel');
  await expect(panel.getByTestId('todo-model')).toHaveCount(40);
  await expect(panel.getByTestId('todo-pick-model')).toBeInViewport({ ratio: 1 });
  // The list scrolls inside the ask: its last model can be picked too.
  await panel.getByTestId('todo-model').last().click();
  await expect(panel.getByTestId('todo-model').last()).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByTestId('todo-pick-model')).toBeInViewport({ ratio: 1 });
  await app.close();
});

test('Settings switches the default agent from the cog, and the New task box follows', async () => {
  const [acme, globex] = [repo(), repo()];
  const { app, page, dataDir } = await launchWithOpencode([acme, globex]);
  await (await rowButton(page, globex, 'rail-beside')).click();
  await expect(projectPane(page, globex)).toHaveAttribute('data-shown', 'true');

  // One cog for the window, at the end of the last pane's part of the top row.
  await expect(page.getByTestId('settings-open')).toHaveCount(1);
  await expect(projectPane(page, globex).getByTestId('project-bar').getByTestId('settings-open')).toHaveCount(1);

  await expect.poll(() => managerLaunches(dataDir).length).toBe(2);
  await openSettings(page);
  // Chosen from the keyboard, the radio keeps the focus when its own save comes back.
  await page.getByTestId('settings-default-opencode').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('settings-default-opencode')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-default-opencode')).toBeFocused();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
  await expect.poll(() => savedSettings(dataDir).defaultAgent).toBe('opencode');

  // Each project's next task starts on the new default.
  for (const dir of [acme, globex]) {
    await projectPane(page, dir).getByTestId('new-task').click();
    await expect(page.getByTestId('new-task-agent-opencode')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-task-agent-opencode')).toHaveCount(0);
  }
  // Each manager switches only at its own next start.
  expect(managerLaunches(dataDir)).toHaveLength(2);
  await app.close();
});

test('Settings lets a stand-in become the default', async () => {
  // OpenCode is the saved default but isn't there, so Claude Code stands in.
  const settings: AppSettings = { welcomeSeen: true, defaultAgent: 'opencode', agents: { claude: { enabled: true }, opencode: { enabled: true } } };
  const { app, page, dataDir } = await launchApp({}, repo(), { settings });
  await expect(page.getByTestId('default-fallback')).toBeVisible();

  await openSettings(page);
  await expect(page.getByTestId('settings-default-opencode')).toBeDisabled();
  await expect(page.getByTestId('settings-default-claude')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('settings-default-claude').click();
  // With nothing standing in and only one agent working, there is no choice left to show.
  await expect(page.getByTestId('settings-default-claude')).toHaveCount(0);
  await expect(page.getByTestId('default-fallback')).toHaveCount(0);
  await expect.poll(() => savedSettings(dataDir).defaultAgent).toBe('claude');
  await app.close();
});

test('with no project open the cog still opens Settings', async () => {
  const project = repo();
  const { app, page } = await launchApp({}, project);
  await (await rowButton(page, project, 'rail-close')).click();
  await railRow(page, project).getByTestId('rail-close-confirm').click();
  await expect(page.getByTestId('rail-project')).toHaveCount(0);

  await openSettings(page);
  await app.close();
});

test('Ctrl+, opens Settings over a focused terminal', async () => {
  const { app, page } = await launchApp();
  if (process.platform === 'darwin') {
    // The Mac's ⌘, is the menu's, which keys pressed in the page never reach.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('settings')!.click());
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await app.close();
    return;
  }
  const id = await startTask(page, 'Alpha');
  await page.keyboard.type('ech');
  await expect.poll(() => screen(page, id)).toMatch(/\$ ech *$/m);

  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await page.getByTestId('settings-close').click();

  // A comma that had reached the shell would have made the command `ech,`.
  await card(page, id).click();
  await expect(card(page, id)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => screen(page, id)).toContain('ech: command not found');
  await app.close();
});
