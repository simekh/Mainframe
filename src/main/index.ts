import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const APP_BACKGROUND = '#16181d';

// Every on-screen terminal holds a WebGL context; Chromium's default limit (16) is too low.
app.commandLine.appendSwitch('max-active-webgl-contexts', '64');

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

app.on('window-all-closed', () => app.quit());

void app.whenReady().then(() => {
  createWindow();
});
