import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  dragDivider,
  fitLayout,
  focusOn,
  loadLayout,
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
