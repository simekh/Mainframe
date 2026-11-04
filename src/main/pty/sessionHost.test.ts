import { it, expect } from 'vitest';
import { SessionHost, type PtyLike, type SpawnPty } from './sessionHost';
import { OSC7501_SUPPORT_REPLY } from '../status/osc7501';

function setup() {
  const log: string[] = [];
  const calls: Parameters<SpawnPty>[] = [];
  const ptys: Array<PtyLike & { emit(d: string): void; exit(code: number): void; killed: boolean }> = [];
  const spawnPty: SpawnPty = (...args) => {
    calls.push(args);
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const p = {
      killed: false,
      onData: (cb: typeof onData) => { onData = cb; },
      onExit: (cb: typeof onExit) => { onExit = cb; },
      write: (d: string) => log.push(`write:${d}`),
      resize: (c: number, r: number) => log.push(`resize:${c}x${r}`),
      pause: () => log.push('pause'), resume: () => log.push('resume'),
      kill: () => { p.killed = true; },
      emit: (d: string) => onData(d), exit: (code: number) => onExit({ exitCode: code }),
    };
    ptys.push(p);
    return p;
  };
  const host = new SessionHost({ spawnPty, outputBatchMs: 0, env: { PATH: '/usr/bin' } });
  const listener = {
    onData: (d: Uint8Array) => log.push(`data:${Buffer.from(d).toString()}`),
    onStatus: (s: { state: string } | null) => log.push(`status:${s ? s.state : 'none'}`),
    onExit: (e: { exitCode: number }) => log.push(`exit:${e.exitCode}`),
  };
  return { host, ptys, calls, log, listener };
}

const spec = { argv: ['claude', '--x'], cwd: '/repo', cols: 100, rows: 30 };

it('spawns argv[0] with the rest as args, in cwd, with size and env', () => {
  const { host, calls, listener } = setup();
  host.spawn('s1', spec, listener);
  expect(calls[0]).toEqual(['claude', ['--x'], { name: 'xterm-256color', cwd: '/repo', env: { PATH: '/usr/bin' }, cols: 100, rows: 30 }]);
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

it('on exit sends remaining output, drops working status, reports the exit and forgets the session', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('\x1b]7501;state=working\x07');
  log.length = 0;
  ptys[0].exit(0);
  expect(log).toEqual(['status:none', 'exit:0']);
  expect(host.has('s1')).toBe(false);
  host.write('s1', 'x');
  expect(log).toEqual(['status:none', 'exit:0']);
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

it('killAll kills every running session', () => {
  const { host, ptys, listener } = setup();
  host.spawn('a', spec, listener);
  host.spawn('b', spec, listener);
  host.killAll();
  expect(ptys.map((p) => p.killed)).toEqual([true, true]);
});
