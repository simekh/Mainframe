import { describe, expect, it } from 'vitest';
import { startArgs } from './startArgs.mjs';

describe.each(['preview', 'dev'])('startArgs(%s)', (command) => {
  const SANDBOXED = [command];
  const UNSANDBOXED = [command, '--noSandbox'];

  it('never turns the sandbox off on macOS or Windows', () => {
    expect(startArgs(command, 'darwin', '1', null)).toEqual(SANDBOXED);
    expect(startArgs(command, 'win32', '1', null)).toEqual(SANDBOXED);
  });

  it('turns it off on a Linux that restricts user namespaces, when the helper is not set up', () => {
    expect(startArgs(command, 'linux', '1\n', null)).toEqual(UNSANDBOXED);
    expect(startArgs(command, 'linux', '1', { uid: 1000, mode: 0o104755 })).toEqual(UNSANDBOXED);
    expect(startArgs(command, 'linux', '1', { uid: 0, mode: 0o100755 })).toEqual(UNSANDBOXED);
  });

  it('keeps the sandbox when the helper is root-owned with the setuid bit', () => {
    expect(startArgs(command, 'linux', '1', { uid: 0, mode: 0o104755 })).toEqual(SANDBOXED);
  });

  it('keeps the sandbox on a Linux that does not restrict user namespaces', () => {
    expect(startArgs(command, 'linux', '0', null)).toEqual(SANDBOXED);
    expect(startArgs(command, 'linux', null, null)).toEqual(SANDBOXED);
  });
});
