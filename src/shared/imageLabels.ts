import type { AgentName } from './types';

/**
 * The label each agent shows for an image it took, with the number in the first group; null where the label's number
 * doesn't name one image of the conversation, so its images get no number. Checked by pasting images into each agent:
 * Claude Code 2.1.328 shows `[Image #1]` and counts on across the conversation. OpenCode 2.2.7 shows `[Image 1]` but
 * starts again at 1 in each message, and Codex 0.169.0 (not run here: it needs signing in) does the same in its source.
 */
export const IMAGE_LABEL: Record<AgentName, RegExp | null> = {
  claude: /\[Image #(\d+)\]/g,
  opencode: null,
  codex: null,
};

/**
 * The file types every agent takes as an image when its path is pasted, in lower case. Claude Code and OpenCode checked by
 * pasting (BMP, TIFF and HEIC are left as text); Codex from the image formats its 0.169.0 source builds in.
 */
export const IMAGE_FILE_TYPES: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/**
 * Where each label is in the text, in the order they show: its first index, the index after it, and its number. On a line
 * whose characters stand one per column, those are columns. It matches with a fresh copy of `label`, so the position a
 * `g` regex keeps never shifts it. Callers must not use `.test` or `.exec` on the shared `IMAGE_LABEL` regexes.
 */
export function labelRanges(text: string, label: RegExp): { start: number; end: number; number: number }[] {
  const all = new RegExp(label.source, label.flags.includes('g') ? label.flags : `${label.flags}g`);
  return [...text.matchAll(all)].map((m) => ({ start: m.index, end: m.index + m[0].length, number: Number(m[1]) }));
}

/** The numbers of the labels in the text, in the order they show. */
export const labelNumbers = (text: string, label: RegExp): number[] => labelRanges(text, label).map((r) => r.number);
