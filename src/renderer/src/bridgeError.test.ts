import { it, expect } from 'vitest';
import { errorMessage } from './bridgeError';

it("drops the prefix invoke puts on an error from main, and keeps other messages as they are", () => {
  expect(errorMessage(new Error("Error invoking remote method 'pty:spawn': Error: claude was not found on PATH (/usr/bin)")))
    .toBe('claude was not found on PATH (/usr/bin)');
  expect(errorMessage(new Error("Error invoking remote method 'tasks:start': TypeError: x is not a function")))
    .toBe('TypeError: x is not a function');
  expect(errorMessage(new Error('ENOTDIR: not a directory'))).toBe('ENOTDIR: not a directory');
  expect(errorMessage('plain')).toBe('plain');
});
