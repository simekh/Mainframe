import { Menu } from 'electron';

/**
 * The Mac's app menu; Windows and Linux have none (`launch` in index.ts). Its key equivalents reach the
 * app before the page does, so Cmd+C/Cmd+V stay with the Edit menu (the terminal handles the DOM
 * copy/paste events). The File menu holds only Open Project… (Cmd+O), so Cmd+W is unbound; no reload
 * and no zoom.
 */
export function buildMenu(openProject: () => void): Menu {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [{ id: 'open-project', label: 'Open Project…', accelerator: 'Cmd+O', click: openProject }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ]);
}
