import type { DiffLine } from '../../shared/types';

/** A file's diff in git's patch output: its hunks, or 'binary' where git prints no lines. */
export type PatchBlock = DiffLine[][] | 'binary';

const HEADER = 'diff --git ';
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * The path a header names. The diff is run with equal, prefixed paths (a/P b/P), so the unquoted form
 * splits exactly at its middle, even where P holds spaces or " b/".
 */
function headerPath(line: string): string {
  const rest = line.slice(HEADER.length);
  if (rest[0] !== '"') return rest.slice(2, 2 + (rest.length - 5) / 2);

  // A quoted path: skip the first string, decode the second.
  let i = 1;
  while (rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1;
  i += 3; // closing quote, space, opening quote
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  while (i < rest.length && rest[i] !== '"') {
    const c = rest[i];
    if (c !== '\\') {
      bytes.push(...encoder.encode(c));
      i += 1;
    } else if (/[0-7]/.test(rest[i + 1])) {
      bytes.push(parseInt(rest.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(ESCAPES[rest[i + 1]]);
      i += 2;
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes)).slice(2);
}

/** Splits `git diff` output into its files' blocks, keyed by path, with each line numbered. */
export function parsePatch(raw: string): Map<string, PatchBlock> {
  const blocks = new Map<string, PatchBlock>();
  let path: string | null = null;
  let hunk: DiffLine[] | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith(HEADER)) {
      path = headerPath(line);
      hunk = null;
      if (!blocks.has(path)) blocks.set(path, []);
      continue;
    }
    if (path === null) continue;

    // Only `@@` lines can open a hunk: the regex need not run on every line of a large patch.
    const header = line.startsWith('@@') ? HUNK.exec(line) : null;
    if (header) {
      hunk = [];
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      const current = blocks.get(path)!;
      if (current !== 'binary') current.push(hunk);
      continue;
    }
    if (hunk === null) {
      if (line.startsWith('Binary files ')) blocks.set(path, 'binary');
      continue;
    }

    const text = line.endsWith('\r') ? line.slice(1, -1) : line.slice(1);
    if (line[0] === ' ') hunk.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
    else if (line[0] === '-') hunk.push({ kind: 'remove', text, oldLine: oldLine++, newLine: null });
    else if (line[0] === '+') hunk.push({ kind: 'add', text, oldLine: null, newLine: newLine++ });
  }
  return blocks;
}
