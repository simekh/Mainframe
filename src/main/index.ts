import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu, session, shell, type OpenDialogOptions } from 'electron';
import { IPC } from '../shared/ipc';
import { loadConfig, type AppConfig } from './config';
import { editMenuItems } from './contextMenu';
import { gitQueries } from './git';
import { registerIpc, registerSetupIpc, type Project } from './ipc';
import { ManagerService } from './manager/managerService';
import { registerManagerTools } from './mcp/managerTools';
import { mcpConfigJson, startMcpServer } from './mcp/mcpServer';
import { buildMenu } from './menu';
import { ProjectRegistry } from './projectRegistry';
import { findExecutable, type ExecutableLookup } from './pty/findExecutable';
import { spawnNodePty } from './pty/nodePty';
import { buildSpawnEnv } from './pty/spawnEnv';
import { localFiles, SessionHost } from './pty/sessionHost';
import { runVersion } from './setup/programChecks';
import { SetupFlow } from './setup/setupFlow';
import { TaskService } from './tasks/taskService';
import { TaskRecords } from './tasks/taskStore';
import { TodoService } from './todo/todoService';
import { isDevToolsKey } from './windowKeys';

const APP_BACKGROUND = '#080c10'; // Parallel Code's --bg; matches app.css
const onMac = process.platform === 'darwin';

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
    // macOS only: in an e2e run the window may be larger than the runner's screen (MAINFRAME_E2E=1).
    enableLargerThanScreen: e2e,
    backgroundColor: APP_BACKGROUND,
    // On the Mac the window buttons sit in the manager's column, which runs to the top edge as the panel
    // does. Windows and Linux keep the system's own title bar, with its buttons.
    titleBarStyle: onMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep output parsing and terminal replies running while the window is hidden.
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // With no menu off the Mac, DevTools are Ctrl+Shift+I there; the Mac keeps its View menu's.
  if (!onMac) {
    win.webContents.on('before-input-event', (event, input) => {
      if (!isDevToolsKey(input)) return;
      event.preventDefault();
      win.webContents.toggleDevTools();
    });
    // A right-click on something editable gets Copy and Paste there; the Mac gets no menu. In a
    // terminal xterm has already focused its textarea and filled it with the selection, so the roles'
    // DOM copy and paste reach the terminal's own handlers, as the Mac's Edit menu does.
    win.webContents.on('context-menu', (_e, params) => {
      const items = editMenuItems(params);
      if (items) Menu.buildFromTemplate(items).popup({ window: win });
    });
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
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
 * and hidden folders, where a package manager may have put claude, are shown (macOS and Windows).
 */
const pickClaude = (win: BrowserWindow) =>
  pickPath(win, {
    title: 'Find Claude Code',
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
 * The environment every session and sync run gets, and where node is in it, looked up once at
 * start. Node not found, Mainframe can't start: the hooks it writes for Claude Code run node, with
 * no shell. Claude is the setup's to find; the projects start with the path it settles on.
 */
function findPrograms(): { env: Record<string, string>; nodeBin: string } {
  const env = buildSpawnEnv(process.env, process.platform);
  const nodeBin = findExecutable('node', lookupIn(env));
  if (nodeBin === null) {
    throw new Error(
      'Mainframe needs Node.js, and found no node on PATH. Install the current Node.js LTS, then run npm start again from a new terminal.',
    );
  }
  return { env, nodeBin };
}

/** Sends to the window, unless it has gone: exits and setup answers keep arriving while the app quits. */
function sendTo(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

/**
 * Starts the projects in the window, once the setup has a claude that works. Throws when Mainframe
 * can't start; a project that can't open is said and left out.
 */
async function start(
  config: AppConfig,
  programs: ReturnType<typeof findPrograms> & { claudeBin: string },
  projectDirs: string[],
  win: BrowserWindow,
): Promise<void> {
  // Pasted images get one file each; empty the folder at start so they don't pile up.
  const pasteDir = join(app.getPath('temp'), 'mainframe-paste');
  rmSync(pasteDir, { recursive: true, force: true });
  mkdirSync(pasteDir, { recursive: true });

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
  app.on('before-quit', beginQuit);
  // On Windows a shutdown, restart or log-off sends this and no before-quit. Once it fires the
  // session ends whatever happens, so beginQuit records where the sessions were, synchronously.
  // It never fires on macOS or Linux.
  win.on('session-end', beginQuit);

  async function makeProject(dir: string): Promise<Project> {
    // Only while it is the project open on its folder: a closed one's last exits change nothing on screen.
    const send = (channel: string, payload: unknown) => {
      if (projects.get(dir) === project) toWindow(channel, payload);
    };
    const service = new TaskService({
      projectDir: dir,
      dataDir: config.dataDir,
      records,
      claudeBin: programs.claudeBin,
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
      claudeBin: programs.claudeBin,
      nodeBin: programs.nodeBin,
      // The sync run gets what sessions get: it must find the owner's connectors as they do.
      env: programs.env,
      startTask: (req) => service.start(req),
      onChange: (view) => send(IPC.todoChanged, { dir, view }),
    });
    // The manager's tools, on this project's tasks and to-do list. Its mcp.json carries this run's port and token to it.
    const mcp = await startMcpServer((server) => registerManagerTools(server, service, todo));
    const manager = new ManagerService({
      projectDir: dir,
      dataDir: config.dataDir,
      claudeBin: programs.claudeBin,
      nodeBin: programs.nodeBin,
      mcpConfig: mcpConfigJson(mcp.url, mcp.token),
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
        try {
          manager.start();
        } catch (err) {
          console.error(`[manager] could not start the manager of ${dir}`, err);
        }
      },
      cancelSync: () => todo.close(),
      release: () => mcp.close(),
    };
    return project;
  }

  // The project picked is brought on screen, whether it opens now or was open already.
  const openPicked = async () => {
    try {
      const dir = await pickProjectFolder(win);
      if (dir === undefined) return;
      await projects.open(dir);
      toWindow(IPC.showProject, dir);
    } catch (err) {
      dialog.showErrorBox('Mainframe could not open the project', messageOf(err));
    }
  };
  if (onMac) Menu.setApplicationMenu(buildMenu(() => void openPicked()));
  // Before the projects open, so no call the page makes about one finds no handler.
  registerIpc(
    toWindow,
    projects,
    openPicked,
    host,
    { clipboard, writeFile, newImagePath: () => join(pasteDir, `${randomUUID()}.png`) },
  );

  for (const dir of projectDirs) {
    await projects.open(dir).catch((err: unknown) => dialog.showErrorBox(`Mainframe could not open ${basename(dir)}`, messageOf(err)));
  }
  opening = false;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Mainframe can't start: says why and ends the app. */
function failStart(err: unknown): void {
  dialog.showErrorBox('Mainframe could not start', messageOf(err));
  app.quit();
}

/**
 * Start-up, in order: the window opens first, so the setup can show in it; the setup then checks
 * git and claude and starts the projects once both work, asking for what it can't find. A quit
 * before that starts no project. Throws when Mainframe can't start.
 */
async function launch(config: AppConfig): Promise<void> {
  const programs = findPrograms();
  // Windows and Linux get no menu, so no menu bar (set before the window, which would get Electron's
  // default one): its Ctrl+W would close the window, which quits Mainframe and ends every session, and
  // it would bring Ctrl+M and Ctrl+R's reload. Open Project… is the project list's button there.
  if (!onMac) Menu.setApplicationMenu(null);
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
  app.on('before-quit', quitBegins);
  // Windows' shutdown, restart and log-off send this and no before-quit.
  win.on('session-end', quitBegins);
  const flow = new SetupFlow({
    dataDir: config.dataDir,
    envClaudeBin: config.claudeBin,
    lookup: lookupIn(programs.env),
    run: runVersion(programs.env),
    pickClaude: () => pickClaude(win),
    pickFolder: () => pickProjectFolder(win),
    onChange: (view) => sendTo(win, IPC.setupChanged, view),
    start: async (claudeBin, dirs) => {
      if (!quitting) await start(config, { ...programs, claudeBin }, dirs, win);
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
