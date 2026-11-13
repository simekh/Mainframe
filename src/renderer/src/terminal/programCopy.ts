import type { IDisposable, IModes, IParser } from '@xterm/xterm';

/**
 * Ctrl+Shift+C in the kitty keyboard protocol: the copy key of a program that keeps its own
 * selection, as Claude Code does in fullscreen. Claude Code takes it without the protocol turned on:
 * seen in v2.1.323, not documented (its docs promise Cmd+C only on terminals with the protocol). If a
 * later Claude Code stops, a copy with nothing selected in xterm copies nothing again, as before.
 */
export const KITTY_COPY_KEY = '\x1b[99;6u';

/**
 * Watches whether a copy with nothing selected in xterm goes to the program as `KITTY_COPY_KEY`.
 * The program must capture the mouse, so a drag selected inside it, and must have asked whether the
 * terminal speaks the kitty keyboard protocol (CSI ? u), so it reads the sequence as one key. Any
 * other program reads it as typed text: an older vim with the mouse on would undo six changes.
 * xterm still answers the question as before, which with the protocol off is not at all.
 */
export function watchProgramCopy(term: { parser: IParser; modes: IModes }): IDisposable & { canCopy(): boolean } {
  let asked = false;
  const query = term.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
    asked = true;
    return false;
  });
  return {
    canCopy: () => asked && term.modes.mouseTrackingMode !== 'none',
    dispose: () => query.dispose(),
  };
}
