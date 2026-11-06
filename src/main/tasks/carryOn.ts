import type { ProgramState } from '../../shared/types';

/** What a resume says to a session that was interrupted mid-turn: Claude starts no turn of its own after a resume. */
export const RESUME_PROMPT = 'Continue where you left off.';
/** What it says instead when Claude was waiting for the owner's answer, so Claude asks again rather than picks one. */
export const ASK_AGAIN_PROMPT = 'The session stopped while you were waiting for my answer. Ask me again.';

/** The states a session is in the middle of a turn in: a blocked one's prompt dies with the process. */
export const inTurn = (state: ProgramState | null): boolean => state === 'working' || state === 'blocked';

/**
 * Where a session's turn was as it ended, from the state it last reported before the end was decided.
 * A resume prompt that never took, as when the launch failed or the app quit at once, leaves the same
 * turn still owed. `askAgain` is left out when the session was not in a turn, so it stays as it was.
 */
export function turnAtEnd(lastState: ProgramState | null, resumePending: boolean): { midTurn: boolean; askAgain?: boolean } {
  return inTurn(lastState) ? { midTurn: true, askAgain: lastState === 'blocked' } : { midTurn: resumePending };
}

/** The prompt a resume sends for a recorded turn: none when it was not interrupted. */
export function resumePromptFor(r: { midTurn?: boolean; askAgain?: boolean }): string | undefined {
  if (!r.midTurn) return undefined;
  return r.askAgain ? ASK_AGAIN_PROMPT : RESUME_PROMPT;
}
