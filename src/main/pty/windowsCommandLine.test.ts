import { expect, it } from 'vitest';
import { fitsWindowsCommandLine } from './windowsCommandLine';

it('an argument of 15,998 characters fits, and one of 15,999 does not', () => {
  expect(fitsWindowsCommandLine(['a'.repeat(15_998)])).toBe(true);
  expect(fitsWindowsCommandLine(['a'.repeat(15_999)])).toBe(false);
});

it('the arguments add up, each with its quotes and a space', () => {
  expect(fitsWindowsCommandLine(['a'.repeat(8_000), 'a'.repeat(7_997)])).toBe(true);
  expect(fitsWindowsCommandLine(['a'.repeat(8_000), 'a'.repeat(7_998)])).toBe(false);
});
