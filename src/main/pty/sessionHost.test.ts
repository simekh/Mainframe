import { describe, it, expect } from 'vitest';
import { SessionHost, type LaunchFiles, type PtyLike, type SpawnPty } from './sessionHost';
import { OSC7501_SUPPORT_REPLY } from '../status/osc7501';

function setup(
  env: Record<string, string> = { PATH: '/usr/bin' },
  existing: { executables: string[]; folders: string[] } = { executables: ['/usr/bin/claude'], folders: ['/repo'] },
  platform: NodeJS.Platform = 'darwin',
) {
  const log: string[] = [];
  const calls: Parameters<SpawnPty>[] = [];
  const ptys: Array<PtyLike & { emit(d: string): void; exit(code: number): void; killed: boolean; broken: boolean }> = [];
  const spawnPty: SpawnPty = (...args) => {
    calls.push(args);
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    // A pty that has just exited refuses both, as node-pty's does.
    const refuseWhenBroken = () => {
      if (p.broken) throw new Error('Cannot resize a pty that has already exited');
    };
    const p = {
      killed: false,
      broken: false,
      onData: (cb: typeof onData) => { onData = cb; },
      onExit: (cb: typeof onExit) => { onExit = cb; },
      write: (d: string) => { refuseWhenBroken(); log.push(`write:${d}`); },
      resize: (c: number, r: number) => { refuseWhenBroken(); log.push(`resize:${c}x${r}`); },
      pause: () => log.push('pause'), resume: () => log.push('resume'),
      kill: (signal?: string) => { p.killed = true; log.push(`kill:${signal ?? 'default'}`); },
      emit: (d: string) => onData(d), exit: (code: number) => onExit({ exitCode: code }),
    };
    ptys.push(p);
    return p;
  };
  const files: LaunchFiles = {
    isExecutableFile: (path) => existing.executables.includes(path),
    isDirectory: (path) => existing.folders.includes(path),
  };
  const host = new SessionHost({ spawnPty, outputBatchMs: 0, env, files, platform });
  const listener = {
    onData: (d: Uint8Array) => log.push(`data:${Buffer.from(d).toString()}`),
    onStatus: (s: { state: string } | null) => log.push(`status:${s ? s.state : 'none'}`),
    onExit: (e: { exitCode: number }) => log.push(`exit:${e.exitCode}`),
  };
  return { host, ptys, calls, log, listener };
}

const spec = { argv: ['claude', '--x'], cwd: '/repo', cols: 100, rows: 30 };

it('spawns the absolute path of argv[0] with the rest as args, in cwd, with size and env', () => {
  const { host, calls, listener } = setup();
  host.spawn('s1', spec, listener);
  expect(calls[0]).toEqual(['/usr/bin/claude', ['--x'], { name: 'xterm-256color', cwd: '/repo', env: { PATH: '/usr/bin' }, cols: 100, rows: 30 }]);
});

it('on Windows it looks claude.exe up on Path and spawns its absolute path', () => {
  const { host, calls, listener } = setup({ Path: 'C:\\bin' }, { executables: ['C:\\bin\\claude.exe'], folders: ['C:\\repo'] }, 'win32');
  host.spawn('s1', { ...spec, cwd: 'C:\\repo' }, listener);
  expect(calls[0][0]).toBe('C:\\bin\\claude.exe');
});

it("looks the binary up on the PTY's PATH, not the app's", () => {
  const { host, calls, listener } = setup({ PATH: '/nowhere:/pty/bin' }, { executables: ['/pty/bin/claude'], folders: ['/repo'] });
  host.spawn('s1', spec, listener);
  expect(calls).toHaveLength(1);
});

it('refuses a binary that is not on PATH, naming it and the PATH, and spawns nothing', () => {
  const { host, calls, listener } = setup({ PATH: '/usr/bin:/bin' }, { executables: [], folders: ['/repo'] });
  expect(() => host.spawn('s1', spec, listener)).toThrow('claude was not found on PATH (/usr/bin:/bin)');
  expect(calls).toEqual([]);
  expect(host.has('s1')).toBe(false);
});

it('refuses a binary given by a path that is missing or not executable', () => {
  const { host, calls, listener } = setup();
  const missing = { ...spec, argv: ['/nonexistent/claude'] };
  expect(() => host.spawn('s1', missing, listener)).toThrow('/nonexistent/claude was not found, or is not an executable file');
  expect(calls).toEqual([]);
});

it('refuses a working folder that is not a folder', () => {
  const { host, calls, listener } = setup();
  expect(() => host.spawn('s1', { ...spec, cwd: '/gone' }, listener)).toThrow('/gone is not a folder');
  expect(calls).toEqual([]);
});

it('answers an OSC 7501 query before forwarding the output that carried it', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('hi\x1b]7501;?\x1b\\\x1b[c');
  expect(log).toEqual([`write:${OSC7501_SUPPORT_REPLY}`, 'data:hi\x1b]7501;?\x1b\\\x1b[c']);
});

it('reports status from OSC 7501 reports', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('\x1b]7501;state=working\x07');
  expect(log).toContain('status:working');
});

// The exit first: a status of none for a session the renderer still shows as running reads as
// "Starting…", and moves a card that needed the owner to Working on its way to Closed.
it('on exit sends remaining output, reports the exit, then drops working status and forgets the session', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('\x1b]7501;state=working\x07');
  log.length = 0;
  ptys[0].exit(0);
  expect(log).toEqual(['exit:0', 'status:none']);
  expect(host.has('s1')).toBe(false);
  expect(host.status('s1')).toBeNull();
  host.write('s1', 'x');
  expect(log).toEqual(['exit:0', 'status:none']);
});

it("status gives a running session's current status, for a window that attaches again", () => {
  const { host, ptys, listener } = setup();
  host.spawn('s1', spec, listener);
  expect(host.status('s1')).toBeNull();
  ptys[0].emit('\x1b]7501;state=blocked:kind=question\x07');
  expect(host.status('s1')).toMatchObject({ state: 'blocked', kind: 'question' });
  expect(host.status('nope')).toBeNull();
});

it('refuses a second session with the same id', () => {
  const { host, listener } = setup();
  host.spawn('s1', spec, listener);
  expect(() => host.spawn('s1', spec, listener)).toThrow('s1');
});

it('passes write, resize, pause and resume through', () => {
  const { host, log, listener } = setup();
  host.spawn('s1', spec, listener);
  host.write('s1', 'ls\r'); host.resize('s1', 90, 20); host.pause('s1'); host.resume('s1');
  expect(log).toEqual(['write:ls\r', 'resize:90x20', 'pause', 'resume']);
});

// Only Windows' ConPTY refuses a write or resize in the second before node-pty reports the exit.
// Elsewhere a pty's error is a real one and goes up as it comes.
it.each<NodeJS.Platform>(['darwin', 'linux'])('on %s the error of a pty that refuses a write or a resize goes up', (platform) => {
  const { host, ptys, log, listener } = setup({ PATH: '/usr/bin' }, undefined, platform);
  host.spawn('s1', spec, listener);
  ptys[0].broken = true;
  expect(() => host.write('s1', 'x')).toThrow('Cannot resize a pty that has already exited');
  expect(() => host.resize('s1', 90, 20)).toThrow('Cannot resize a pty that has already exited');
  expect(log).toEqual([]);
});

it('on Windows it drops the error of a pty that has just exited when written to or resized', () => {
  const { host, ptys, log, listener } = setup(
    { Path: 'C:\\bin' },
    { executables: ['C:\\bin\\claude.exe'], folders: ['C:\\repo'] },
    'win32',
  );
  host.spawn('s1', { ...spec, cwd: 'C:\\repo' }, listener);
  ptys[0].broken = true;
  expect(() => host.write('s1', 'x')).not.toThrow();
  expect(() => host.resize('s1', 90, 20)).not.toThrow();
  expect(log).toEqual([]);
});

it('kill hangs up on the session, or kills it outright with SIGKILL', () => {
  const { host, log, listener } = setup();
  host.spawn('s1', spec, listener);
  host.kill('s1');
  host.kill('s1', 'SIGKILL');
  expect(log).toEqual(['kill:default', 'kill:SIGKILL']);
});

it('killAll kills every running session', () => {
  const { host, ptys, listener } = setup();
  host.spawn('a', spec, listener);
  host.spawn('b', spec, listener);
  host.killAll();
  expect(ptys.map((p) => p.killed)).toEqual([true, true]);
});

// Windows has no signals: node-pty's kill throws when given one, and a second kill can crash the
// process (node-pty issue 983). The project's close and Quit both kill, so each pty is killed once.
describe('on Windows', () => {
  const windows = () =>
    setup({ Path: 'C:\\bin' }, { executables: ['C:\\bin\\claude.exe'], folders: ['C:\\repo'] }, 'win32');
  const winSpec = { ...spec, cwd: 'C:\\repo' };

  it('kill never passes a signal and kills a pty once, however often it is asked', () => {
    const { host, log, listener } = windows();
    host.spawn('s1', winSpec, listener);
    host.kill('s1');
    host.kill('s1', 'SIGKILL');
    expect(log).toEqual(['kill:default']);
  });

  it('kill with SIGKILL alone kills with no signal', () => {
    const { host, log, listener } = windows();
    host.spawn('s1', winSpec, listener);
    host.kill('s1', 'SIGKILL');
    expect(log).toEqual(['kill:default']);
  });

  it('killAll kills nothing a kill has already killed, and each of the others once', () => {
    const { host, ptys, log, listener } = windows();
    host.spawn('a', winSpec, listener);
    host.spawn('b', winSpec, listener);
    host.kill('a');
    host.killAll();
    host.killAll();
    expect(log).toEqual(['kill:default', 'kill:default']);
    expect(ptys.map((p) => p.killed)).toEqual([true, true]);
  });
});
