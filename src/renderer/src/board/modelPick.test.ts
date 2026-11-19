import { describe, expect, it } from 'vitest';
import type { ModelChoices } from '../../../shared/types';
import { effortsFor, keptEffort, SWITCH_HELP } from './modelPick';

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

describe('SWITCH_HELP', () => {
  it("names Claude Code's switch commands and that a reopen starts on the pick", () => {
    expect(SWITCH_HELP.claude).toContain('/model');
    expect(SWITCH_HELP.claude).toContain('/effort');
    expect(SWITCH_HELP.claude).toContain('A reopen starts on the pick made here');
  });

  it("doesn't promise OpenCode a reopen on the pick", () => {
    expect(SWITCH_HELP.opencode).not.toContain('reopen');
  });
});
