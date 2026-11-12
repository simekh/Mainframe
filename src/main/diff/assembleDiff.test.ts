import { describe, expect, it } from 'vitest';
import type { ChangedFile, DiffLine } from '../../shared/types';
import { assembleDiff, DIFF_LIMITS, type UntrackedContent } from './assembleDiff';
import type { PatchBlock } from './parsePatch';

/** The real limits, with some made small. */
const limits = (small: Partial<typeof DIFF_LIMITS>): typeof DIFF_LIMITS => ({ ...DIFF_LIMITS, ...small });

const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, oldLine: null, newLine: n });
const file = (path: string, status: ChangedFile['status'], added: number | null, removed: number | null): ChangedFile => ({
  path,
  status,
  added,
  removed,
});
/** A block of one hunk with `n` added lines. */
const lines = (n: number): PatchBlock => [Array.from({ length: n }, (_, i) => add(`l${i}`, i + 1))];
const none = new Map<string, UntrackedContent>();

describe('assembleDiff', () => {
  it("gives each listed file its patch, in the listing's order", () => {
    const listed = [file('b.txt', 'M', 1, 0), file('a.txt', 'A', 2, 0)];
    const blocks = new Map<string, PatchBlock>([
      ['a.txt', lines(2)],
      ['b.txt', lines(1)],
    ]);
    const files = assembleDiff(listed, blocks, none, 'a.txt');
    expect(files.map((f) => f.path)).toEqual(['b.txt', 'a.txt']);
    expect(files[0]).toEqual({ path: 'b.txt', status: 'M', added: 1, removed: 0, hunks: blocks.get('b.txt'), note: null });
    expect(files[1]).toEqual({ path: 'a.txt', status: 'A', added: 2, removed: 0, hunks: blocks.get('a.txt'), note: null });
  });

  it('notes binary, mode-only, empty and missing files', () => {
    const listed = [
      file('bin', 'M', null, null),
      file('mode', 'M', 0, 0),
      file('type', 'T', 0, 0),
      file('empty', 'A', 0, 0),
      file('gone', 'D', 0, 0),
      file('late', 'M', 1, 1),
    ];
    const blocks = new Map<string, PatchBlock>([
      ['bin', 'binary'],
      ['mode', []],
      ['type', []],
      ['empty', []],
      ['gone', []],
    ]);
    const files = assembleDiff(listed, blocks, none, 'bin');
    expect(files.map((f) => [f.note, f.hunks])).toEqual([
      ['binary', []],
      ['modeOnly', []],
      ['modeOnly', []],
      ['empty', []],
      ['empty', []],
      ['noLines', []],
    ]);
  });

  it('shows untracked text files as added, and notes the rest', () => {
    const listed = [
      file('t', '?', null, null),
      file('e', '?', null, null),
      file('b', '?', null, null),
      file('l', '?', null, null),
      file('x', '?', null, null),
    ];
    const untracked = new Map<string, UntrackedContent>([
      ['t', { kind: 'text', lines: ['u1', 'u2'] }],
      ['e', { kind: 'text', lines: [] }],
      ['b', { kind: 'binary' }],
      ['l', { kind: 'tooLarge' }],
    ]);
    const files = assembleDiff(listed, new Map(), untracked, 't');
    expect(files[0]).toMatchObject({ added: 2, removed: 0, hunks: [[add('u1', 1), add('u2', 2)]], note: null });
    expect(files[1]).toMatchObject({ added: 0, hunks: [], note: 'empty' });
    expect(files[2]).toMatchObject({ hunks: [], note: 'binary' });
    expect(files[3]).toMatchObject({ added: null, hunks: [], note: 'tooLarge' });
    expect(files[4]).toMatchObject({ hunks: [], note: 'noLines' });
  });

  it('shows an untracked file that was not read as not shown', () => {
    const files = assembleDiff([file('n', '?', null, null)], new Map(), new Map([['n', { kind: 'notRead' }]]), 'n');
    expect(files[0]).toMatchObject({ added: null, hunks: [], note: 'notShown' });
  });

  it('marks a file over the per-file limit too large, keeping its counts', () => {
    const listed = [file('big', 'M', 3, 1)];
    const files = assembleDiff(listed, new Map([['big', lines(4)]]), none, 'big', limits({ fileLines: 3, totalLines: 100 }));
    expect(files[0]).toMatchObject({ added: 3, removed: 1, hunks: [], note: 'tooLarge' });
  });

  it('marks a file over the per-file text limit too large, keeping its counts', () => {
    const listed = [file('wide', 'M', 1, 0), file('fits', 'M', 1, 0)];
    const blocks = new Map<string, PatchBlock>([
      ['wide', [[add('x'.repeat(11), 1)]]],
      ['fits', [[add('x'.repeat(10), 1)]]],
    ]);
    const files = assembleDiff(listed, blocks, none, 'wide', limits({ fileChars: 10 }));
    expect(files.map((f) => f.note)).toEqual(['tooLarge', null]);
    expect(files[0]).toMatchObject({ added: 1, removed: 0, hunks: [] });
  });

  it('stops at the whole-diff text limit, the clicked file first', () => {
    const listed = [file('a', 'M', 1, 0), file('b', 'M', 1, 0), file('c', 'M', 1, 0)];
    const blocks = new Map<string, PatchBlock>(
      listed.map((f) => [f.path, [[add('x'.repeat(4), 1)]]] as [string, PatchBlock]),
    );
    const files = assembleDiff(listed, blocks, none, 'c', limits({ totalChars: 9 }));
    expect(files.map((f) => f.note)).toEqual([null, 'notShown', null]);
  });

  it('serves the clicked file first, then path order, until the whole-diff limit', () => {
    const listed = [file('a', 'M', 3, 0), file('b', 'M', 3, 0), file('c', 'M', 1, 0)];
    const blocks = new Map<string, PatchBlock>([
      ['a', lines(3)],
      ['b', lines(3)],
      ['c', lines(1)],
    ]);
    const files = assembleDiff(listed, blocks, none, 'c', limits({ fileLines: 5, totalLines: 6 }));
    expect(files.map((f) => f.note)).toEqual([null, 'notShown', null]);
    expect(files[1].hunks).toEqual([]);
  });

  it('once a file misses the whole-diff limit, every later file is not shown', () => {
    const listed = [file('a', 'M', 2, 0), file('b', 'M', 5, 0), file('c', 'M', 1, 0)];
    const blocks = new Map<string, PatchBlock>([
      ['a', lines(2)],
      ['b', lines(5)],
      ['c', lines(1)],
    ]);
    const files = assembleDiff(listed, blocks, none, 'a', limits({ fileLines: 5, totalLines: 6 }));
    expect(files.map((f) => f.note)).toEqual([null, 'notShown', 'notShown']);
  });

  it('files with notes cost nothing against the limit', () => {
    const listed = [file('a', 'M', 3, 0), file('bin', 'M', null, null), file('c', 'M', 3, 0)];
    const blocks = new Map<string, PatchBlock>([
      ['a', lines(3)],
      ['bin', 'binary'],
      ['c', lines(3)],
    ]);
    const files = assembleDiff(listed, blocks, none, 'a', limits({ fileLines: 5, totalLines: 6 }));
    expect(files.map((f) => f.note)).toEqual([null, 'binary', null]);
  });
});
