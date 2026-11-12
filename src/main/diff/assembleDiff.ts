import type { ChangedFile, DiffLine, DiffNote, FileDiff } from '../../shared/types';
import type { PatchBlock } from './parsePatch';

/** An untracked file as read from disk: git's patch has nothing for it. */
export type UntrackedContent = { kind: 'text'; lines: string[] } | { kind: 'binary' } | { kind: 'tooLarge' };

export interface DiffLimits {
  /** A file with more lines than this shows a note instead. */
  fileLines: number;
  /** Lines shown across the whole diff, clicked file first. */
  totalLines: number;
}

export const DIFF_LIMITS: DiffLimits = { fileLines: 3000, totalLines: 15000 };

const noteOnly = (f: ChangedFile, note: DiffNote, counts: Partial<FileDiff> = {}): FileDiff => ({
  path: f.path,
  status: f.status,
  added: f.added,
  removed: f.removed,
  hunks: [],
  note,
  ...counts,
});

function untrackedFile(f: ChangedFile, content: UntrackedContent | undefined): FileDiff {
  if (content === undefined) return noteOnly(f, 'noLines'); // went away since the listing
  if (content.kind === 'binary') return noteOnly(f, 'binary');
  if (content.kind === 'tooLarge') return noteOnly(f, 'tooLarge');
  if (content.lines.length === 0) return noteOnly(f, 'empty', { added: 0, removed: 0 });
  const hunk: DiffLine[] = content.lines.map((text, i) => ({ kind: 'add', text, oldLine: null, newLine: i + 1 }));
  return { path: f.path, status: f.status, added: hunk.length, removed: 0, hunks: [hunk], note: null };
}

function trackedFile(f: ChangedFile, block: PatchBlock | undefined): FileDiff {
  if (block === 'binary') return noteOnly(f, 'binary');
  // No block: the file changed after the listing. An empty block is a mode change, or an empty file added or removed.
  if (block === undefined) return noteOnly(f, 'noLines');
  if (block.length === 0) return noteOnly(f, f.status === 'A' || f.status === 'D' ? 'empty' : 'noLines');
  return { path: f.path, status: f.status, added: f.added, removed: f.removed, hunks: block, note: null };
}

/**
 * Joins the changed-files listing (the panel's files, statuses and counts) with git's patch and the untracked
 * files' contents, within the limits. The clicked file is served first, so it is shown even where the whole
 * diff is too large.
 */
export function assembleDiff(
  listed: ChangedFile[],
  blocks: Map<string, PatchBlock>,
  untracked: Map<string, UntrackedContent>,
  focus: string,
  limits: DiffLimits = DIFF_LIMITS,
): FileDiff[] {
  const files = listed.map((f) => (f.status === '?' ? untrackedFile(f, untracked.get(f.path)) : trackedFile(f, blocks.get(f.path))));
  const lineCount = (f: FileDiff): number => f.hunks.reduce((n, h) => n + h.length, 0);

  const limited = files.map((f) => (lineCount(f) > limits.fileLines ? noteOnly(f, 'tooLarge') : f));

  // Files that already carry a note cost nothing, and keep it.
  const walk = [...limited.filter((f) => f.path === focus), ...limited.filter((f) => f.path !== focus)];
  const notShown = new Set<string>();
  let total = 0;
  for (const f of walk) {
    if (f.note !== null) continue;
    if (notShown.size === 0 && total + lineCount(f) <= limits.totalLines) total += lineCount(f);
    else notShown.add(f.path);
  }
  return limited.map((f) => (notShown.has(f.path) ? noteOnly(f, 'notShown') : f));
}
