import { join } from 'node:path';
import type { WebPreferences } from 'electron';

export const APP_BACKGROUND = '#080c10'; // Parallel Code's --bg; matches app.css

/** Mainframe's window and the diff window run their pages alike: sandboxed, through the one preload. */
export const webPreferences = (): WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // Keep output parsing and terminal replies running while the window is hidden.
  backgroundThrottling: false,
});
