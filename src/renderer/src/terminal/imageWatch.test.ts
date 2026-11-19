import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageWatch, newLabelNumbers, screenText } from './imageWatch';

describe('screenText', () => {
  /** A buffer row as xterm gives it: its cells, which it trims on the right when asked. */
  const row = (cells: string, isWrapped = false) => ({ isWrapped, translateToString: (trimRight = false) => (trimRight ? cells.trimEnd() : cells) });

  it('joins a soft-wrapped row onto the one above, so a label cut by the wrap reads whole', () => {
    expect(screenText([row('> look at [Image'), row(' #3] please   ', true), row('next line   ')])).toBe('> look at [Image #3] please\nnext line');
  });

  it('keeps the trailing spaces of a row the next one continues: the wrap may fall on a space', () => {
    expect(screenText([row('> [Image '), row('#3]', true)])).toBe('> [Image #3]');
  });

  it('a first row that continues one above the screen starts the text', () => {
    expect(screenText([row('#2]', true), row(''), row('[Image #3]')])).toBe('#2]\n\n[Image #3]');
  });
});

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
  let forgotten: number[][];
  let removable: boolean;
  let watch: ReturnType<typeof createImageWatch>;

  beforeEach(() => {
    vi.useFakeTimers();
    screen = [];
    recorded = [];
    forgotten = [];
    removable = false;
    watch = createImageWatch(
      () => screen,
      (added) => recorded.push(added),
      (numbers) => forgotten.push(numbers),
      () => removable,
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

  describe('an image taken off the prompt before it is sent', () => {
    /** #1 pasted and recorded while the agent waits for a message. */
    const pasteOne = () => {
      removable = true;
      watch.paste(['/a.png'], []);
      screen = [1];
      vi.advanceTimersByTime(200);
      expect(recorded).toEqual([[{ path: '/a.png', number: 1 }]]);
    };

    it('is forgotten once its label has been gone a second', () => {
      pasteOne();
      screen = [];
      watch.check();
      vi.advanceTimersByTime(999);
      expect(forgotten).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(forgotten).toEqual([[1]]);
    });

    it('two labels that go at different times are each forgotten a second after their own', () => {
      removable = true;
      watch.paste(['/a.png', '/b.png'], []);
      screen = [1, 2];
      vi.advanceTimersByTime(200);
      screen = [1];
      watch.check();
      vi.advanceTimersByTime(500);
      screen = [];
      watch.check();
      vi.advanceTimersByTime(500);
      expect(forgotten).toEqual([[2]]);
      vi.advanceTimersByTime(1000);
      expect(forgotten).toEqual([[2], [1]]);
    });

    it('a label gone only for a moment, as in a repaint, keeps its image', () => {
      pasteOne();
      screen = [];
      watch.check();
      vi.advanceTimersByTime(500);
      screen = [1];
      watch.check();
      vi.advanceTimersByTime(2000);
      expect(forgotten).toEqual([]);
    });

    it('once a turn begins, its image is kept even when the label scrolls off', () => {
      pasteOne();
      watch.settle();
      screen = [];
      watch.check();
      vi.advanceTimersByTime(2000);
      expect(forgotten).toEqual([]);
    });

    it('one recorded while the agent was not waiting for a message is never forgotten', () => {
      watch.paste(['/a.png'], []);
      screen = [1];
      vi.advanceTimersByTime(200);
      removable = true;
      screen = [];
      watch.check();
      vi.advanceTimersByTime(2000);
      expect(forgotten).toEqual([]);
    });

    it('comes back with its number when its label does, as a deleted placeholder can be put back', () => {
      pasteOne();
      screen = [];
      watch.check();
      vi.advanceTimersByTime(1000);
      screen = [1];
      watch.check();
      expect(recorded).toEqual([[{ path: '/a.png', number: 1 }], [{ path: '/a.png', number: 1 }]]);
    });
  });
});
