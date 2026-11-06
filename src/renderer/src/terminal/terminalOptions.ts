// Colours adapted from Parallel Code (MIT): src/lib/parallelCodeTerminalTheme.ts at 97c3558. See THIRD_PARTY_NOTICES.md.
import type { ITerminalOptions } from '@xterm/xterm';

/** Bundled with the app (App.tsx imports it); xterm measures it once, so it must load first. */
export const TERMINAL_FONT = 'JetBrains Mono';

/** Parallel Code's terminal panel colour (`--task-panel-bg`); app.css paints the pane with it too. */
const TERMINAL_BACKGROUND = '#13191f';

/**
 * The bold and link colours of the owner's iTerm2 profile (Night Owl). xterm has no option for
 * either, so termStyle.ts colours that text in the output before xterm reads it.
 */
export const BOLD_AND_LINK_COLORS = { bold: '#addb67', link: '#82aaff' };

/**
 * Parallel Code's default look: JetBrains Mono 13 and its muted palette on the blue-black panel.
 * The cursor stays steady. Option stays a normal key: the Swedish – Pro layout types @ $ | [ ] { }
 * with it.
 */
export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: `'${TERMINAL_FONT}', monospace`,
  fontSize: 13,
  lineHeight: 1,
  cursorBlink: false,
  // term.unicode, which the Unicode 11 width addon needs, is still a proposed API.
  allowProposedApi: true,
  macOptionIsMeta: false,
  macOptionClickForcesSelection: true,
  scrollback: 10_000,
  scrollSensitivity: 2,
  theme: {
    background: TERMINAL_BACKGROUND,
    foreground: '#f0f4f7',
    cursor: '#67d9ed',
    cursorAccent: '#080c10',
    selectionBackground: '#18343e',
    black: '#29343d',
    red: '#f08f8a',
    green: '#98c9ae',
    yellow: '#dfba83',
    blue: '#8fbddd',
    magenta: '#c1b0e8',
    cyan: '#67d9ed',
    white: '#c4d0d9',
    brightBlack: '#8193a2',
    brightRed: '#f5a8a4',
    brightGreen: '#addcc1',
    brightYellow: '#ead0a5',
    brightBlue: '#a9cdea',
    brightMagenta: '#d2c4f0',
    brightCyan: '#91e5f3',
    brightWhite: '#f0f4f7',
  },
};
