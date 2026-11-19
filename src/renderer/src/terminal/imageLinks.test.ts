import { describe, expect, it } from 'vitest';
import { IMAGE_LABEL, labelRanges } from '../../../shared/imageLabels';

describe('labelRanges', () => {
  it('gives the columns and number of each label on a line', () => {
    expect(labelRanges('❯ [Image #3] see [Image #12]', IMAGE_LABEL.claude!)).toEqual([
      { start: 2, end: 12, number: 3 },
      { start: 17, end: 28, number: 12 },
    ]);
  });

  it('finds none on a line without a label', () => {
    expect(labelRanges('❯ [Image] #3', IMAGE_LABEL.claude!)).toEqual([]);
  });
});
