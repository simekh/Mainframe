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

/** Where one `claude` process's turn is, from its OSC 7501 reports, until it is told to end. */
export class TurnTracker {
  private lastState: ProgramState | null = null;
  /** Set by `end`: what the session reports on the way out is not what its turn was. */
  ending = false;

  /** `resumePending`: it was launched with a carry-on prompt, which has not taken until it works or blocks. */
  constructor(private resumePending: boolean) {}

  note(state: ProgramState | null): void {
    if (this.ending) return;
    this.lastState = state;
    if (inTurn(state)) this.resumePending = false;
  }

  /** Where its turn was as the end was decided, to record on its task or chat. */
  end(): { midTurn: boolean; askAgain?: boolean } {
    this.ending = true;
    return turnAtEnd(this.lastState, this.resumePending);
  }
}

/** The prompt a resume sends for a recorded turn: none when it was not interrupted. */
export function resumePromptFor(r: { midTurn?: boolean; askAgain?: boolean }): string | undefined {
  if (!r.midTurn) return undefined;
  return r.askAgain ? ASK_AGAIN_PROMPT : RESUME_PROMPT;
}
