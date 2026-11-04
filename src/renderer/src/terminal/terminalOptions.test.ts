import { it, expect } from 'vitest';
import { TERMINAL_OPTIONS } from './terminalOptions';

it("matches the owner's iTerm2 profile and leaves Option to the Swedish layout", () => {
  expect(TERMINAL_OPTIONS).toMatchObject({
    fontFamily: 'Monaco, Menlo, monospace', fontSize: 13, lineHeight: 1.05, cursorBlink: false,
    macOptionIsMeta: false, macOptionClickForcesSelection: true, scrollback: 10_000, scrollSensitivity: 2,
  });
});
