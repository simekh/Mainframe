import { expect, it } from 'vitest';
import { dropIndex, moved, shiftOf } from './railOrder';

it('moved puts the item at its new place', () => {
  expect(moved(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moved(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
});

it("dropIndex counts the other rows whose middle is above the dragged row's middle", () => {
  const mids = [16, 50, 84];
  expect(dropIndex(mids, 0, 16)).toBe(0);
  expect(dropIndex(mids, 0, 55)).toBe(1);
  expect(dropIndex(mids, 0, 200)).toBe(2);
  expect(dropIndex(mids, 2, 40)).toBe(1);
  expect(dropIndex(mids, 2, -30)).toBe(0);
});

it('shiftOf slides the rows between the dragged row and its slot', () => {
  expect([0, 1, 2, 3].map((i) => shiftOf(i, 0, 2))).toEqual([0, -1, -1, 0]);
  expect([0, 1, 2, 3].map((i) => shiftOf(i, 3, 1))).toEqual([0, 1, 1, 0]);
  expect([0, 1, 2].map((i) => shiftOf(i, 1, 1))).toEqual([0, 0, 0]);
});
