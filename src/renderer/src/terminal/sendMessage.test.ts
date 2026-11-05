import type { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { cleanMessageText, sendMessage, submitDelayMs } from './sendMessage';

describe('cleanMessageText', () => {
  it('keeps text, newlines and tabs and drops what holds a paste', () => {
    // ​ is the zero-width space between d and e.
    expect(cleanMessageText('a\r\nb\rc\td​e\x1b[31mf\x7f')).toBe('a\nb\nc\tde[31mf');
  });

  it('drops C1 controls and the invisible ranges, and keeps the characters around them', () => {
    const invisible = ['\x80', '\x9f', '‏', '‪', '‮', '⁠', '⁤', '﻿'];
    expect(cleanMessageText(`x${invisible.join('')}y`)).toBe('xy');
    // Just outside each range.
    expect(cleanMessageText('\xa0‐⁥﻾')).toBe('\xa0‐⁥﻾');
  });

  it('keeps emoji, other astral characters and letters outside ASCII', () => {
    expect(cleanMessageText('å ä ö 🍎 𝔸 👍🏽 ✓')).toBe('å ä ö 🍎 𝔸 👍🏽 ✓');
  });
});

describe('submitDelayMs', () => {
  it('grows with the lines, from 50 to 500 ms', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
    expect(submitDelayMs(lines(1))).toBe(50);
    expect(submitDelayMs(lines(10))).toBe(150);
    expect(submitDelayMs(lines(100))).toBe(500);
  });
});

describe('sendMessage', () => {
  /** Records what sendMessage does with the only parts of a terminal it uses. */
  function fakeTerminal(sendFocusMode: boolean) {
    const calls: string[] = [];
    const term = {
      modes: { sendFocusMode },
      input: (data: string) => void calls.push(`input ${JSON.stringify(data)}`),
      paste: (data: string) => void calls.push(`paste ${JSON.stringify(data)}`),
    } as unknown as Terminal;
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const schedule = (fn: () => void, ms: number) => void scheduled.push({ fn, ms });
    return { term, calls, scheduled, schedule };
  }

  it('reports the focus back when the program asked, pastes the cleaned text, then presses Enter after the delay', () => {
    const { term, calls, scheduled, schedule } = fakeTerminal(true);
    sendMessage(term, 'one\r\ntwo​', schedule);
    expect(calls).toEqual(['input "\\u001b[I"', 'paste "one\\ntwo"']);
    expect(scheduled.map((s) => s.ms)).toEqual([50]);
    scheduled[0].fn();
    expect(calls.at(-1)).toBe('input "\\r"');
  });

  it("sends no focus report to a program that didn't ask for them", () => {
    const { term, calls, scheduled, schedule } = fakeTerminal(false);
    sendMessage(term, 'hello', schedule);
    scheduled[0].fn();
    expect(calls).toEqual(['paste "hello"', 'input "\\r"']);
  });
});
