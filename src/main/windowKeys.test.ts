import { describe, expect, it } from 'vitest';
import { isDevToolsKey, isSettingsKey, zoomKey } from './windowKeys';

const ctrlShiftI = { type: 'keyDown', key: 'I', control: true, shift: true, alt: false, meta: false };

describe('isDevToolsKey', () => {
  it.each(['I', 'i'])('is Ctrl+Shift+I pressed down, with key %j', (key) => {
    expect(isDevToolsKey({ ...ctrlShiftI, key })).toBe(true);
  });

  it.each([
    ['its keyUp', { ...ctrlShiftI, type: 'keyUp' }],
    ['Ctrl+I', { ...ctrlShiftI, shift: false, key: 'i' }],
    ['Ctrl+Shift+Alt+I, which AltGr+Shift+I arrives as on Windows', { ...ctrlShiftI, alt: true }],
    ['Meta+Shift+I', { ...ctrlShiftI, control: false, meta: true }],
    ['Ctrl+Shift+J', { ...ctrlShiftI, key: 'J' }],
  ])('is not %s', (_name, input) => {
    expect(isDevToolsKey(input)).toBe(false);
  });
});

describe('isSettingsKey', () => {
  const ctrlComma = { type: 'keyDown', key: ',', control: true, shift: false, alt: false, meta: false };

  it('is Ctrl+, pressed down', () => {
    expect(isSettingsKey(ctrlComma)).toBe(true);
  });

  it.each([
    ['Ctrl+Shift+,', { ...ctrlComma, shift: true }],
    ['Ctrl+Alt+,', { ...ctrlComma, alt: true }],
    ['Meta+,', { ...ctrlComma, control: false, meta: true }],
    ['its keyUp', { ...ctrlComma, type: 'keyUp' }],
    ['Ctrl+.', { ...ctrlComma, key: '.' }],
  ])('is not %s', (_name, input) => {
    expect(isSettingsKey(input)).toBe(false);
  });
});

describe('zoomKey', () => {
  const key = (k: string, mods: { control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
    type: 'keyDown',
    key: k,
    control: false,
    shift: false,
    alt: false,
    meta: false,
    ...mods,
  });

  it.each([
    ['+', 'in'],
    ['=', 'in'],
    ['-', 'out'],
    ['0', 'reset'],
  ] as const)('is Cmd+%s on the Mac and Ctrl+%s elsewhere: %s', (k, step) => {
    expect(zoomKey(key(k, { meta: true }), true)).toBe(step);
    expect(zoomKey(key(k, { control: true }), false)).toBe(step);
  });

  it('takes Shift, as + is Shift+= on many layouts', () => {
    expect(zoomKey(key('+', { meta: true, shift: true }), true)).toBe('in');
  });

  it.each([
    ['Ctrl+= on the Mac', key('=', { control: true }), true],
    ['Cmd+= off the Mac', key('=', { meta: true }), false],
    ['Cmd+Ctrl+= on the Mac', key('=', { meta: true, control: true }), true],
    ['Ctrl+Alt+=, which AltGr+= arrives as on Windows', key('=', { control: true, alt: true }), false],
    ['its keyUp', { ...key('=', { control: true }), type: 'keyUp' }, false],
    ['Ctrl+1', key('1', { control: true }), false],
    ['= alone', key('='), false],
  ])('is nothing for %s', (_name, input, onMac) => {
    expect(zoomKey(input, onMac)).toBeNull();
  });
});
