import { describe, it, expect } from 'vitest';
import type { Tokens } from 'marked';
import { cardTokens, plainText } from './markdown';

describe('cardTokens', () => {
  it('turns a single newline into a line break, as trackers show them', () => {
    const [paragraph] = cardTokens('Searching finds nothing.\nIt should find more.') as Tokens.Paragraph[];
    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.tokens.map((t) => t.type)).toEqual(['text', 'br', 'text']);
  });

  it('returns the blocks, and reads the GitHub extras: tables, strike-through and task items', () => {
    expect(cardTokens('a\n\nb').map((t) => t.type)).toEqual(['paragraph', 'space', 'paragraph']);
    expect(cardTokens('| a | b |\n|---|---|\n| 1 | 2 |').map((t) => t.type)).toEqual(['table']);
    expect((cardTokens('~~gone~~') as Tokens.Paragraph[])[0].tokens.map((t) => t.type)).toEqual(['del']);
    const [list] = cardTokens('- [x] done\n- [ ] to do') as Tokens.List[];
    expect(list.items.map((item) => [item.task, item.checked])).toEqual([
      [true, true],
      [true, false],
    ]);
  });

  it('is empty for no text', () => {
    expect(cardTokens('')).toHaveLength(0);
  });
});

describe('plainText', () => {
  it('strips the marks and joins the blocks with single spaces', () => {
    expect(plainText('**Why:** `frontend/app.config.ts` says\n- one\n- two')).toBe('Why: frontend/app.config.ts says one two');
  });

  it('gives a link its text, and an image its alt text', () => {
    expect(plainText('see [the **docs**](https://example.com/x) now')).toBe('see the docs now');
    expect(plainText('a ![the alt](https://example.com/y.png) b')).toBe('a the alt b');
  });

  it('gives raw HTML its literal text', () => {
    expect(plainText('<img src=x onerror="window.__pwned=1">')).toBe('<img src=x onerror="window.__pwned=1">');
    expect(plainText('a <b>bold</b> c')).toBe('a <b>bold</b> c');
  });

  it('reads every kind of block as what a reader sees', () => {
    expect(plainText('## Heading\n\ntext')).toBe('Heading text');
    expect(plainText('> quoted\n> lines')).toBe('quoted lines');
    expect(plainText('```js\nlet a = 1 < 2;\n```\n\nafter')).toBe('let a = 1 < 2; after');
    expect(plainText('| a | b |\n|---|---|\n| 1 | **2** |')).toBe('a b 1 2');
    expect(plainText('1. first\n2. second\n   - nested')).toBe('first second nested');
    expect(plainText('above\n\n---\n\nbelow')).toBe('above below');
    expect(plainText('- [x] done\n- [ ] to do')).toBe('done to do');
    expect(plainText('a \\* b ~~c~~ _d_')).toBe('a * b c d');
  });

  it('collapses single newlines and runs of whitespace', () => {
    expect(plainText('a\nb\n\n\n   c  \t d')).toBe('a b c d');
  });

  it('is empty for no text, or only blanks', () => {
    expect(plainText('')).toBe('');
    expect(plainText('  \n \n')).toBe('');
  });
});
