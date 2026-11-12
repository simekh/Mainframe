import { describe, expect, it } from 'vitest';
import { isDevToolsKey, isSettingsKey } from './windowKeys';

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
