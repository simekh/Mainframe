import { describe, expect, it } from 'vitest';
import type { ModelChoices } from '../../../shared/types';
import { effortsFor, keptEffort } from './modelPick';

const choices: ModelChoices = {
  models: [
    { id: 'big', name: 'Big', efforts: ['low', 'high', 'max'] },
    { id: 'plain', name: 'Plain', efforts: [] },
  ],
  defaultEfforts: ['low', 'high'],
};

describe('effortsFor', () => {
  it('offers nothing while the choices load', () => {
    expect(effortsFor(undefined, undefined)).toEqual([]);
    expect(effortsFor(undefined, 'big')).toEqual([]);
  });

  it("offers the default efforts for Default and a model's own for a model", () => {
    expect(effortsFor(choices, undefined)).toEqual(['low', 'high']);
    expect(effortsFor(choices, 'big')).toEqual(['low', 'high', 'max']);
    expect(effortsFor(choices, 'plain')).toEqual([]);
  });
});

describe('keptEffort', () => {
  it('keeps an effort still offered and drops one that is not', () => {
    expect(keptEffort(['low', 'high'], 'max')).toBeUndefined();
    expect(keptEffort(['low', 'high'], 'high')).toBe('high');
    expect(keptEffort(['low', 'high'], undefined)).toBeUndefined();
  });
});
