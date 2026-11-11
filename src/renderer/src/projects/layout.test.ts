import { describe, expect, it } from 'vitest';
import {
  columnsOf,
  DEFAULT_LAYOUT,
  dragDivider,
  fitLayout,
  focusOn,
  growOf,
  loadLayout,
  panePlace,
  saveLayout,
  toggleBeside,
  toggleManager,
  managerShown,
  type Layout,
} from './layout';

const layout = (over: Partial<Layout>): Layout => ({ ...DEFAULT_LAYOUT, ...over });

describe('fitLayout', () => {
  it('shows the first project when none of the open ones is on screen', () => {
    expect(fitLayout(DEFAULT_LAYOUT, ['/a', '/b']).shown).toEqual(['/a']);
  });

  it('drops the projects that are no longer open, and what it kept for them', () => {
    const kept = layout({ shown: ['/a', '/gone'], weights: { '/a': 1, '/gone': 2 }, managerHidden: ['/gone'], managerBeside: ['/gone'] });
    expect(fitLayout(kept, ['/a'])).toEqual(
      layout({ shown: ['/a'], weights: { '/a': 1 }, managerHidden: [], managerBeside: [], focused: '/a' }),
    );
  });

  it('shows nothing while no project is open', () => {
    expect(fitLayout(layout({ shown: ['/a'] }), []).shown).toEqual([]);
  });

  it('keeps the focus on a project on screen', () => {
    expect(fitLayout(layout({ shown: ['/a', '/b'], focused: '/b' }), ['/a', '/b']).focused).toBe('/b');
    expect(fitLayout(layout({ shown: ['/a', '/gone'], focused: '/gone' }), ['/a']).focused).toBe('/a');
    expect(fitLayout(DEFAULT_LAYOUT, ['/a']).focused).toBe('/a');
    expect(fitLayout(layout({ shown: ['/a'], focused: '/a' }), []).focused).toBeNull();
  });
});

describe('the projects on screen', () => {
  it('toggleBeside adds a project beside the others and focuses it, and takes it away again', () => {
    const two = toggleBeside(layout({ shown: ['/a'], focused: '/a' }), '/b');
    expect(two).toMatchObject({ shown: ['/a', '/b'], focused: '/b' });
    expect(toggleBeside(two, '/a')).toMatchObject({ shown: ['/b'], focused: '/b' });
    expect(toggleBeside(two, '/b')).toMatchObject({ shown: ['/a'], focused: '/a' });
  });

  it('toggleBeside hands the focus of the one it takes away to its neighbour, the one before it if it has one', () => {
    const three = layout({ shown: ['/a', '/b', '/c'] });
    expect(toggleBeside({ ...three, focused: '/c' }, '/c').focused).toBe('/b');
    expect(toggleBeside({ ...three, focused: '/b' }, '/b').focused).toBe('/a');
    expect(toggleBeside({ ...three, focused: '/a' }, '/a').focused).toBe('/b');
    expect(toggleBeside({ ...three, focused: '/a' }, '/c').focused).toBe('/a');
  });

  it('toggleBeside never takes the last project off screen', () => {
    expect(toggleBeside(layout({ shown: ['/a'] }), '/a').shown).toEqual(['/a']);
  });

  it('focusOn focuses a project on screen where it is', () => {
    expect(focusOn(layout({ shown: ['/a', '/b'], focused: '/a' }), '/b')).toMatchObject({ shown: ['/a', '/b'], focused: '/b' });
  });

  it("focusOn puts a project off screen in the focused one's place, at its width, and leaves the others", () => {
    const two = layout({ shown: ['/a', '/b', '/c'], focused: '/b', weights: { '/a': 0.5, '/b': 1.5, '/c': 1 } });
    const swapped = focusOn(two, '/d');
    expect(swapped).toMatchObject({ shown: ['/a', '/d', '/c'], focused: '/d' });
    expect(swapped.weights).toMatchObject({ '/a': 0.5, '/d': 1.5, '/c': 1 });
    expect(focusOn(layout({ shown: ['/a'], focused: '/a' }), '/b')).toMatchObject({ shown: ['/b'], focused: '/b' });
    expect(focusOn(DEFAULT_LAYOUT, '/a')).toMatchObject({ shown: ['/a'], focused: '/a' });
  });
});

describe("a project's manager column", () => {
  it('shows while its project is alone on screen, until the owner hides it', () => {
    const alone = layout({ shown: ['/a'] });
    expect(managerShown(alone, '/a')).toBe(true);
    const hidden = toggleManager(alone, '/a');
    expect(managerShown(hidden, '/a')).toBe(false);
    expect(managerShown(toggleManager(hidden, '/a'), '/a')).toBe(true);
  });

  it('stays hidden beside other projects, until the owner shows it there', () => {
    const beside = layout({ shown: ['/a', '/b'] });
    expect(managerShown(beside, '/a')).toBe(false);
    const shown = toggleManager(beside, '/a');
    expect(managerShown(shown, '/a')).toBe(true);
    expect(managerShown(shown, '/b')).toBe(false);
    // Alone again, the project's column is as the owner left it there.
    expect(managerShown({ ...shown, shown: ['/a'] }, '/a')).toBe(true);
  });
});

describe('dragDivider', () => {
  it('moves the divider by the pixels dragged, keeping the total', () => {
    // Two equal panes, 1000 px in all: a 100 px drag makes them 600 and 400.
    expect(dragDivider([1, 1], 0, 100, 1000, 300)).toEqual([1.2, 0.8]);
  });

  it('stops each pane at its minimum', () => {
    expect(dragDivider([1, 1], 0, 400, 1000, 300)).toEqual([1.4, 0.6]);
    expect(dragDivider([1, 1], 0, -400, 1000, 300)).toEqual([0.6, 1.4]);
  });

  it('changes only the two panes beside the divider', () => {
    expect(dragDivider([1, 1, 1], 1, -50, 900, 100)).toEqual([1, 0.8333, 1.1667]);
  });
});

describe('columnsOf', () => {
  const grid = (n: number) => layout({ shown: ['/a', '/b', '/c', '/d', '/e'].slice(0, n), arrangement: 'grid' });

  it('counts each project on screen as a column side by side', () => {
    expect(columnsOf(layout({ shown: ['/a', '/b', '/c'] }))).toBe(3);
  });

  it("gives the grid the square root's columns, rounded up", () => {
    expect([1, 3, 4, 5].map((n) => columnsOf(grid(n)))).toEqual([1, 2, 2, 3]);
  });
});

describe('panePlace', () => {
  const none = { first: false, top: false, last: false };

  it('puts every project side by side in the top row, the first at its start and the last at its end', () => {
    const three = layout({ shown: ['/a', '/b', '/c'] });
    expect(panePlace(three, '/a')).toEqual({ first: true, top: true, last: false });
    expect(panePlace(three, '/b')).toEqual({ first: false, top: true, last: false });
    expect(panePlace(three, '/c')).toEqual({ first: false, top: true, last: true });
  });

  it("ends the window's top row with the grid's top row, whose last is not the last on screen", () => {
    const three = layout({ shown: ['/a', '/b', '/c'], arrangement: 'grid' });
    expect(panePlace(three, '/b')).toEqual({ first: false, top: true, last: true });
    expect(panePlace(three, '/c')).toEqual(none);
    const five = layout({ shown: ['/a', '/b', '/c', '/d', '/e'], arrangement: 'grid' });
    expect(panePlace(five, '/c').last).toBe(true);
    expect(panePlace(five, '/d')).toEqual(none);
  });

  it('is first, top and last alone on screen, and none of them off screen', () => {
    expect(panePlace(layout({ shown: ['/a'] }), '/a')).toEqual({ first: true, top: true, last: true });
    expect(panePlace(layout({ shown: ['/a'] }), '/b')).toEqual(none);
  });
});

describe('growOf', () => {
  it('fills the row with a pane shown alone whose dragged weight fell below 1', () => {
    // Its weight from a drag beside /b, which has gone off screen.
    expect(growOf(layout({ shown: ['/a'], weights: { '/a': 0.6, '/b': 1.4 } }), '/a')).toBe(1);
  });

  it('shares the row by weight, all of it, when the weights on screen add up to less than 1', () => {
    const l = layout({ shown: ['/a', '/c'], weights: { '/a': 0.6, '/c': 0.2 } });
    expect(growOf(l, '/a')).toBeCloseTo(0.75);
    expect(growOf(l, '/c')).toBeCloseTo(0.25);
  });

  it('counts a project with no weight of its own as 1', () => {
    const l = layout({ shown: ['/a', '/b'], weights: { '/a': 3 } });
    expect(growOf(l, '/a')).toBeCloseTo(0.75);
    expect(growOf(l, '/b')).toBeCloseTo(0.25);
  });
});

describe('loadLayout', () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it('reads what saveLayout kept', () => {
    let kept: string | null = null;
    const saved = layout({
      shown: ['/a', '/b'],
      arrangement: 'grid',
      weights: { '/a': 1.5 },
      managerHidden: ['/b'],
      managerBeside: ['/a'],
      focused: '/b',
    });
    saveLayout({ setItem: (_k, v) => (kept = v) }, saved);
    expect(loadLayout(storage(kept))).toEqual(saved);
  });

  it('reads a layout saved before projects had a focus', () => {
    const { focused: _none, ...before } = layout({ shown: ['/a'] });
    expect(loadLayout(storage(JSON.stringify(before)))).toEqual(layout({ shown: ['/a'], focused: null }));
  });

  it.each([
    ['nothing saved', null],
    ['not JSON', '{'],
    ['a wrong arrangement', JSON.stringify({ ...DEFAULT_LAYOUT, arrangement: 'stack' })],
    ['a non-path shown', JSON.stringify({ ...DEFAULT_LAYOUT, shown: [3] })],
    ['a bad weight', JSON.stringify({ ...DEFAULT_LAYOUT, weights: { '/a': 'big' } })],
  ])('starts from the default with %s', (_case, value) => {
    expect(loadLayout(storage(value))).toEqual(DEFAULT_LAYOUT);
  });
});
