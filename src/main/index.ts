import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu, shell, type OpenDialogOptions } from 'electron';
import * as pty from 'node-pty';
import { IPC } from '../shared/ipc';
import { loadConfig, type AppConfig } from './config';
import { gitQueries } from './git';
import { registerIpc, type Project } from './ipc';
import { ManagerService } from './manager/managerService';
import { registerManagerTools } from './mcp/managerTools';
import { mcpConfigJson, startMcpServer } from './mcp/mcpServer';
import { buildMenu } from './menu';
import { ProjectRegistry } from './projectRegistry';
import { chooseProjects } from './projects';
import { buildSpawnEnv } from './pty/spawnEnv';
import { localFiles, SessionHost } from './pty/sessionHost';
import { TaskService } from './tasks/taskService';
import { TaskRecords } from './tasks/taskStore';

const APP_BACKGROUND = '#080c10'; // Parallel Code's --bg; matches app.css

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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'Mainframe',
    width: 1400,
    height: 900,
    backgroundColor: APP_BACKGROUND,
    // The window buttons sit in the manager's column, which runs to the top edge as the panel does.
    titleBarStyle: 'hiddenInset',
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

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

/** The folder dialog, on the window once there is one. Undefined when the owner cancels. */
async function pickProjectFolder(win?: BrowserWindow): Promise<string | undefined> {
  const options: OpenDialogOptions = {
    message: 'Choose the folder of the project Mainframe should run on',
    buttonLabel: 'Open',
    properties: ['openDirectory'],
  };
  // Looked up at each call, so an e2e run can answer it.
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return canceled ? undefined : filePaths[0];
}

/** Throws when Mainframe can't start; a project that can't open is said and left out. */
async function start(config: AppConfig, projectDirs: string[]): Promise<void> {
  // Pasted images get one file each; empty the folder at start so they don't pile up.
  const pasteDir = join(app.getPath('temp'), 'mainframe-paste');
  rmSync(pasteDir, { recursive: true, force: true });
  mkdirSync(pasteDir, { recursive: true });

  const host = new SessionHost({
    spawnPty: pty.spawn,
    outputBatchMs: config.outputBatchMs,
    env: buildSpawnEnv(process.env),
    files: localFiles,
    log: config.logOsc ? console.log : undefined,
  });
  // Before the window: a state.json it can't use stops the start here, with no window left
  // waiting for handlers that never come.
  const records = new TaskRecords(join(config.dataDir, 'state.json'), Date.now(), console.warn);
  let win: BrowserWindow | undefined;
  // Exits keep arriving while the app quits, after the window has gone.
  const toWindow = (channel: string, payload: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const projects = new ProjectRegistry<Project>({
    dataDir: config.dataDir,
    open: makeProject,
    kill: (sessionId) => host.kill(sessionId),
    running: (sessionId) => host.has(sessionId),
    onChange: (list) => toWindow(IPC.projectsChanged, list),
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
      claudeBin: config.claudeBin,
      git: gitQueries,
      kill: (sessionId) => host.kill(sessionId),
      status: (sessionId) => host.status(sessionId),
      onChange: (tasks) => send(IPC.tasksChanged, { dir, tasks }),
    });
    // The manager's tools, on this project's tasks. Its mcp.json carries this run's port and token to it.
    const mcp = await startMcpServer((server) => registerManagerTools(server, service));
    const manager = new ManagerService({
      projectDir: dir,
      dataDir: config.dataDir,
      claudeBin: config.claudeBin,
      mcpConfig: mcpConfigJson(mcp.url, mcp.token),
      onChange: (view) => send(IPC.managerChanged, { dir, view }),
    });
    const project: Project = {
      service,
      manager,
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
      release: () => mcp.close(),
    };
    return project;
  }

  for (const dir of projectDirs) {
    await projects.open(dir).catch((err: unknown) => dialog.showErrorBox(`Mainframe could not open ${basename(dir)}`, messageOf(err)));
  }

  const shown = createWindow();
  win = shown;
  // The project picked is brought on screen, whether it opens now or was open already.
  const openPicked = async () => {
    try {
      const dir = await pickProjectFolder(shown);
      if (dir === undefined) return;
      await projects.open(dir);
      toWindow(IPC.showProject, dir);
    } catch (err) {
      dialog.showErrorBox('Mainframe could not open the project', messageOf(err));
    }
  };
  Menu.setApplicationMenu(buildMenu(() => void openPicked()));
  registerIpc(
    toWindow,
    projects,
    openPicked,
    host,
    { inputBatchMs: config.inputBatchMs, e2e: config.e2e },
    { clipboard, writeFile, newImagePath: () => join(pasteDir, `${randomUUID()}.png`) },
    // Looked up at each call, so an e2e run can stand in for the browser.
    (url) => shell.openExternal(url),
  );
  // Mainframe was opened again on this data folder: that one has quit, and this one comes forward.
  app.on('second-instance', () => {
    if (shown.isDestroyed()) return;
    if (shown.isMinimized()) shown.restore();
    shown.focus();
  });
  // beginQuit can't be undone, so it runs here only, once quitting is under way.
  app.on('before-quit', () => {
    projects.beginQuit();
    host.killAll();
  });
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
      const projectDirs = await chooseProjects({ dataDir: config.dataDir, pick: () => pickProjectFolder(), warn: console.warn });
      if (projectDirs.length === 0) {
        app.quit();
        return;
      }
      await start(config, projectDirs);
    } catch (err) {
      dialog.showErrorBox('Mainframe could not start', messageOf(err));
      app.quit();
    }
  });
}
