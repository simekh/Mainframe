import { it, expect } from 'vitest';
import { platformTerminalOptions, TERMINAL_OPTIONS } from './terminalOptions';

it('leaves Option to the Swedish layout', () => {
  expect(TERMINAL_OPTIONS).toMatchObject({ allowProposedApi: true, macOptionIsMeta: false, macOptionClickForcesSelection: true });
});

it('draws the bold and link colours as they are', () => {
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
