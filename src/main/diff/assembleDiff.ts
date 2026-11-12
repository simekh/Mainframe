import type { ChangedFile, DiffLine, DiffNote, FileDiff } from '../../shared/types';
import type { PatchBlock } from './parsePatch';

/** An untracked file as read from disk: git's patch has nothing for it. */
export type UntrackedContent = { kind: 'text'; lines: string[] } | { kind: 'binary' } | { kind: 'tooLarge' } | { kind: 'notRead' };

interface DiffLimits {
  /** A file with more lines than this shows a note instead. */
  fileLines: number;
  /** Lines shown across the whole diff, clicked file first. */
  totalLines: number;
  /** A file with more text than this shows a note instead: a few long lines can be as slow to lay out as many. */
  fileChars: number;
  /** Text shown across the whole diff, for the same reason. */
  totalChars: number;
}

/** parsePatch stops collecting a file's lines at `fileLines`, so the two share it. */
export const DIFF_LIMITS: DiffLimits = {
  fileLines: 3000,
  totalLines: 15000,
  // Also git.ts's cap on an untracked file's bytes, checked before it is read: the same limit for ASCII
  // text, and a stricter one for text of several bytes a character.
  fileChars: 1024 * 1024,
  totalChars: 4 * 1024 * 1024,
};

/** The clicked file first, then the rest in their order: it gets the limits' room before any other. */
export const focusFirst = <T>(items: T[], isFocus: (item: T) => boolean): T[] => [
  ...items.filter(isFocus),
  ...items.filter((item) => !isFocus(item)),
];

const noteOnly = (f: ChangedFile | FileDiff, note: DiffNote): FileDiff => ({ ...f, hunks: [], note });

function untrackedFile(f: ChangedFile, content: UntrackedContent | undefined): FileDiff {
  // git lists a nested repository as its folder, with a trailing slash.
  if (f.path.endsWith('/')) return noteOnly(f, 'repository');
  if (content === undefined) return noteOnly(f, 'noLines'); // went away since the listing
  if (content.kind === 'binary') return noteOnly(f, 'binary');
  if (content.kind === 'tooLarge') return noteOnly(f, 'tooLarge');
  if (content.kind === 'notRead') return noteOnly(f, 'notShown'); // left unread to bound memory
  if (content.lines.length === 0) return { ...noteOnly(f, 'empty'), added: 0, removed: 0 };
  const hunk: DiffLine[] = content.lines.map((text, i) => ({ kind: 'add', text, oldLine: null, newLine: i + 1 }));
  return { ...f, added: hunk.length, removed: 0, hunks: [hunk], note: null };
}

function trackedFile(f: ChangedFile, block: PatchBlock | undefined): FileDiff {
  if (block === 'binary') return noteOnly(f, 'binary');
  // No block: the file changed after the listing, or was only touched. An empty block is a mode change,
  // or an empty file added or removed.
  if (block === undefined) return noteOnly(f, 'noLines');
  if (block.length === 0) return noteOnly(f, f.status === 'A' || f.status === 'D' ? 'empty' : 'modeOnly');
  return { ...f, hunks: block, note: null };
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
  const sizeOf = (f: FileDiff): { lines: number; chars: number } => {
    let lines = 0;
    let chars = 0;
    for (const hunk of f.hunks) {
      lines += hunk.length;
      for (const line of hunk) chars += line.text.length;
    }
    return { lines, chars };
  };

  const limited = files.map((f) => {
    const size = sizeOf(f);
    return { f: size.lines > limits.fileLines || size.chars > limits.fileChars ? noteOnly(f, 'tooLarge') : f, size };
  });

  // Files that already carry a note cost nothing, and keep it.
  const walk = focusFirst(limited, ({ f }) => f.path === focus);
  const notShown = new Set<string>();
  const total = { lines: 0, chars: 0 };
  for (const { f, size } of walk) {
    if (f.note !== null) continue;
    if (notShown.size === 0 && total.lines + size.lines <= limits.totalLines && total.chars + size.chars <= limits.totalChars) {
      total.lines += size.lines;
      total.chars += size.chars;
    } else notShown.add(f.path);
  }
  return limited.map(({ f }) => (notShown.has(f.path) ? noteOnly(f, 'notShown') : f));
}
