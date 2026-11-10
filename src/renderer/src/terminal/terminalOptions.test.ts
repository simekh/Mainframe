import { it, expect } from 'vitest';
import { BOLD_AND_LINK_COLORS, platformTerminalOptions, TERMINAL_FONT, TERMINAL_OPTIONS } from './terminalOptions';

it("uses Parallel Code's terminal look and leaves Option to the Swedish layout", () => {
  expect(TERMINAL_FONT).toBe('JetBrains Mono');
  expect(TERMINAL_OPTIONS).toMatchObject({
    fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1, cursorBlink: false, allowProposedApi: true,
    macOptionIsMeta: false, macOptionClickForcesSelection: true, scrollback: 10_000, scrollSensitivity: 2,
    theme: {
      background: '#13191f', foreground: '#f0f4f7', cursor: '#67d9ed', selectionBackground: '#18343e',
      black: '#29343d', red: '#f08f8a', green: '#98c9ae', yellow: '#dfba83',
      blue: '#8fbddd', magenta: '#c1b0e8', cyan: '#67d9ed', white: '#c4d0d9',
      brightBlack: '#8193a2', brightWhite: '#f0f4f7',
    },
  });
});

it("takes the bold and link colours from the owner's iTerm2 profile (Night Owl), drawn as they are", () => {
  expect(BOLD_AND_LINK_COLORS).toEqual({ bold: '#addb67', link: '#82aaff' });
  // xterm's default minimum contrast ratio, 1, leaves every colour as it is.
  expect(TERMINAL_OPTIONS.minimumContrastRatio).toBeUndefined();
});

it('adds nothing on the Mac and Linux', () => {
  expect(platformTerminalOptions('darwin', null)).toEqual({});
  expect(platformTerminalOptions('linux', null)).toEqual({});
});

it('tells xterm a Windows terminal runs on ConPTY, with the build, and scrolls about three rows a wheel notch', () => {
  expect(platformTerminalOptions('win32', 26100)).toEqual({
    windowsPty: { backend: 'conpty', buildNumber: 26100 },
    scrollSensitivity: 1,
  });
});
