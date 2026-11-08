import { describe, expect, it } from 'vitest';
import {
  bringOnScreen,
  DEFAULT_LAYOUT,
  dragDivider,
  fitLayout,
  loadLayout,
  saveLayout,
  showOnly,
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
    expect(fitLayout(kept, ['/a'])).toEqual(layout({ shown: ['/a'], weights: { '/a': 1 }, managerHidden: [], managerBeside: [] }));
  });

  it('shows nothing while no project is open', () => {
    expect(fitLayout(layout({ shown: ['/a'] }), []).shown).toEqual([]);
  });
});

describe('the projects on screen', () => {
  it('showOnly puts one project on screen in place of the others', () => {
    expect(showOnly(layout({ shown: ['/a', '/b'] }), '/c').shown).toEqual(['/c']);
  });

  it('toggleBeside adds a project beside the others, and takes it away again', () => {
    const two = toggleBeside(layout({ shown: ['/a'] }), '/b');
    expect(two.shown).toEqual(['/a', '/b']);
    expect(toggleBeside(two, '/a').shown).toEqual(['/b']);
  });

  it('toggleBeside never takes the last project off screen', () => {
    expect(toggleBeside(layout({ shown: ['/a'] }), '/a').shown).toEqual(['/a']);
  });

  it('bringOnScreen leaves a shown project where it is, and otherwise adds it, or shows it alone when one is on screen', () => {
    expect(bringOnScreen(layout({ shown: ['/a', '/b'] }), '/b').shown).toEqual(['/a', '/b']);
    expect(bringOnScreen(layout({ shown: ['/a', '/b'] }), '/c').shown).toEqual(['/a', '/b', '/c']);
    expect(bringOnScreen(layout({ shown: ['/a'] }), '/c').shown).toEqual(['/c']);
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
    const saved = layout({ shown: ['/a', '/b'], arrangement: 'grid', weights: { '/a': 1.5 }, managerHidden: ['/b'], managerBeside: ['/a'] });
    saveLayout({ setItem: (_k, v) => (kept = v) }, saved);
    expect(loadLayout(storage(kept))).toEqual(saved);
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
