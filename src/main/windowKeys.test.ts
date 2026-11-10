import { describe, expect, it } from 'vitest';
import { isDevToolsKey } from './windowKeys';

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
