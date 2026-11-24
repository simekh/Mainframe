// Adapted from Parallel Code (MIT): src/lib/copy-text.test.ts at 97c3558. See THIRD_PARTY_NOTICES.md.
import { describe, expect, it } from 'vitest';
import {
  cleanCopiedTerminalText,
  reflowWrappedParagraphs,
  stripTrailingWhitespacePerLine,
} from './copyText';

describe('stripTrailingWhitespacePerLine', () => {
  it.each([
    ['trailing spaces on one line', 'hello   ', 'hello'],
    ['trailing tabs on one line', 'hello\t\t', 'hello'],
    ['trailing whitespace on each line', 'foo   \nbar \t\nbaz', 'foo\nbar\nbaz'],
    ['leading and interior whitespace kept', '  hello   world   ', '  hello   world'],
    ['blank lines kept', 'foo  \n\nbar  ', 'foo\n\nbar'],
    ['an all-whitespace line emptied, its newline kept', 'foo\n     \nbar', 'foo\n\nbar'],
    ['nothing to strip', 'foo\nbar\nbaz', 'foo\nbar\nbaz'],
    ['the empty string', '', ''],
    ['the trailing newline kept', 'foo  \n', 'foo\n'],
  ])('%s', (_name, input, expected) => {
    expect(stripTrailingWhitespacePerLine(input)).toBe(expected);
  });
});

describe('reflowWrappedParagraphs', () => {
  it.each([
    ['a single-line paragraph', 'Hello world.'],
    // Varied widths suggest intentional breaks.
    ['interior lines whose lengths vary too much', 'short line\nthis is a much longer line of about fifty characters here\ntail'],
    ['empty input', ''],
    ['leading and trailing blank lines', '\n\nhello\n\n'],
    ['blank lines only, as a prior strip leaves whitespace-only input', '\n\n'],
  ])('leaves %s untouched', (_name, input) => {
    expect(reflowWrappedParagraphs(input)).toBe(input);
  });

  it('strips leading whitespace only on continuation lines, preserves first-line indent', () => {
    const input =
      '    indented prose that wraps at terminal width and then keeps\n    going onto the next line.';
    expect(reflowWrappedParagraphs(input)).toBe(
      '    indented prose that wraps at terminal width and then keeps going onto the next line.',
    );
  });

  it('handles multiple paragraphs with mixed reflow decisions (the reported example)', () => {
    const input = [
      '● Added a second haiku to readme.md:',
      '',
      '  Stars blink out one by one',
      '  The last lamp on the street dims',
      '  A cat finds its door',
      '',
      "  Let me know if you'd like to commit this or want a",
      '  different change instead.',
      '',
      '※ recap: Added a second haiku to readme.md as a random',
      '  change. Next: commit the change if it looks good.',
      '  (disable recaps in /config)',
    ].join('\n');
    const expected = [
      '● Added a second haiku to readme.md:',
      '',
      '  Stars blink out one by one',
      '  The last lamp on the street dims',
      '  A cat finds its door',
      '',
      "  Let me know if you'd like to commit this or want a different change instead.",
      '',
      '※ recap: Added a second haiku to readme.md as a random change. Next: commit the change if it looks good. (disable recaps in /config)',
    ].join('\n');
    expect(reflowWrappedParagraphs(input)).toBe(expected);
  });

  it('strips a tab-indented continuation when joining', () => {
    const input =
      'This first line is long enough to qualify the paragraph for reflow.\n\tcontinuation line.';
    expect(reflowWrappedParagraphs(input)).toBe(
      'This first line is long enough to qualify the paragraph for reflow. continuation line.',
    );
  });

  it('reflows a 2-line paragraph even when the second line was an intentional break (accepted failure mode)', () => {
    // Documented limitation: with only one interior line we cannot detect
    // variance, so any ≥40-char first line will reflow with whatever follows.
    // Pinning this here so a future "improvement" cannot silently change it.
    const input = 'A long sentence end here with a period for sure okay.\nUnrelated next sentence.';
    expect(reflowWrappedParagraphs(input)).toBe(
      'A long sentence end here with a period for sure okay. Unrelated next sentence.',
    );
  });

});

describe('cleanCopiedTerminalText', () => {
  it('normalizes CRLF and CR-only line endings before strip + reflow', () => {
    // Mixed CRLF (Windows) and bare CR (classic Mac) both collapse to LF.
    const input =
      "  Let me know if you'd like to commit this or want a   \r\n" +
      '  different change instead.                              \r\n' +
      '\r' +
      '  Tail.\r\n';
    expect(cleanCopiedTerminalText(input)).toBe(
      "  Let me know if you'd like to commit this or want a different change instead.\n\n  Tail.\n",
    );
  });
});
