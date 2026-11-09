import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { makeRepo } from '../src/main/testing/makeRepo';
import { removeAfterTest } from './launch';

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

/** Two frames: a layout change has been measured and any fit it caused has run. */
export const settled = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

export const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

/** Whether `locator` is what shows at its own centre, not something laid over it. */
export const isOnTop = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });

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

/** The links the app was asked to open, oldest first. `launchApp` keeps them from the owner's browser. */
export const openedLinks = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { openedLinks?: string[] }).openedLinks ?? []);

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/** A sync is a `claude -p` run; sessions are interactive. */
const isSync = (launch: { args: string[] }) => launch.args[0] === '-p';
/** Only the manager's launches carry a role prompt. */
const isManager = (launch: { args: string[] }) => launch.args.includes('--append-system-prompt');

const sessionLaunches = (dataDir: string) => allLaunches(dataDir).filter((launch) => !isSync(launch));

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

/** From now until `releaseSyncs`, a sync run waits without replying, until it is stopped. */
export const holdSyncs = (dataDir: string) => writeFileSync(join(fakeLogDir(dataDir), 'sync-hold'), '');

export const releaseSyncs = (dataDir: string) => rmSync(join(fakeLogDir(dataDir), 'sync-hold'), { force: true });

/** The sync runs' files that end in `ext`, each named `<pid><ext>`. */
const syncMarks = (dataDir: string, ext: string) => readdirSync(fakeLogDir(dataDir)).filter((name) => name.endsWith(ext));

/** How many sync runs are waiting, held. Stopping one before it waits could find it before it can record the stop. */
export const heldSyncs = (dataDir: string) => syncMarks(dataDir, '.holding').length;

const isGone = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

/**
 * How many sync runs were stopped. Mainframe stops one with SIGTERM, which the run records. Windows
 * can't run a handler when a process is stopped, so there it counts the held runs whose process has
 * gone: a held run ends only by a stop or a release.
 */
export const stoppedSyncs = (dataDir: string) =>
  process.platform === 'win32'
    ? syncMarks(dataDir, '.holding').filter((name) => isGone(Number.parseInt(name, 10))).length
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

/**
 * Posts one JSON-RPC request to Mainframe's MCP server, at the address in the manager's `mcp.json` and
 * with its token, another one, or none (`token: null`). `body` is the server's response; null without one.
 */
export async function mcpCall(
  dataDir: string,
  method: string,
  params: Record<string, unknown>,
  { token }: { token?: string | null } = {},
): Promise<{ status: number; body: McpResponse | null }> {
  const { url, headers } = JSON.parse(readFileSync(join(managerDir(dataDir), 'mcp.json'), 'utf8')).mcpServers.mainframe;
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
