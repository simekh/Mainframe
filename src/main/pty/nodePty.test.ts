import * as pty from 'node-pty';
import { beforeEach, expect, it, vi } from 'vitest';
import { spawnNodePty } from './nodePty';

// A factory, so the test doesn't load node-pty's native addon.
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const opts = { name: 'xterm-256color', cwd: '/repo', env: { PATH: '/usr/bin' }, cols: 100, rows: 30 };

beforeEach(() => vi.mocked(pty.spawn).mockClear());

it.each([
  ['win32', true],
  ['darwin', false],
  ['linux', false],
] as const)('on %s it passes useConptyDll: %s with the given options', (platform, useConptyDll) => {
  spawnNodePty(platform)('claude', ['--x'], opts);
  expect(pty.spawn).toHaveBeenCalledWith('claude', ['--x'], { ...opts, useConptyDll });
});

it('gives back the pty node-pty spawned', () => {
  const proc = { pid: 1 } as unknown as ReturnType<typeof pty.spawn>;
  vi.mocked(pty.spawn).mockReturnValueOnce(proc);
  expect(spawnNodePty('darwin')('claude', [], opts)).toBe(proc);
});
