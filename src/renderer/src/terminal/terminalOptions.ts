import type { ITerminalOptions } from '@xterm/xterm';

/** Background of the owner's iTerm2 Default profile; the terminal pane uses it too. */
export const TERMINAL_BACKGROUND = '#011627';

/**
 * Matches the owner's iTerm2 Default profile (Monaco 13, line height 1.05, steady cursor, its
 * colours). Option stays a normal key: the Swedish – Pro layout types @ $ | [ ] { } with it.
 */
export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: 'Monaco, Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.05,
  cursorBlink: false,
  macOptionIsMeta: false,
  macOptionClickForcesSelection: true,
  scrollback: 10_000,
  scrollSensitivity: 2,
  theme: {
    background: TERMINAL_BACKGROUND,
    foreground: '#d6deeb',
    cursor: '#7e57c2',
    cursorAccent: '#ffffff',
    selectionBackground: '#5f7e97',
    selectionForeground: '#dfe5ee',
    black: '#011627',
    red: '#ef5350',
    green: '#22da6e',
    yellow: '#addb67',
    blue: '#82aaff',
    magenta: '#c792ea',
    cyan: '#21c7a8',
    white: '#ffffff',
    brightBlack: '#575656',
    brightRed: '#ef5350',
    brightGreen: '#22da6e',
    brightYellow: '#ffeb95',
    brightBlue: '#82aaff',
    brightMagenta: '#c792ea',
    brightCyan: '#7fdbca',
    brightWhite: '#ffffff',
  },
};
