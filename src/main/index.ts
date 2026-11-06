import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu } from 'electron';
import * as pty from 'node-pty';
import { IPC } from '../shared/ipc';
import { loadConfig, type AppConfig } from './config';
import { gitQueries } from './git';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { buildSpawnEnv } from './pty/spawnEnv';
import { localFiles, SessionHost } from './pty/sessionHost';
import { TaskService } from './tasks/taskService';

const APP_BACKGROUND = '#080c10'; // Parallel Code's --bg; matches app.css

// Every on-screen terminal holds a WebGL context; Chromium's default limit (16) is too low.
app.commandLine.appendSwitch('max-active-webgl-contexts', '64');

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read before `ready`: the data folder becomes `userData`, so Chromium's storage lives there too.
 * An error is shown once the app is ready.
 */
function readConfig(): AppConfig | Error {
  try {
    const config = loadConfig(process.env, isDirectory, app.getPath('userData'));
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
    title: 'TheSource',
    width: 1400,
    height: 900,
    backgroundColor: APP_BACKGROUND,
    // The window buttons sit in the board's top bar, and the panel runs to the top edge.
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

/** Throws when TheSource can't start; nothing that can throw comes after the window opens. */
function start(config: AppConfig): void {
  // Pasted images get one file each; empty the folder at start so they don't pile up.
  const pasteDir = join(app.getPath('temp'), 'thesource-paste');
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
  let win: BrowserWindow | undefined;
  const service = new TaskService({
    projectDir: config.projectDir,
    dataDir: config.dataDir,
    claudeBin: config.claudeBin,
    git: gitQueries,
    kill: (sessionId) => host.kill(sessionId),
    // Exits keep arriving while the app quits, after the window has gone.
    onChange: (tasks) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.tasksChanged, tasks);
    },
  });
  const shown = createWindow();
  win = shown;
  Menu.setApplicationMenu(buildMenu());
  registerIpc(shown, service, host, config, {
    clipboard,
    writeFile,
    newImagePath: () => join(pasteDir, `${randomUUID()}.png`),
  });
  // TheSource was opened again on this data folder: that one has quit, and this one comes forward.
  app.on('second-instance', () => {
    if (shown.isDestroyed()) return;
    if (shown.isMinimized()) shown.restore();
    shown.focus();
  });
  // A list asked for before this finishes gets the tasks as they are; the changes follow.
  service.restore().catch((err: unknown) => console.error('[tasks] could not restore the tasks', err));
  // beginQuit can't be undone, so it runs here only, once quitting is under way.
  app.on('before-quit', () => {
    // Logged, never thrown: the sessions must still be ended.
    try {
      service.beginQuit();
    } catch (err) {
      console.error('[tasks] could not record where the sessions were as the app quit', err);
    }
    host.killAll();
  });
}

const config = readConfig();

// One TheSource per data folder: a second one would run every open task's session again, and two
// would write one state.json. Electron keeps the lock in userData, which readConfig has just set.
if (!(config instanceof Error) && !app.requestSingleInstanceLock()) {
  // The one that holds it has been told, and shows its window.
  app.quit();
} else {
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    try {
      if (config instanceof Error) throw config;
      start(config);
    } catch (err) {
      dialog.showErrorBox('TheSource could not start', err instanceof Error ? err.message : String(err));
      app.quit();
    }
  });
}
