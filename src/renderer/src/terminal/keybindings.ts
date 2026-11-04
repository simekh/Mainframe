// Sequences from Parallel Code (MIT) src/lib/keybindings/defaults.ts at 97c3558. See THIRD_PARTY_NOTICES.md.

export interface KeyLike {
  type: string;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

export type TerminalAction =
  | { send: string }
  | { scroll: 'line-up' | 'line-down' | 'page-up' | 'page-down' };

const CMD_SENDS: Record<string, string> = {
  ArrowLeft: '\x1b[H', // beginning of line
  ArrowRight: '\x1b[F', // end of line
  Backspace: '\x15', // kill line backward
};

const CMD_SHIFT_SCROLLS: Record<string, 'line-up' | 'line-down' | 'page-up' | 'page-down'> = {
  ArrowUp: 'line-up',
  ArrowDown: 'line-down',
  PageUp: 'page-up',
  PageDown: 'page-down',
};

const isShiftEnter = (e: KeyLike) =>
  e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey;

/**
 * The keydown bindings the terminal handles itself. Option and Ctrl combinations are never
 * matched: Option types characters on the Swedish layout, and Cmd+C/V belong to the Edit menu.
 */
export function matchTerminalBinding(e: KeyLike): TerminalAction | undefined {
  if (e.type !== 'keydown' || e.altKey || e.ctrlKey) return undefined;
  if (isShiftEnter(e)) return { send: '\x1b\r' };
  if (!e.metaKey) return undefined;
  if (!e.shiftKey && e.key in CMD_SENDS) return { send: CMD_SENDS[e.key] };
  if (e.shiftKey && e.key in CMD_SHIFT_SCROLLS) return { scroll: CMD_SHIFT_SCROLLS[e.key] };
  return undefined;
}

/**
 * True for the keypress and keyup of Shift+Enter. Once its keydown has sent ESC CR, a keypress
 * reaching xterm would also send a plain CR and submit the prompt.
 */
export function swallowsKeyEvent(e: KeyLike): boolean {
  return e.type !== 'keydown' && isShiftEnter(e);
}
