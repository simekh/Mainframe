import { describe, expect, it } from 'vitest';
import { stepIndex } from './imagesStore';

describe('stepIndex', () => {
  it('steps within the list and stops at its ends', () => {
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, -1)).toBe(0);
  });
});
