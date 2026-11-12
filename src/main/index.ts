import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  session,
  shell,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from 'electron';
import { IPC } from '../shared/ipc';
import { AGENT_NAMES, type AgentName, type ProgramCheck } from '../shared/types';
import { clearPasteFolder } from './clipboard';
import { loadConfig, type AppConfig } from './config';
import { copyMenuItems, editMenuItems } from './contextMenu';
import { DiffWindow } from './diff/diffWindow';
import { gitQueries } from './git';
import { registerIpc, registerSettingsIpc, registerSetupIpc, type Project } from './ipc';
import { ManagerService } from './manager/managerService';
import { registerManagerTools } from './mcp/managerTools';
import { startMcpServer } from './mcp/mcpServer';
import { buildMenu } from './menu';
import { ProjectRegistry } from './projectRegistry';
import { findExecutable, type ExecutableLookup } from './pty/findExecutable';
import { spawnNodePty } from './pty/nodePty';
import { buildSpawnEnv } from './pty/spawnEnv';
import { localFiles, SessionHost } from './pty/sessionHost';
import { AgentsInUse } from './setup/agentsInUse';
import { runVersion } from './setup/programChecks';
import type { AppSettings } from './setup/settings';
import { SetupFlow } from './setup/setupFlow';
import { TaskService } from './tasks/taskService';
import { TaskRecords } from './tasks/taskStore';
import { TodoService } from './todo/todoService';
import { isDevToolsKey, isSettingsKey } from './windowKeys';
import { APP_BACKGROUND, webPreferences } from './windowOptions';

const onMac = process.platform === 'darwin';
/** How long a quit waits for the sessions it has hung up on to end. */
const QUIT_WAIT_MS = 2000;

// Every on-screen terminal holds a WebGL context; Chromium's default limit (16) is too low.
app.commandLine.appendSwitch('max-active-webgl-contexts', '64');

/**
 * Read before `ready`: the data folder becomes `userData`, so Chromium's storage lives there too.
 * An error is shown once the app is ready.
 */
function readConfig(): AppConfig | Error {
  try {
    const config = loadConfig(process.env, app.getPath('userData'));
    // setPath refuses a folder that doesn't exist.
    mkdirSync(config.dataDir, { recursive: true });
    app.setPath('userData', config.dataDir);
    return config;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function createWindow(e2e: boolean): BrowserWindow {
  const win = new BrowserWindow({
    title: 'Mainframe',
    width: 1400,
    height: 900,
    // On the Mac an e2e run's window stays hidden (MAINFRAME_E2E=1): shown, each test's launch would come to the front
    // and take the focus from whatever the user is doing. On Windows and Linux the keys Playwright types never reach
    // a hidden window, so there it shows.
    show: !(e2e && onMac),
    // macOS only: in an e2e run the window may be larger than the runner's screen (MAINFRAME_E2E=1).
    enableLargerThanScreen: e2e,
    backgroundColor: APP_BACKGROUND,
    // On the Mac the window buttons sit at the left of the page's top row, which is the window's title bar.
    // Windows and Linux keep the system's own title bar, with its buttons.
    titleBarStyle: onMac ? 'hiddenInset' : 'default',
    webPreferences: webPreferences(),
  });
  prepareWebContents(win, editMenuItems);
  loadPage(win);
  return win;
}

/** What a window's page may do, alike in both windows; `menuItems` is its right-click menu off the Mac. */
function prepareWebContents(
  win: BrowserWindow,
  menuItems: (params: ContextMenuParams) => MenuItemConstructorOptions[] | null,
): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // With no menu off the Mac, DevTools are Ctrl+Shift+I there and Settings Ctrl+, (caught here, before a focused
  // terminal gets the key); the Mac keeps its menus' View ▸ DevTools and Mainframe ▸ Settings… (Cmd+,).
  if (!onMac) {
    win.webContents.on('before-input-event', (event, input) => {
      if (isDevToolsKey(input)) {
        event.preventDefault();
        win.webContents.toggleDevTools();
      } else if (isSettingsKey(input)) {
        event.preventDefault();
        // Settings show in Mainframe's window, also when the key comes from the diff window above it.
        sendTo(win.getParentWindow() ?? win, IPC.showSettings, null);
      }
    });
    // A right-click gets the window's menu there; the Mac gets none. In Mainframe's, a right-click on
    // something editable gets Copy and Paste. In a terminal xterm has already focused its textarea and
    // filled it with the selection, so the roles' DOM copy and paste reach the terminal's own handlers,
    // as the Mac's Edit menu does.
    win.webContents.on('context-menu', (_e, params) => {
      const items = menuItems(params);
      if (items) Menu.buildFromTemplate(items).popup({ window: win });
    });
  }
}

/** The renderer's page; `view` picks the diff window's instead of Mainframe's. */
function loadPage(win: BrowserWindow, view?: 'diff'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(view ? `${devUrl}?view=${view}` : devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), view && { query: { view } });
}

/** One path from a dialog on the window; undefined when the user cancels. Looked up at each call, so an e2e run can answer it. */
async function pickPath(win: BrowserWindow, options: OpenDialogOptions): Promise<string | undefined> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, options);
  return canceled ? undefined : filePaths[0];
}

/** `message` shows on macOS only, `title` everywhere. */
const pickProjectFolder = (win: BrowserWindow) =>
  pickPath(win, {
    title: 'Choose a project folder',
    message: 'Choose the folder of the project Mainframe should run on',
    buttonLabel: 'Open',
    properties: ['openDirectory'],
  });

/**
 * On Windows only `.exe` files are offered: Mainframe runs nothing else there. A symlink is kept as
 * picked (macOS would give its target, and the target of a Homebrew one changes at every upgrade),
 * and hidden folders, where a package manager may have put the agent, are shown (macOS and Windows).
 */
const pickAgent = (win: BrowserWindow, name: AgentName) =>
  pickPath(win, {
    title: `Find ${AGENT_NAMES[name]}`,
    buttonLabel: 'Use this',
    properties: ['openFile', 'noResolveAliases', 'showHiddenFiles'],
    filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : undefined,
  });

const lookupIn = (env: Record<string, string>): ExecutableLookup => ({
  env,
  cwd: process.cwd(),
  platform: process.platform,
  files: localFiles,
});

/**
 * The environment every session and sync run gets, and where node is in it (null when it isn't), looked up once at
 * start. The agents are the setup's to find; the projects start with what it settles on.
 */
function findPrograms(): { env: Record<string, string>; nodeBin: string | null } {
  const env = buildSpawnEnv(process.env, process.platform);
  return { env, nodeBin: findExecutable('node', lookupIn(env)) };
}

/** Sends to the window, unless it has gone: exits and setup answers keep arriving while the app quits. */
function sendTo(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

/**
 * Calls `onBegin` when a quit begins: on `before-quit`, and on the window's `session-end`, which is all
 * a Windows shutdown, restart or log-off sends (no `before-quit`) and which never fires on macOS or
 * Linux. Once it fires the session ends whatever happens, so `onBegin` must finish its work
 * synchronously. Either event can come first, and both may come.
 */
function onQuitBegins(win: BrowserWindow, onBegin: () => void): void {
  app.on('before-quit', onBegin);
  win.on('session-end', onBegin);
}

/**
 * Starts the projects in the window, once the setup has an agent that works. `agents` is shared by every project.
 * Throws when Mainframe can't start; a project that can't open is said and left out.
 */
async function start(
  config: AppConfig,
  programs: ReturnType<typeof findPrograms>,
  agents: AgentsInUse,
  projectDirs: string[],
  win: BrowserWindow,
): Promise<void> {
  // Pasted images get one file each; empty the folder at start so they don't pile up.
  const pasteDir = join(app.getPath('temp'), 'mainframe-paste');
  clearPasteFolder(pasteDir, console.warn);

  const host = new SessionHost({
    spawnPty: spawnNodePty(process.platform),
    outputBatchMs: config.outputBatchMs,
    env: programs.env,
    platform: process.platform,
    files: localFiles,
    log: config.logOsc ? console.log : undefined,
  });
  // A state.json it can't use stops the start here, before any project call is registered.
  const records = new TaskRecords(join(config.dataDir, 'state.json'), Date.now(), console.warn);
  const toWindow = (channel: string, payload: unknown) => sendTo(win, channel, payload);

  // The page is not told of the projects while they open, one after another: it would take the list so
  // far for the whole list and drop the projects still to open from its saved layout. It asks for the
  // whole list itself (`listProjects`) once the setup is over.
  let opening = true;
  const projects = new ProjectRegistry<Project>({
    dataDir: config.dataDir,
    open: makeProject,
    kill: (sessionId, signal) => host.kill(sessionId, signal),
    running: (sessionId) => host.has(sessionId),
    onChange: (list) => {
      if (!opening) toWindow(IPC.projectsChanged, list);
    },
  });

  // beginQuit can't be undone, so it runs here only, once quitting is under way, and at most once:
  // whichever of the two events below comes first does it, and the other changes nothing. It is set
  // up before the projects open: the window is up while they do, and a quit then must stop them.
  let quitting = false;
  const beginQuit = () => {
    if (quitting) return;
    quitting = true;
    // Chromium keeps the renderer's latest localStorage writes (layout, widths, pins) in memory for a
    // while; on Windows a quit lost them. Writing them out now keeps them on every system.
    session.defaultSession.flushStorageData();
    projects.beginQuit();
    host.killAll();
  };
  onQuitBegins(win, beginQuit);
  // Once the window has closed, the quit waits a moment for the sessions beginQuit hung up on: node-pty
  // aborts the app when a session's exit comes in as the app goes (node-pty issue 904). Held after the
  // window has gone, so it can't start a session meanwhile. A Windows shutdown can't be held up.
  let waited = false;
  app.on('will-quit', (event) => {
    if (waited) return;
    event.preventDefault();
    // Quit again once Electron is done with this will-quit: an app.quit() made while it runs does nothing,
    // and with no session running the wait is over at once.
    void host.whenAllEnded(QUIT_WAIT_MS).then(() =>
      setImmediate(() => {
        waited = true;
        app.quit();
      }),
    );
  });

  async function makeProject(dir: string): Promise<Project> {
    // Only while it is the project open on its folder: a closed one's last exits change nothing on screen.
    const send = (channel: string, payload: unknown) => {
      if (projects.get(dir) === project) toWindow(channel, payload);
    };
    const service = new TaskService({
      projectDir: dir,
      dataDir: config.dataDir,
      records,
      agents,
      nodeBin: programs.nodeBin,
      platform: process.platform,
      git: gitQueries,
      kill: (sessionId) => host.kill(sessionId),
      status: (sessionId) => host.status(sessionId),
      onChange: (tasks) => send(IPC.tasksChanged, { dir, tasks }),
    });
    const todo = new TodoService({
      projectDir: dir,
      dataDir: config.dataDir,
      nodeBin: programs.nodeBin,
      // The sync run gets what sessions get: it must find the owner's connectors as they do.
      env: programs.env,
      agent: () => agents.inUse(),
      saveAgentSetting: (name, patch) => agents.saveAgentSetting(name, patch),
      startTask: (req) => service.start(req),
      onChange: (view) => send(IPC.todoChanged, { dir, view }),
    });
    // The manager's tools, on this project's tasks and to-do list. Each launch carries this run's port and token to it.
    const mcp = await startMcpServer((server) => registerManagerTools(server, service, todo));
    const manager = new ManagerService({
      projectDir: dir,
      dataDir: config.dataDir,
      nodeBin: programs.nodeBin,
      env: programs.env,
      mcp: { url: mcp.url, token: mcp.token },
      agent: () => agents.inUse(),
      onChange: (view) => send(IPC.managerChanged, { dir, view }),
    });
    const project: Project = {
      service,
      manager,
      todo,
      start: () => {
        // A list asked for before this finishes gets the tasks as they are; the changes follow.
        service.restore().catch((err: unknown) => console.error(`[tasks] could not restore the tasks of ${dir}`, err));
        // Logged, never thrown: the tasks run on without the manager.
        manager.start().catch((err: unknown) => console.error(`[manager] could not start the manager of ${dir}`, err));
      },
      cancelSync: () => todo.close(),
      release: () => mcp.close(),
    };
    return project;
  }

  // The dialog may show at any time, but the folder picked opens only once the remembered projects
  // have: one opened while they open would not come on screen, as the page is told of no change until then.
  let allOpened!: () => void;
  const allOpen = new Promise<void>((resolve) => (allOpened = resolve));
  // The project picked is brought on screen, whether it opens now or was open already.
  const openPicked = async () => {
    try {
      const dir = await pickProjectFolder(win);
      if (dir === undefined) return;
      await allOpen;
      await projects.open(dir);
      toWindow(IPC.showProject, dir);
    } catch (err) {
      dialog.showErrorBox('Mainframe could not open the project', messageOf(err));
    }
  };
  // The menu `launch` set, with Open Project… and Settings… enabled now.
  if (onMac) Menu.setApplicationMenu(buildMenu({ openProject: () => void openPicked(), openSettings: () => toWindow(IPC.showSettings, null) }));
  registerSettingsIpc(agents, (name) => pickAgent(win, name));
  const diffWindow = new DiffWindow({
    parent: win,
    dataDir: config.dataDir,
    hidden: config.e2e && onMac,
    prepare: (w) => {
      prepareWebContents(w, copyMenuItems);
      loadPage(w, 'diff');
    },
    warn: console.warn,
  });
  // Closed first, so it never keeps the app running: `window-all-closed` ends it once both have gone.
  win.on('close', () => diffWindow.close());
  // Before the projects open, so no call the page makes about one finds no handler.
  registerIpc(
    toWindow,
    projects,
    openPicked,
    host,
    { clipboard, writeFile, newImagePath: () => join(pasteDir, `${randomUUID()}.png`) },
    diffWindow,
  );
  for (const dir of projectDirs) {
    await projects.open(dir).catch((err: unknown) => dialog.showErrorBox(`Mainframe could not open ${basename(dir)}`, messageOf(err)));
  }
  opening = false;
  allOpened();
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Mainframe can't start: says why and ends the app. */
function failStart(err: unknown): void {
  dialog.showErrorBox('Mainframe could not start', messageOf(err));
  app.quit();
}

/**
 * Start-up, in order: the window opens first, so the setup can show in it; the setup then checks
 * git and the agents and starts the projects once git and an agent work, asking for what it can't find. A quit
 * before that starts no project. Throws when Mainframe can't start.
 */
async function launch(config: AppConfig): Promise<void> {
  const programs = findPrograms();
  // Set before the window, which would get Electron's default menu: its Ctrl+W (Cmd+W on the Mac) would
  // close the window, which quits Mainframe and ends every session, and it would bring reload and zoom.
  // The Mac's own menu is there from the first moment, with Open Project… disabled until `start` sets it
  // again with the projects to open into. Windows and Linux get no menu, so no menu bar: Open Project… is
  // the project list's button there.
  Menu.setApplicationMenu(onMac ? buildMenu() : null);
  const win = createWindow(config.e2e);
  // Mainframe was opened again on this data folder: that one has quit, and this one comes forward.
  app.on('second-instance', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  // The checks and a pending dialog can outlast the start of a quit. Projects opened then would write
  // projects.json with only those open so far, with nothing to record or end their sessions: `start`
  // sets up its own quit handling, but only once it runs, so it can't cover a quit that began before.
  let quitting = false;
  const quitBegins = () => {
    quitting = true;
  };
  onQuitBegins(win, quitBegins);
  const envBins = { claude: config.claudeBin, opencode: config.opencodeBin };
  const lookup = lookupIn(programs.env);
  const run = runVersion(programs.env);
  // After start the settings are AgentsInUse's alone: the flow writes them no more.
  const agentsFrom = (found: { settings: AppSettings; checks: Record<AgentName, ProgramCheck> }) =>
    new AgentsInUse({
      dataDir: config.dataDir,
      ...found,
      envBins,
      run,
      lookup,
      nodeBin: programs.nodeBin,
      env: programs.env,
      onChange: (view) => sendTo(win, IPC.settingsChanged, view),
    });
  const flow = new SetupFlow({
    dataDir: config.dataDir,
    envBins,
    lookup,
    run,
    nodeBin: programs.nodeBin,
    pickAgent: (name) => pickAgent(win, name),
    pickFolder: () => pickProjectFolder(win),
    onChange: (view) => sendTo(win, IPC.setupChanged, view),
    start: async (found, dirs) => {
      if (!quitting) await start(config, programs, agentsFrom(found), dirs, win);
    },
    warn: console.warn,
  });
  // The calls are registered in the same turn, before the page can make one.
  const begun = flow.begin();
  registerSetupIpc(
    {
      inputBatchMs: config.inputBatchMs,
      e2e: config.e2e,
      // os.release() is `10.0.<build>` on Windows.
      windowsBuild: process.platform === 'win32' ? Number(os.release().split('.')[2]) : null,
    },
    flow,
    begun,
    failStart,
    // Looked up at each call, so an e2e run can stand in for the browser.
    (url) => shell.openExternal(url),
  );
  await begun;
}

const config = readConfig();

// One Mainframe per data folder: a second one would run every open task's session again, and two
// would write one state.json. Electron keeps the lock in userData, which readConfig has just set.
if (!(config instanceof Error) && !app.requestSingleInstanceLock()) {
  // The one that holds it has been told, and shows its window.
  app.quit();
} else {
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(async () => {
    try {
      if (config instanceof Error) throw config;
      await launch(config);
    } catch (err) {
      failStart(err);
    }
  });
}
