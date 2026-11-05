// Adapted from Parallel Code (MIT): src/store/tasks.ts (sendPrompt, pasteDelayMs) and src/lib/paste-text.ts at 97c3558. See THIRD_PARTY_NOTICES.md.
import type { Terminal } from '@xterm/xterm';

/**
 * C0 controls but tab and newline, DEL, C1 controls, and invisible and bidi characters. Claude Code
 * holds a paste that contains them for review ("Removed N invisible characters") instead of submitting it.
 */
const HELD_BACK = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export function cleanMessageText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(HELD_BACK, '');
}

/** Claude Code takes a bracketed paste in asynchronously: an Enter that comes too soon joins the paste. */
export function submitDelayMs(text: string): number {
  const lines = text.split('\n').length;
  return Math.min(500, Math.max(50, lines * 15));
}

/**
 * Sends the text to the terminal's program as a paste, then presses Enter. Everything goes through
 * xterm, so it reaches the PTY the way typed input does.
 */
export function sendMessage(
  term: Terminal,
  text: string,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
): void {
  const cleaned = cleanMessageText(text);
  // The message field holds the focus, so xterm told a program that tracks it that it lost it.
  if (term.modes.sendFocusMode) term.input('\x1b[I');
  // Adds bracketed-paste markers when the program asked for them, and turns each LF into CR.
  term.paste(cleaned);
  schedule(() => term.input('\r'), submitDelayMs(cleaned));
}
