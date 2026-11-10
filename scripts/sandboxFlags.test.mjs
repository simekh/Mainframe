import { describe, expect, it } from 'vitest';
import { sandboxFlags } from './sandboxFlags.mjs';

describe('sandboxFlags', () => {
  it('never turns the sandbox off on macOS or Windows', () => {
    expect(sandboxFlags('darwin', '1', null)).toEqual([]);
    expect(sandboxFlags('win32', '1', null)).toEqual([]);
  });

  it('turns it off on a Linux that restricts user namespaces, when the helper is not set up', () => {
    expect(sandboxFlags('linux', '1\n', null)).toEqual(['--noSandbox']);
    expect(sandboxFlags('linux', '1', { uid: 1000, mode: 0o104755 })).toEqual(['--noSandbox']);
    expect(sandboxFlags('linux', '1', { uid: 0, mode: 0o100755 })).toEqual(['--noSandbox']);
  });

  it('keeps the sandbox when the helper is root-owned with the setuid bit', () => {
    expect(sandboxFlags('linux', '1', { uid: 0, mode: 0o104755 })).toEqual([]);
  });

  it('keeps the sandbox on a Linux that does not restrict user namespaces', () => {
    expect(sandboxFlags('linux', '0', null)).toEqual([]);
    expect(sandboxFlags('linux', null, null)).toEqual([]);
  });
});
