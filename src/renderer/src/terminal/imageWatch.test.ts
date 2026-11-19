import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageWatch, newLabelNumbers } from './imageWatch';

it('takes the new label above the ones seen before', () => {
  expect(newLabelNumbers([2], [1, 2, 3], 1)).toEqual([3]);
});

it('gives nothing while no new label shows: the paste went into a question', () => {
  expect(newLabelNumbers([2], [2], 1)).toBeNull();
});

it('takes as many labels as images were pasted, in order, with none seen before', () => {
  expect(newLabelNumbers([], [4, 5], 2)).toEqual([4, 5]);
});

it('gives nothing until every pasted image has its label', () => {
  expect(newLabelNumbers([3], [3, 4], 2)).toBeNull();
});

describe('the watch', () => {
  let screen: number[];
  let recorded: { path: string; number: number }[][];
  let watch: ReturnType<typeof createImageWatch>;

  beforeEach(() => {
    vi.useFakeTimers();
    screen = [];
    recorded = [];
    watch = createImageWatch(
      () => screen,
      (added) => recorded.push(added),
    );
  });

  afterEach(() => {
    watch.dispose();
    vi.useRealTimers();
  });

  it('a paste whose label comes after its watch gave up, then another paste: both recorded with their own numbers', () => {
    screen = [1, 2];
    watch.paste(['/a.png'], [1, 2]);
    vi.advanceTimersByTime(4000);
    expect(recorded).toEqual([]);

    expect(watch.joinable()).toBe(true);
    watch.paste(['/b.png'], [1, 2]);
    screen = [1, 2, 3];
    vi.advanceTimersByTime(500);
    expect(recorded).toEqual([]);
    screen = [1, 2, 3, 4];
    vi.advanceTimersByTime(200);
    expect(recorded).toEqual([[{ path: '/a.png', number: 3 }, { path: '/b.png', number: 4 }]]);
  });

  it('a paste that never gets its label, then a labelled one within the window: nothing recorded, never a wrong number', () => {
    screen = [1, 2];
    watch.paste(['/a.png'], [1, 2]);
    vi.advanceTimersByTime(4000);
    watch.paste(['/b.png'], [1, 2]);
    screen = [1, 2, 3];
    vi.advanceTimersByTime(4000);
    expect(recorded).toEqual([]);
  });

  it('a drop of two files with a label already on screen takes the next two', () => {
    screen = [1];
    watch.paste(['/a.png', '/b.png'], [1]);
    screen = [1, 2, 3];
    vi.advanceTimersByTime(200);
    expect(recorded).toEqual([[{ path: '/a.png', number: 2 }, { path: '/b.png', number: 3 }]]);
  });

  it('more new labels than images pasted: none recorded', () => {
    watch.paste(['/a.png'], []);
    screen = [1, 2];
    vi.advanceTimersByTime(4000);
    expect(recorded).toEqual([]);
  });

  it('a label seen while a watch had nothing to record raises the floor for the next watch', () => {
    // Two dropped, one labelled: the watch gives up with #1 seen and unrecorded. A repaint then hides it.
    watch.paste(['/a.png', '/b.png'], []);
    screen = [1];
    vi.advanceTimersByTime(4000);
    screen = [];
    vi.advanceTimersByTime(10_000);
    expect(watch.joinable()).toBe(false);

    watch.paste(['/c.png'], []);
    screen = [1];
    vi.advanceTimersByTime(500);
    expect(recorded).toEqual([]);
    screen = [2];
    vi.advanceTimersByTime(200);
    expect(recorded).toEqual([[{ path: '/c.png', number: 2 }]]);
  });
});
