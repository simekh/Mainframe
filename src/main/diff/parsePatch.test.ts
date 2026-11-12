import { describe, expect, it } from 'vitest';
import type { DiffLine } from '../../shared/types';
import { parsePatch } from './parsePatch';

const ctx = (text: string, o: number, n: number): DiffLine => ({ kind: 'context', text, oldLine: o, newLine: n });
const rem = (text: string, o: number): DiffLine => ({ kind: 'remove', text, oldLine: o, newLine: null });
const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, oldLine: null, newLine: n });
const patch = (lines: string[]): string => [...lines].join('\n') + '\n';

describe('parsePatch', () => {
  it('parses a modified file with two hunks, numbering old and new lines', () => {
    const raw = patch([
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      '@@ -10,2 +10,3 @@ ctx',
      ' ten',
      '+ten-and-a-half',
      ' eleven',
    ]);
    expect(parsePatch(raw)).toEqual(
      new Map([
        [
          'f.txt',
          [
            [ctx('one', 1, 1), rem('two', 2), add('TWO', 2), ctx('three', 3, 3)],
            [ctx('ten', 10, 10), add('ten-and-a-half', 11), ctx('eleven', 11, 12)],
          ],
        ],
      ]),
    );
  });

  it('parses added and deleted files', () => {
    const raw = patch([
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 000..111',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      'index 111..000',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ]);
    expect(parsePatch(raw)).toEqual(
      new Map([
        ['new.txt', [[add('a', 1), add('b', 2)]]],
        ['old.txt', [[rem('gone', 1)]]],
      ]),
    );
  });

  it('marks a binary file', () => {
    const raw = patch(['diff --git a/b.bin b/b.bin', 'index 111..222 100644', 'Binary files a/b.bin and b/b.bin differ']);
    expect(parsePatch(raw)).toEqual(new Map([['b.bin', 'binary']]));
  });

  it('keeps a mode-only change with no hunks', () => {
    const raw = patch(['diff --git a/run.sh b/run.sh', 'old mode 100644', 'new mode 100755']);
    expect(parsePatch(raw)).toEqual(new Map([['run.sh', []]]));
  });

  it('skips the no-newline marker and strips CR', () => {
    const raw = patch([
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-x\r',
      '\\ No newline at end of file',
      '+y',
    ]);
    expect(parsePatch(raw)).toEqual(new Map([['f.txt', [[rem('x', 1), add('y', 1)]]]]));
  });

  it('reads paths with spaces, a " b/" inside, and quoted ones', () => {
    const raw = patch([
      'diff --git a/a b.txt b/a b.txt',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/x b/y.txt b/x b/y.txt',
      'old mode 100644',
      'new mode 100755',
      'diff --git "a/t\\tab.txt" "b/t\\tab.txt"',
      'old mode 100644',
      'new mode 100755',
      'diff --git "a/\\303\\266.txt" "b/\\303\\266.txt"',
      'old mode 100644',
      'new mode 100755',
    ]);
    expect([...parsePatch(raw).keys()]).toEqual(['a b.txt', 'x b/y.txt', 't\tab.txt', 'ö.txt']);
  });

  it('merges two blocks of one path', () => {
    const raw = patch([
      'diff --git a/f b/f',
      'deleted file mode 120000',
      '--- a/f',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-target',
      'diff --git a/f b/f',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/f',
      '@@ -0,0 +1 @@',
      '+text',
    ]);
    expect(parsePatch(raw)).toEqual(new Map([['f', [[rem('target', 1)], [add('text', 1)]]]]));
  });

  it('is empty for an empty patch', () => {
    expect(parsePatch('')).toEqual(new Map());
  });
});
