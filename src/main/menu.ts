import { app, Menu } from 'electron';
import type { ZoomStep } from './zoom';

/**
 * The Mac's app menu; Windows and Linux have none (`launch` in index.ts). Its key equivalents reach the
 * app before the page does, so Cmd+C/Cmd+V stay with the Edit menu (the terminal handles the DOM
 * copy/paste events), and Cmd+, opens Settings before a focused terminal gets it. The File menu holds
 * only Open Project… (Cmd+O), so Cmd+W is unbound; no reload. View's zoom items show their keys, but
 * the window catches the keys first (`prepareWebContents` in index.ts), so only a click reaches them.
 * Without `openProject` and `openSettings`, their items are disabled: the menu is up from the first
 * moment, and there is nothing to open into until the setup has started the projects.
 */
export function buildMenu(o: { zoom: (step: ZoomStep) => void; openProject?: () => void; openSettings?: () => void }): Menu {
  const { zoom, openProject, openSettings } = o;
  return Menu.buildFromTemplate([
    {
      // The app menu, spelled out so it can hold Settings…; the Mac titles it with the app's name.
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { id: 'settings', label: 'Settings…', accelerator: 'Cmd+,', enabled: openSettings !== undefined, click: openSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { id: 'open-project', label: 'Open Project…', accelerator: 'Cmd+O', enabled: openProject !== undefined, click: openProject },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Actual Size', accelerator: 'Cmd+0', click: () => zoom('reset') },
        { label: 'Zoom In', accelerator: 'Cmd+Plus', click: () => zoom('in') },
        { label: 'Zoom Out', accelerator: 'Cmd+-', click: () => zoom('out') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]);
}
