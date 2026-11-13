import { join } from 'node:path';
import type { WebPreferences } from 'electron';

export const APP_BACKGROUND = '#080c10'; // Parallel Code's --bg; matches app.css

/**
 * Mainframe's window and the diff window run their pages alike: sandboxed, through the one preload, at the
 * windows' zoom. A zoom set on a window before its page loads does not hold, so a new one takes it as made.
 */
export const webPreferences = (zoomFactor: number): WebPreferences => ({
  zoomFactor,
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // Mainframe's window keeps output parsing and terminal replies running while hidden; the diff window has no
  // need of it, but shares the settings so the two can't drift apart.
  backgroundThrottling: false,
});
