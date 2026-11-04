import { Menu, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';

/**
 * The macOS app menu. Its key equivalents reach the app before the page does, so Cmd+C/Cmd+V stay
 * with the Edit menu (the terminal handles the DOM copy/paste events). No File menu, so Cmd+W is
 * unbound; no reload and no zoom.
 */
export function buildMenu(win: BrowserWindow): Menu {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Redraw Terminals',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            if (!win.isDestroyed()) win.webContents.send(IPC.redrawTerminals);
          },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]);
}
