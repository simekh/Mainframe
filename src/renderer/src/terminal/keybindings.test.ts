import { describe, it, expect } from 'vitest';
import { matchTerminalBinding, swallowsKeyEvent, type KeyLike } from './keybindings';

const key = (k: Partial<KeyLike>): KeyLike =>
  ({ type: 'keydown', key: '', metaKey: false, shiftKey: false, altKey: false, ctrlKey: false, ...k });

it.each([
  [{ key: 'Enter', shiftKey: true }, '\x1b\r'],
  [{ key: 'ArrowLeft', metaKey: true }, '\x1b[H'],
  [{ key: 'ArrowRight', metaKey: true }, '\x1b[F'],
  [{ key: 'Backspace', metaKey: true }, '\x15'],
])('%o sends %j', (k, send) => {
  expect(matchTerminalBinding(key(k), 'darwin', false)).toEqual({ send });
});

it.each([
  ['ArrowUp', 'line-up'], ['ArrowDown', 'line-down'], ['PageUp', 'page-up'], ['PageDown', 'page-down'],
] as const)('Cmd+Shift+%s scrolls %s', (k, scroll) => {
  expect(matchTerminalBinding(key({ key: k, metaKey: true, shiftKey: true }), 'darwin', false)).toEqual({ scroll });
});

it.each([
  { key: '@', altKey: true }, { key: '[', altKey: true }, { key: ']', altKey: true }, { key: '{', altKey: true, shiftKey: true },
  { key: '|', altKey: true }, { key: '\\', altKey: true, shiftKey: true }, { key: 'Dead', altKey: true },
  { key: 'ArrowLeft', altKey: true }, { key: 'Backspace', altKey: true }, { key: 'Enter' },
  { key: 'c', metaKey: true }, { key: 'v', metaKey: true }, { key: 'Enter', shiftKey: true, type: 'keyup' },
])('leaves %o to xterm and the menu', (k) => {
  expect(matchTerminalBinding(key(k), 'darwin', false)).toBeUndefined();
});

it.each([
  { key: 'C', ctrlKey: true, shiftKey: true }, { key: 'c', ctrlKey: true }, { key: 'v', ctrlKey: true },
  { key: 'Backspace', ctrlKey: true },
])('on the Mac, with or without a selection, leaves %o to xterm', (k) => {
  expect(matchTerminalBinding(key(k), 'darwin', false)).toBeUndefined();
  expect(matchTerminalBinding(key(k), 'darwin', true)).toBeUndefined();
});

describe.each(['win32', 'linux'] as const)('on %s', (platform) => {
  const match = (k: Partial<KeyLike>, hasSelection = false) => matchTerminalBinding(key(k), platform, hasSelection);

  it.each([true, false])('Ctrl+Shift+C copies, also with nothing selected (selection: %s)', (hasSelection) => {
    expect(match({ key: 'C', ctrlKey: true, shiftKey: true }, hasSelection)).toEqual({ clipboard: 'copy' });
    expect(match({ key: 'c', ctrlKey: true, shiftKey: true }, hasSelection)).toEqual({ clipboard: 'copy' });
  });

  it('Ctrl+C copies and clears a selection, and is left to xterm, which sends ^C, without one', () => {
    expect(match({ key: 'c', ctrlKey: true }, true)).toEqual({ clipboard: 'copy-and-clear' });
    expect(match({ key: 'C', ctrlKey: true }, true)).toEqual({ clipboard: 'copy-and-clear' });
    expect(match({ key: 'c', ctrlKey: true }, false)).toBeUndefined();
  });

  it.each([
    { key: 'v', ctrlKey: true }, { key: 'V', ctrlKey: true }, { key: 'V', ctrlKey: true, shiftKey: true },
  ])('%o pastes', (k) => {
    expect(match(k)).toEqual({ clipboard: 'paste' });
    expect(match(k, true)).toEqual({ clipboard: 'paste' });
  });

  it.each([['ArrowUp', 'line-up'], ['ArrowDown', 'line-down']] as const)('Ctrl+Shift+%s scrolls %s', (k, scroll) => {
    expect(match({ key: k, ctrlKey: true, shiftKey: true })).toEqual({ scroll });
  });

  it('Shift+Enter sends ESC CR', () => {
    expect(match({ key: 'Enter', shiftKey: true })).toEqual({ send: '\x1b\r' });
  });

  // Ctrl+Alt is AltGr on Windows: AltGr+2 types @ on Nordic and German layouts.
  it.each([
    { key: 'c', ctrlKey: true, altKey: true }, { key: 'v', ctrlKey: true, altKey: true }, { key: '2', ctrlKey: true, altKey: true },
    { key: '@', ctrlKey: true, altKey: true }, { key: 'C', ctrlKey: true, altKey: true, shiftKey: true },
    { key: 'V', ctrlKey: true, altKey: true, shiftKey: true }, { key: 'Backspace', ctrlKey: true, altKey: true },
    { key: 'ArrowUp', ctrlKey: true, altKey: true, shiftKey: true },
    { key: 'ArrowLeft', metaKey: true }, { key: 'c', metaKey: true }, { key: 'Home' }, { key: 'End' },
    { key: 'PageUp', shiftKey: true }, { key: 'w', ctrlKey: true }, { key: 'a', ctrlKey: true },
    { key: 'c', ctrlKey: true, type: 'keyup' }, { key: 'v', ctrlKey: true, type: 'keyup' },
  ])('leaves %o to xterm, with or without a selection', (k) => {
    expect(match(k, false)).toBeUndefined();
    expect(match(k, true)).toBeUndefined();
  });
});

it("Ctrl+Backspace sends ESC DEL, Claude Code's previous word, on Linux, and is left to xterm's ^H on Windows", () => {
  expect(matchTerminalBinding(key({ key: 'Backspace', ctrlKey: true }), 'linux', false)).toEqual({ send: '\x1b\x7f' });
  expect(matchTerminalBinding(key({ key: 'Backspace', ctrlKey: true }), 'win32', false)).toBeUndefined();
});

it('swallows the keypress and keyup of Shift+Enter, and nothing else', () => {
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true, type: 'keypress' }))).toBe(true);
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true, type: 'keyup' }))).toBe(true);
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true }))).toBe(false);
  expect(swallowsKeyEvent(key({ key: 'Enter', type: 'keypress' }))).toBe(false);
  expect(swallowsKeyEvent(key({ key: '@', altKey: true, type: 'keypress' }))).toBe(false);
});
