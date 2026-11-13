import type { IDisposable, IModes, IParser } from '@xterm/xterm';

/**
 * Ctrl+Shift+C in the kitty keyboard protocol: the copy key of a program that keeps its own
 * selection, as Claude Code does in fullscreen. Claude Code takes it without the protocol turned on:
 * seen in v2.1.323, not documented (its docs promise Cmd+C only on terminals with the protocol). If a
 * later Claude Code stops, a copy with nothing selected in xterm copies nothing again, as before.
 * OpenCode v2.2.7 ignores it.
 */
export const KITTY_COPY_KEY = '\x1b[99;6u';

const MOUSE_MODES = [9, 1000, 1002, 1003];
const ALTERNATE_SCREEN = [47, 1047, 1049];
const names = (params: (number | number[])[], modes: number[]) => params.some((p) => typeof p === 'number' && modes.includes(p));

/**
 * Watches whether a copy with nothing selected in xterm goes to the program as `KITTY_COPY_KEY`.
 * The program must capture the mouse, so a drag selected inside it, and must speak the kitty
 * keyboard protocol (ask about it, push, pop or set its flags), so it reads the sequence as one key.
 * Any other program reads it as typed text: an older vim with the mouse on would undo six changes.
 *
 * What was spoken counts until the mouse is released, a program enters the alternate screen or the
 * terminal resets, so it never carries over to the next program: Claude Code's editor (Ctrl+G) gets
 * nothing, and Claude Code, which pops the flags but doesn't ask again when it is back, gets the key.
 * Every handler leaves the sequence to xterm too.
 */
export function watchProgramCopy(term: { parser: IParser; modes: IModes }): IDisposable & { canCopy(): boolean } {
  let speaks = false;
  const handlers = [
    ...(['?', '>', '<', '='] as const).map((prefix) =>
      term.parser.registerCsiHandler({ prefix, final: 'u' }, () => {
        speaks = true;
        return false;
      }),
    ),
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (names(params, MOUSE_MODES)) speaks = false;
      return false;
    }),
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (names(params, ALTERNATE_SCREEN)) speaks = false;
      return false;
    }),
    term.parser.registerEscHandler({ final: 'c' }, () => {
      speaks = false;
      return false;
    }),
  ];
  return {
    canCopy: () => speaks && term.modes.mouseTrackingMode !== 'none',
    dispose: () => handlers.forEach((h) => h.dispose()),
  };
}
