import { describe, expect, it } from 'vitest';
import { startPolling } from './poller';

/** A clock run by hand: each timer waits until the test fires it. */
function fakeTimers() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
      pending.push(timer);
      return () => void (timer.cancelled = true);
    },
    /** Fires the timer waiting now, and says how long it waited. */
    fire: () => {
      const timer = pending.shift()!;
      if (!timer.cancelled) timer.fn();
      return timer.ms;
    },
    live: () => pending.filter((t) => !t.cancelled).length,
  };
}

describe('startPolling', () => {
  it('polls at once and then every interval while active', () => {
    const t = fakeTimers();
    let polls = 0;
    startPolling({ every: () => 60_000, active: () => true, poll: () => polls++, setTimer: t.setTimer });
    expect(polls).toBe(1);
    expect(t.fire()).toBe(60_000);
    expect(polls).toBe(2);
    t.fire();
    expect(polls).toBe(3);
  });

  it('skips a tick while inactive and polls on the next active one', () => {
    const t = fakeTimers();
    let active = true;
    let polls = 0;
    startPolling({ every: () => 60_000, active: () => active, poll: () => polls++, setTimer: t.setTimer });
    active = false;
    t.fire();
    expect(polls).toBe(1);
    active = true;
    t.fire();
    expect(polls).toBe(2);
  });

  it('uses the interval each time', () => {
    const t = fakeTimers();
    let every = 60_000;
    let polls = 0;
    startPolling({ every: () => every, active: () => true, poll: () => polls++, setTimer: t.setTimer });
    every = 120_000;
    // A new interval is read at the next wait: it never polls ahead of the timer.
    expect(polls).toBe(1);
    expect(t.fire()).toBe(60_000);
    expect(t.fire()).toBe(120_000);
  });

  it('stop ends it', () => {
    const t = fakeTimers();
    let polls = 0;
    const stop = startPolling({ every: () => 60_000, active: () => true, poll: () => polls++, setTimer: t.setTimer });
    stop();
    expect(t.live()).toBe(0);
    t.fire();
    expect(polls).toBe(1);
  });
});
