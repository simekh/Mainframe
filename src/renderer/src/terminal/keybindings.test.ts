import { it, expect } from 'vitest';
import { matchTerminalBinding, swallowsKeyEvent, type KeyLike } from './keybindings';

const key = (k: Partial<KeyLike>): KeyLike =>
  ({ type: 'keydown', key: '', metaKey: false, shiftKey: false, altKey: false, ctrlKey: false, ...k });

it.each([
  [{ key: 'Enter', shiftKey: true }, '\x1b\r'],
  [{ key: 'ArrowLeft', metaKey: true }, '\x1b[H'],
  [{ key: 'ArrowRight', metaKey: true }, '\x1b[F'],
  [{ key: 'Backspace', metaKey: true }, '\x15'],
])('%o sends %j', (k, send) => {
  expect(matchTerminalBinding(key(k))).toEqual({ send });
});

it.each([
  ['ArrowUp', 'line-up'], ['ArrowDown', 'line-down'], ['PageUp', 'page-up'], ['PageDown', 'page-down'],
] as const)('Cmd+Shift+%s scrolls %s', (k, scroll) => {
  expect(matchTerminalBinding(key({ key: k, metaKey: true, shiftKey: true }))).toEqual({ scroll });
});

it.each([
  { key: '@', altKey: true }, { key: '[', altKey: true }, { key: ']', altKey: true }, { key: '{', altKey: true, shiftKey: true },
  { key: '|', altKey: true }, { key: '\\', altKey: true, shiftKey: true }, { key: 'Dead', altKey: true },
  { key: 'ArrowLeft', altKey: true }, { key: 'Backspace', altKey: true }, { key: 'Enter' },
  { key: 'c', metaKey: true }, { key: 'v', metaKey: true }, { key: 'Enter', shiftKey: true, type: 'keyup' },
])('leaves %o to xterm and the menu', (k) => {
  expect(matchTerminalBinding(key(k))).toBeUndefined();
});

it('swallows the keypress and keyup of Shift+Enter, and nothing else', () => {
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true, type: 'keypress' }))).toBe(true);
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true, type: 'keyup' }))).toBe(true);
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true }))).toBe(false);
  expect(swallowsKeyEvent(key({ key: 'Enter', type: 'keypress' }))).toBe(false);
  expect(swallowsKeyEvent(key({ key: '@', altKey: true, type: 'keypress' }))).toBe(false);
});
