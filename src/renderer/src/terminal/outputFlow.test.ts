import { it, expect } from 'vitest';
import { OutputFlow } from './outputFlow';

function setup() {
  const log: string[] = [];
  const pending: Array<() => void> = [];
  let scheduled: (() => void) | undefined;
  const flow = new OutputFlow({
    write: (d, done) => { log.push(`write:${d.length}`); pending.push(done); },
    pause: () => log.push('pause'),
    resume: () => log.push('resume'),
    schedule: (f) => { scheduled = f; return () => { scheduled = undefined; }; },
  });
  const runFrame = () => { const f = scheduled; scheduled = undefined; f?.(); };
  const finishWrites = () => { while (pending.length) pending.shift()!(); };
  return { flow, log, runFrame, finishWrites };
}
const bytes = (n: number) => new Uint8Array(n);

it('writes queued chunks as one payload on the next frame', () => {
  const { flow, log, runFrame } = setup();
  flow.push(bytes(10)); flow.push(bytes(20));
  expect(log).toEqual([]);
  runFrame();
  expect(log).toEqual(['write:30']);
});

it('writes at once when 64 KiB are queued', () => {
  const { flow, log } = setup();
  flow.push(bytes(64 * 1024));
  expect(log).toEqual(['write:65536']);
});

it('pauses the PTY once above 256 KiB unwritten and resumes once below 32 KiB', () => {
  const { flow, log, runFrame, finishWrites } = setup();
  for (let i = 0; i < 5; i++) flow.push(bytes(64 * 1024));
  expect(log.filter((l) => l === 'pause')).toEqual(['pause']);
  finishWrites(); runFrame(); finishWrites();
  expect(log.filter((l) => l === 'resume')).toEqual(['resume']);
  expect(log.at(-1)).toBe('resume');
});

it('whenDrained runs after the last write has finished, or at once when idle', () => {
  const { flow, runFrame, finishWrites } = setup();
  let drained = 0;
  flow.whenDrained(() => drained++);
  expect(drained).toBe(1);
  flow.push(bytes(10));
  flow.whenDrained(() => drained++);
  runFrame();
  expect(drained).toBe(1);
  finishWrites();
  expect(drained).toBe(2);
});
