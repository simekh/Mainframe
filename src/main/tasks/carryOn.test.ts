import { expect, it } from 'vitest';
import type { ProgramState } from '../../shared/types';
import { resumePromptFor, turnAtEnd, TurnTracker } from './carryOn';

// In a turn the session ends owing it, and only a blocked one asks again; out of one it owes the turn
// only if a resume prompt it was given never took, and askAgain is left as the last turn set it.
it.each([
  ['working', false, { midTurn: true, askAgain: false }],
  ['working', true, { midTurn: true, askAgain: false }],
  ['blocked', false, { midTurn: true, askAgain: true }],
  ['blocked', true, { midTurn: true, askAgain: true }],
  ['idle', false, { midTurn: false }],
  ['idle', true, { midTurn: true }],
  ['done', false, { midTurn: false }],
  ['done', true, { midTurn: true }],
  ['error', false, { midTurn: false }],
  ['error', true, { midTurn: true }],
  [null, false, { midTurn: false }],
  [null, true, { midTurn: true }],
] as [ProgramState | null, boolean, { midTurn: boolean; askAgain?: boolean }][])(
  'a session last %s, with resumePending %s, ends as %j',
  (state, resumePending, ended) => {
    expect(turnAtEnd(state, resumePending)).toStrictEqual(ended);
  },
);

it('resumes a turn that was interrupted by saying to carry on', () => {
  expect(resumePromptFor({ midTurn: true })).toBe('Continue where you left off.');
  expect(resumePromptFor({ midTurn: true, askAgain: false })).toBe('Continue where you left off.');
});

it('resumes a turn that was waiting for the owner by saying to ask again', () => {
  expect(resumePromptFor({ midTurn: true, askAgain: true })).toBe(
    'The session stopped while you were waiting for my answer. Ask me again.',
  );
});

it('sends nothing to a session that was not in a turn, whatever askAgain says', () => {
  expect(resumePromptFor({})).toBeUndefined();
  expect(resumePromptFor({ midTurn: false })).toBeUndefined();
  expect(resumePromptFor({ midTurn: false, askAgain: true })).toBeUndefined();
});

it('a turn is over on done or error, and on idle once it had a turn or had no prompt to take', () => {
  const over = (states: (ProgramState | null)[], startedWithPrompt = true) => {
    const turn = new TurnTracker(false);
    for (const s of states) turn.note(s);
    return turn.over(startedWithPrompt);
  };
  expect(over(['working', 'done'])).toBe(true);
  expect(over(['working', 'error'])).toBe(true);
  expect(over(['working', 'idle'])).toBe(true);
  expect(over(['idle'], false)).toBe(true);
  expect(over([])).toBe(false);
  // The opening prompt has not taken yet.
  expect(over(['idle'])).toBe(false);
  expect(over(['working'])).toBe(false);
  expect(over(['done', 'blocked'])).toBe(false);
  expect(over(['done', null])).toBe(false);
});

it('a turn told to end is not over: it is already ending', () => {
  const turn = new TurnTracker(false);
  turn.note('done');
  turn.end();
  expect(turn.over(true)).toBe(false);
});
