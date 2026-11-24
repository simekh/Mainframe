import { describe, expect, it } from 'vitest';
import type { FileDiff } from '../../../shared/types';
import { noteText, resultMessage, statusLetter } from './diffText';

const file = (over: Partial<FileDiff>): FileDiff => ({
  path: 'a.txt',
  status: 'M',
  added: 1,
  removed: 1,
  hunks: [],
  note: null,
  ...over,
});

describe('noteText', () => {
  it('counts the lines changed of a file too large to show, when they are known', () => {
    expect(noteText(file({ note: 'tooLarge', added: 3000, removed: 12 }))).toBe(
      'Too large to show here (3012 lines changed).',
    );
    expect(noteText(file({ note: 'tooLarge', added: null }))).toBe('Too large to show here.');
  });

  it('gives null for a file with lines', () => {
    expect(noteText(file({ note: null }))).toBeNull();
  });
});

describe('resultMessage', () => {
  it('says why there is nothing to show', () => {
    expect(resultMessage({ kind: 'files', files: [] })).toBe('No changes');
    expect(resultMessage({ kind: 'failed', message: 'boom' })).toBe("Mainframe couldn't read the changes: boom");
  });

  it('gives null when there are files to show', () => {
    expect(resultMessage({ kind: 'files', files: [file({})] })).toBeNull();
  });
});

it('reads an untracked file as U, and other statuses as they are', () => {
  expect(statusLetter('?')).toBe('U');
  expect(statusLetter('M')).toBe('M');
});
