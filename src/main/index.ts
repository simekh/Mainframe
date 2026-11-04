import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu } from 'electron';
import * as pty from 'node-pty';
import { loadConfig, type AppConfig } from './config';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { buildSpawnEnv } from './pty/spawnEnv';
import { SessionHost } from './pty/sessionHost';
import { SessionRegistry } from './sessions';

const APP_BACKGROUND = '#16181d';

// Every on-screen terminal holds a WebGL context; Chromium's default limit (16) is too low.
app.commandLine.appendSwitch('max-active-webgl-contexts', '64');

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'TheSource',
    width: 1400,
    height: 900,
    backgroundColor: APP_BACKGROUND,
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

function start(config: AppConfig): void {
  // Pasted images get one file each; empty the folder at start so they don't pile up.
  const pasteDir = join(app.getPath('temp'), 'thesource-paste');
  rmSync(pasteDir, { recursive: true, force: true });
  mkdirSync(pasteDir, { recursive: true });

  const registry = new SessionRegistry({ projectDir: config.projectDir, sessionArgv: config.sessionArgv });
  const host = new SessionHost({
    spawnPty: pty.spawn,
    outputBatchMs: config.outputBatchMs,
    env: buildSpawnEnv(process.env),
    log: config.logOsc ? console.log : undefined,
  });
  const win = createWindow();
  Menu.setApplicationMenu(buildMenu(win));
  registerIpc(win, registry, host, config, {
    clipboard,
    writeFile,
    newImagePath: () => join(pasteDir, `${randomUUID()}.png`),
  });
  app.on('before-quit', () => host.killAll());
}

app.on('window-all-closed', () => app.quit());

void app.whenReady().then(() => {
  let config: AppConfig;
  try {
    config = loadConfig(process.env, isDirectory);
  } catch (err) {
    dialog.showErrorBox('TheSource', err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }
  start(config);
});
