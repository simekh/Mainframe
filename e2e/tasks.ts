import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { findExecutable, pathKey } from '../src/main/pty/findExecutable';
import { localFiles } from '../src/main/pty/sessionHost';
import { readSettings } from '../src/main/setup/settings';
import { isProcessRunning } from '../src/main/testing/isProcessRunning';
import { makeRepo } from '../src/main/testing/makeRepo';
import { STRIP_WIDTH } from '../src/renderer/src/panel/panelPrefs';
import { fakeClaude, removeAfterTest } from './launch';

/** A repo from `makeRepo()` that is removed after the test; returns its main checkout. */
export function repo(): string {
  const { main } = makeRepo();
  removeAfterTest(dirname(main));
  return main;
}

/** A repo from `repo()` one commit ahead of its origin, which the start check warns of; removed after the test. */
export function repoAhead(): string {
  const main = repo();
  writeFileSync(join(main, 'local.txt'), 'local\n');
  git('-C', main, 'add', 'local.txt');
  git('-C', main, 'commit', '-m', 'local');
  return main;
}

export function git(...args: string[]): void {
  execFileSync('git', args, { stdio: 'pipe' });
}

export const ids = (page: Page) => page.evaluate(() => window.__mainframeE2E.taskIds());

export const screen = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__mainframeE2E.screenText(id), taskId);

export const termSize = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__mainframeE2E.termSize(id), taskId);

/** The size the task's session was first spawned at. */
export const firstSpawn = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__mainframeE2E.firstSpawn(id), taskId);

/** The size a fit of the task's terminal would give now: what fills its well with the renderer it has. */
export const fitSize = (page: Page, taskId: string) =>
  page.evaluate((id) => window.__mainframeE2E.fitSize(id), taskId);

/**
 * The look of each cell of the first place `text` shows on the task's screen, each distinct look
 * once: one entry when the text is styled alike throughout.
 */
export const styleOf = (page: Page, taskId: string, text: string) =>
  page.evaluate(
    ([id, wanted]) => {
      const hooks = window.__mainframeE2E;
      const lines = hooks.screenText(id).split('\n');
      const row = lines.findIndex((line) => line.includes(wanted));
      if (row < 0) throw new Error(`"${wanted}" is not on the screen`);
      const col = lines[row].indexOf(wanted);
      const looks = new Set<string>();
      for (let i = 0; i < wanted.length; i++) {
        const { fg, bold, underline } = hooks.cell(id, row, col + i)!;
        looks.add(JSON.stringify({ fg, bold, underline }));
      }
      return [...looks].map((look) => JSON.parse(look) as { fg: string; bold: boolean; underline: boolean });
    },
    [taskId, text] as const,
  );

export const card = (page: Page, taskId: string) => page.locator(`[data-testid=task-card][data-task-id="${taskId}"]`);

/** The task's card, found only inside the given lane of the board. */
export const cardIn = (page: Page, lane: 'needs-you' | 'working' | 'closed', taskId: string) =>
  page.locator(`[data-testid=lane][data-lane=${lane}] [data-testid=task-card][data-task-id="${taskId}"]`);

/** A project's pane, found by its folder. `JSON.stringify` quotes the folder, as a Windows path's backslashes need. */
export const projectPane = (page: Page, dir: string) =>
  page.locator(`[data-testid=project-pane][data-project=${JSON.stringify(dir)}]`);

/** A project's row in the list of open projects, found by its folder. */
export const railRow = (page: Page, dir: string) =>
  page.locator(`[data-testid=rail-project][data-project=${JSON.stringify(dir)}]`);

/** A row's own button in the list of open projects: the row's buttons show while the pointer is on it. */
export async function rowButton(page: Page, dir: string, testId: string): Promise<Locator> {
  await railRow(page, dir).hover();
  return railRow(page, dir).getByTestId(testId);
}

/** Takes the focused project's pane off screen: Cmd+W on the Mac, Ctrl+Shift+W on Windows and Linux. */
export const closePaneKey = process.platform === 'darwin' ? 'Meta+w' : 'Control+Shift+W';

/** Starts a task in the project through the bridge, on screen or not; resolves with its id once its prompt shows. */
export async function startIn(page: Page, dir: string, title: string): Promise<string> {
  const task = await page.evaluate(
    ([d, t]) => window.mainframe.startTask(d, { title: t, description: '', noQuestions: false }),
    [dir, title] as const,
  );
  await expect.poll(() => screen(page, task.id)).toContain('$');
  return task.id;
}

/** Two frames: a layout change has been measured and any fit it caused has run. */
export const settled = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

export const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

export const boxOf = async (locator: Locator) => (await locator.boundingBox())!;

type Box = { x: number; y: number; width: number; height: number };

/** A box's centre line. */
export const middle = (b: { y: number; height: number }) => b.y + b.height / 2;

/**
 * Expects the boxes left to right, each starting where the one before ends or after it (with `apart`, after it), and
 * on one centre line, within a pixel of the first's.
 */
export function expectInOneRow(boxes: Box[], { apart = false } = {}): void {
  for (let i = 1; i < boxes.length; i++) {
    const end = boxes[i - 1].x + boxes[i - 1].width;
    if (apart) expect(boxes[i].x).toBeGreaterThan(end);
    else expect(boxes[i].x).toBeGreaterThanOrEqual(end);
    expect(Math.abs(middle(boxes[i]) - middle(boxes[0]))).toBeLessThanOrEqual(1);
  }
}

/** Expects a folded panel's strip as wide as a strip is, its outer edge, on its `side`, within a pixel of `edge`. */
export function expectStripAt(strip: Box, side: 'left' | 'right', edge: number): void {
  expect(strip.width).toBe(STRIP_WIDTH);
  expect(Math.abs((side === 'left' ? strip.x : strip.x + strip.width) - edge)).toBeLessThanOrEqual(1);
}

export const appRegion = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'));

/** Drags the element's centre `dx` px sideways, in 8 steps. */
export async function dragBy(page: Page, testId: string, dx: number): Promise<void> {
  const b = await box(page, testId);
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

/** The row along the window's top: every panel and strip starts under it. */
export const ROW_HEIGHT = 46;

/** Whether `locator` is what shows at its own centre, not something laid over it. */
export const isOnTop = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });

/**
 * The island's left or right edge on every frame from now, while `act` folds or opens it, until it has stopped moving.
 * Each is read inside the page, so no frame is missed.
 */
export async function edgesWhile(page: Page, testId: string, edge: 'left' | 'right', act: () => Promise<void>): Promise<number[]> {
  type Probe = { slide: { edges: number[]; done: boolean } };
  await page.getByTestId(testId).evaluate((el, side) => {
    const slide: Probe['slide'] = { edges: [], done: false };
    (window as unknown as Probe).slide = slide;
    const from = el.getAttribute('data-open');
    const sample = () => {
      slide.edges.push(el.getBoundingClientRect()[side]);
      if (el.getAttribute('data-open') === from || el.getAnimations().length > 0) requestAnimationFrame(sample);
      else slide.done = true;
    };
    requestAnimationFrame(sample);
  }, edge);
  await act();
  await page.waitForFunction(() => (window as unknown as Probe).slide.done);
  return page.evaluate(() => (window as unknown as Probe).slide.edges);
}

/**
 * Expects the edges from `edgesWhile` to slide only `way`: on no frame does the edge step back by over half a pixel
 * from the frame before, or the first one from `from`. With `to`, it lands there, to the pixel.
 */
export function expectSlide(edges: number[], way: 'left' | 'right', { from = edges[0], to }: { from?: number; to?: number } = {}) {
  const backSteps = edges.filter((edge, i) => {
    const before = i ? edges[i - 1] : from;
    return way === 'left' ? edge > before + 0.5 : edge < before - 0.5;
  });
  expect(backSteps).toEqual([]);
  if (to !== undefined) expect(edges.at(-1)!).toBeCloseTo(to, 0);
}

/** Whether the focus is in the task's terminal on show, where typing goes. */
export const terminalHasFocus = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('.well > .terminal:not(.terminal--hidden)') != null);

export async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

/** Sends a line to the task's session through the bridge, so the focus can stay where it is. */
export async function sendLine(page: Page, taskId: string, line: string): Promise<void> {
  await page.evaluate(
    async ([id, data]) => {
      const projects = await window.mainframe.listProjects();
      const tasks = await Promise.all(projects.map((p) => window.mainframe.listTasks(p.dir)));
      const task = tasks.flat().find((t) => t.id === id);
      window.mainframe.write(task!.session!.id, data);
    },
    [taskId, `${line}\r`],
  );
}

/**
 * Sends `line` with `send`, after a lone Enter. Git Bash, the tests' shell on Windows, can notice a
 * resize under ConPTY only when its next key arrives, and then loses that key; it seems likelier
 * when the terminal isn't focused. A program that reads the terminal raw, as Claude Code does,
 * sees the resize at once and loses no key (terminal.e2e.ts). So a line that must arrive whole after
 * a resize goes after the Enter, for Git Bash to lose; otherwise the Enter shows one more prompt.
 */
export async function sendAfterResize(send: (line: string) => Promise<void>, line: string): Promise<void> {
  await send('');
  await send(line);
}

/** Starts a task through the New task dialog; resolves with its id once its shell prompt shows. */
export async function startTask(page: Page, title = 'Task', description = ''): Promise<string> {
  const before = await ids(page);
  await page.getByTestId('new-task').click();
  await page.getByTestId('new-task-title').fill(title);
  if (description) await page.getByTestId('new-task-description').fill(description);
  await page.getByTestId('new-task-start').click();
  const added = async () => (await ids(page)).filter((id) => !before.includes(id));
  await expect.poll(added).toHaveLength(1);
  const [id] = await added();
  await expect.poll(() => screen(page, id)).toContain('$');
  return id;
}

/** A shell command that reports `state` as Claude Code does, over OSC 7501. */
export const report = (state: string) => `printf '\\033]7501;state=${state}\\033\\\\'`;

/** Closes the task's session, as Close session in the panel does. */
export const closeTask = (page: Page, taskId: string) =>
  page.evaluate(async (id) => {
    for (const { dir } of await window.mainframe.listProjects()) {
      if ((await window.mainframe.listTasks(dir)).some((t) => t.id === id)) window.mainframe.closeTask(dir, id);
    }
  }, taskId);

/** Answers the file or folder dialog, which main looks up at each call: with `picked`, or null for a cancel. */
export function answerDialogs(app: ElectronApplication, picked: string | null): Promise<void> {
  return app.evaluate(({ dialog }, answer) => {
    const seen = globalThis as { dialogCalls?: number };
    seen.dialogCalls = 0;
    dialog.showOpenDialog = async () => {
      seen.dialogCalls! += 1;
      return answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [answer] };
    };
  }, picked);
}

/** The links the app was asked to open, oldest first. `launchApp` keeps them from the owner's browser. */
export const openedLinks = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { openedLinks?: string[] }).openedLinks ?? []);

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A session id as Mainframe makes one for OpenCode. */
export const SESSION_ID = /^ses_[0-9a-f]{28}$/;

/** The conversation a launch began. */
export const sessionIdOf = (args: string[]) => args[args.indexOf('--session-id') + 1];

const fakeLogDir = (dataDir: string) => join(dataDir, 'fake-claude');

/**
 * What `e2e/fake-claude.cjs` recorded of each launch in this data folder, oldest first: each launch's file,
 * `<pid>.argv`, with its working directory and its arguments.
 */
function allLaunches(dataDir: string): Array<{ file: string; cwd: string; args: string[] }> {
  const dir = fakeLogDir(dataDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.argv'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .map((file) => {
      const [cwd, ...args] = readFileSync(file, 'utf8').split('\0').slice(0, -1);
      return { file, cwd, args };
    });
}

type Launch = { file: string; args: string[] };

/** The environment the stand-in recorded for an OpenCode launch, beside its arguments: every OPENCODE_ variable, and PWD. */
export const envOf = (launch: { file: string }): Record<string, string> =>
  JSON.parse(readFileSync(launch.file.replace(/\.argv$/, '.env'), 'utf8'));

/** A sync is a `claude -p` or an `opencode run` run; sessions are interactive. */
const isSync = (launch: Launch) => launch.args[0] === '-p' || launch.args[0] === 'run';
/** OpenCode's commands that run to an end, after the `--standalone` every OpenCode launch passes: `api …` and `session …`. */
const isHelper = (launch: Launch) => launch.args[0] === '--standalone' && ['api', 'session'].includes(launch.args[1]);
/** Only the manager's launches carry a role prompt: Claude Code's as an argument, OpenCode's in a config that names Mainframe's server. */
const isManager = (launch: Launch) =>
  launch.args.includes('--append-system-prompt') ||
  (existsSync(launch.file.replace(/\.argv$/, '.env')) && (envOf(launch).OPENCODE_CONFIG_CONTENT ?? '').includes('"mcp"'));

/** The sessions' launches in this data folder, the manager's and the tasks', oldest first. */
export const sessionLaunches = (dataDir: string) => allLaunches(dataDir).filter((launch) => !isSync(launch) && !isHelper(launch));

/** OpenCode's `api …` and `session …` calls in this data folder, oldest first. */
export const helperCalls = (dataDir: string) => allLaunches(dataDir).filter(isHelper);

/** The tasks' launches in this data folder, oldest first: the manager, which starts with the app, and the syncs are left out. */
export const launches = (dataDir: string) => sessionLaunches(dataDir).filter((launch) => !isManager(launch));

/** The manager's launches in this data folder, oldest first. */
export const managerLaunches = (dataDir: string) => sessionLaunches(dataDir).filter(isManager);

/** The sync runs in this data folder, oldest first, each with the prompt it read on stdin. */
export const syncLaunches = (dataDir: string) =>
  allLaunches(dataDir)
    .filter(isSync)
    .map((launch) => ({ ...launch, stdin: readFileSync(launch.file.replace(/\.argv$/, '.stdin'), 'utf8') }));

/** What the next sync runs print: `answer` as their structured output, as `claude -p` prints it. */
export function syncReply(dataDir: string, answer: unknown): void {
  const printed = { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: answer };
  writeFileSync(join(fakeLogDir(dataDir), 'sync-reply.json'), JSON.stringify(printed));
}

/**
 * What the next OpenCode sync runs print: `opencode run --format json`'s events for one message that stopped, whose
 * text is `answer` as JSON, in session `ses_fake`.
 */
export function opencodeSyncReply(dataDir: string, answer: unknown): void {
  const sessionID = 'ses_fake';
  const event = (type: string, part: object) =>
    JSON.stringify({ type, timestamp: 1, sessionID, part: { id: 'p', sessionID, messageID: 'msg_fake', ...part } });
  const events = [
    event('text', { type: 'text', text: JSON.stringify(answer) }),
    event('step_finish', { type: 'step-finish', reason: 'stop', cost: 0, tokens: {} }),
  ];
  writeFileSync(join(fakeLogDir(dataDir), 'sync-reply.json'), `${events.join('\n')}\n`);
}

/** From now until `releaseSyncs`, a sync run waits without replying, until it is stopped. */
export const holdSyncs = (dataDir: string) => writeFileSync(join(fakeLogDir(dataDir), 'sync-hold'), '');

export const releaseSyncs = (dataDir: string) => rmSync(join(fakeLogDir(dataDir), 'sync-hold'), { force: true });

/** The sync runs' files that end in `ext`, each named `<pid><ext>`. */
const syncMarks = (dataDir: string, ext: string) => readdirSync(fakeLogDir(dataDir)).filter((name) => name.endsWith(ext));

/** How many sync runs are waiting, held. Stopping one before it waits could find it before it can record the stop. */
export const heldSyncs = (dataDir: string) => syncMarks(dataDir, '.holding').length;

/**
 * How many sync runs were stopped. Mainframe stops one with SIGTERM, which the run records. Windows
 * can't run a handler when a process is stopped, so there it counts the held runs whose process has
 * gone: a held run ends only by a stop or a release.
 */
export const stoppedSyncs = (dataDir: string) =>
  process.platform === 'win32'
    ? syncMarks(dataDir, '.holding').filter((name) => !isProcessRunning(Number.parseInt(name, 10))).length
    : syncMarks(dataDir, '.sigterm').length;

/** The Todo folder in this data folder, where an e2e run's one synced project keeps its list and the sync's settings. */
export function todoDir(dataDir: string): string {
  const [key] = readdirSync(join(dataDir, 'todo'));
  return join(dataDir, 'todo', key);
}

/** The manager's folder in this data folder, where an e2e run's one project has its manager. */
export function managerDir(dataDir: string): string {
  const [key] = readdirSync(join(dataDir, 'managers'));
  return join(dataDir, 'managers', key);
}

export const managerScreen = (page: Page) => page.evaluate(() => window.__mainframeE2E.managerScreen());

export const managerTermSize = (page: Page) => page.evaluate(() => window.__mainframeE2E.managerTermSize());

/** Sends a line to the first open project's manager session through the bridge, so the focus can stay where it is. */
export async function sendManagerLine(page: Page, line: string): Promise<void> {
  await page.evaluate(async (data) => {
    const [{ dir }] = await window.mainframe.listProjects();
    const { session } = await window.mainframe.getManager(dir);
    window.mainframe.write(session!.id, data);
  }, `${line}\r`);
}

/** A JSON-RPC response of Mainframe's MCP server: the parts of `tools/list` and `tools/call` results the tests read. */
interface McpResponse {
  result?: { tools?: Array<{ name: string }>; content?: Array<{ type: string; text: string }> };
}

/** Where Mainframe's MCP server is and the header that lets a client in, as a manager's config names them. */
type McpServer = { url: string; headers: { Authorization: string } };

/**
 * Posts one JSON-RPC request to Mainframe's MCP server, at the address in the manager's `mcp.json` (or `server`'s, as an
 * OpenCode manager's config names it) and with its token, another one, or none (`token: null`). `body` is the server's
 * response; null without one.
 */
export async function mcpCall(
  dataDir: string,
  method: string,
  params: Record<string, unknown>,
  { token, server }: { token?: string | null; server?: McpServer } = {},
): Promise<{ status: number; body: McpResponse | null }> {
  const { url, headers }: McpServer =
    server ?? JSON.parse(readFileSync(join(managerDir(dataDir), 'mcp.json'), 'utf8')).mcpServers.mainframe;
  const authorization = token === undefined ? headers.Authorization : token === null ? undefined : `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization && { authorization }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  // The server answers over an event stream of one event, whose data is the response.
  const data = (await res.text()).match(/^data: (.*)$/m)?.[1];
  return { status: res.status, body: data === undefined ? null : JSON.parse(data) };
}

export const claudeFile = process.platform === 'win32' ? 'claude.exe' : 'claude';

/** The git on the developer's own PATH, which the stand-in computers are given. */
function systemGit(): string {
  const found = findExecutable('git', {
    env: process.env as Record<string, string>,
    cwd: process.cwd(),
    platform: process.platform,
    files: localFiles,
  });
  if (found === null) throw new Error('the setup tests need git on PATH');
  return found;
}

/**
 * A computer with nothing but node, and git unless `o.git` is false: the app's PATH holds only those,
 * and HOME, USERPROFILE and APPDATA name an empty folder (on Windows one with the AppData\Roaming
 * Electron needs), so no claude of the developer's can be found and `MAINFRAME_CLAUDE_BIN` is unset.
 * On POSIX PATH is a folder of links, as the stand-in for claude is a script that runs `node`; on
 * Windows it is node's own folder and Git's own folder.
 */
export function computer(o: { git?: boolean } = {}) {
  const home = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-home-')));
  let dirs: string[];
  if (process.platform === 'win32') {
    // Electron on Windows crashes at launch (exit 0x80000003) when USERPROFILE names a folder with no
    // AppData\Roaming in it. CI run 3: with only that folder in it, Electron launched; with an empty one,
    // one holding only AppData\Local, or C:\Users\Public (no AppData at all), it crashed.
    mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true });
    dirs = [dirname(process.execPath), ...(o.git === false ? [] : [dirname(systemGit())])];
  } else {
    const bin = removeAfterTest(mkdtempSync(join(os.tmpdir(), 'mainframe-e2e-bin-')));
    symlinkSync(process.execPath, join(bin, 'node'));
    if (o.git !== false) symlinkSync(systemGit(), join(bin, 'git'));
    dirs = [bin];
  }
  const env: Record<string, string | undefined> = {
    MAINFRAME_CLAUDE_BIN: undefined,
    // Windows spells it `Path` in process.env, and the app must get one key, not two.
    [pathKey(process.env, process.platform) ?? 'PATH']: dirs.join(delimiter),
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
  };
  return {
    env,
    home,
    /** Puts a copy of the stand-in where the native installer puts claude, and returns its path. */
    installClaude(): string {
      const file = join(home, '.local', 'bin', claudeFile);
      mkdirSync(dirname(file), { recursive: true });
      copyFileSync(fakeClaude, file);
      return file;
    },
  };
}

/** settings.json as Mainframe reads it; a warning fails the test. */
export const savedSettings = (dataDir: string) =>
  readSettings(dataDir, (msg) => {
    throw new Error(msg);
  });
