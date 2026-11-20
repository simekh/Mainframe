import { expect, it } from 'vitest';
import { IMAGE_LABEL, labelNumbers } from './imageLabels';

it("reads the numbers of Claude Code's labels, in the order they show", () => {
  expect(labelNumbers('❯ [Image #3] see [Image #12]', IMAGE_LABEL.claude!)).toEqual([3, 12]);
});

it('reads a label Claude Code broke at its space onto the next row, indented', () => {
  expect(labelNumbers('❯ [Image #1] [Image\n  #5]', IMAGE_LABEL.claude!)).toEqual([1, 5]);
});

it("reads a label broken with no space left at the break, and none split by a blank line", () => {
  expect(labelNumbers('[Image#2] [Image\n\n#4]', IMAGE_LABEL.claude!)).toEqual([2]);
});

it('text without labels gives none', () => {
  expect(labelNumbers('❯ an image, see Image #3 and [Image]', IMAGE_LABEL.claude!)).toEqual([]);
});

it('reads from the start whatever position the regex was left at, and takes one without the g flag', () => {
  const label = /\[Image #(\d+)\]/g;
  label.lastIndex = 5;
  expect(labelNumbers('[Image #1] [Image #2]', label)).toEqual([1, 2]);
  expect(labelNumbers('[Image #1] [Image #2]', /\[Image #(\d+)\]/)).toEqual([1, 2]);
});
