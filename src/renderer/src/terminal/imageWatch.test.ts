import { expect, it } from 'vitest';
import { newLabelNumbers } from './imageWatch';

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
