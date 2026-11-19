import { expect, it } from 'vitest';
import { IMAGE_LABEL, labelNumbers } from './imageLabels';

it("reads the numbers of Claude Code's labels, in the order they show", () => {
  expect(labelNumbers('❯ [Image #3] see [Image #12]', IMAGE_LABEL.claude!)).toEqual([3, 12]);
});

it('text without labels gives none', () => {
  expect(labelNumbers('❯ an image, see Image #3 and [Image]', IMAGE_LABEL.claude!)).toEqual([]);
});
