import { Menu } from 'electron';

/**
 * The macOS app menu. Its key equivalents reach the app before the page does, so Cmd+C/Cmd+V stay
 * with the Edit menu (the terminal handles the DOM copy/paste events). No File menu, so Cmd+W is
 * unbound; no reload and no zoom.
 */
export function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ]);
}
