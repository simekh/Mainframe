// Adapted from Parallel Code (MIT): src/lib/terminalDrop.test.ts (escapePath cases) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { describe, it, expect } from 'vitest';
import { escapePath } from './escapePath';

describe('escapePath', () => {
  it('passes safe paths through unchanged', () => {
    expect(escapePath('/Users/foo/bar.png')).toBe('/Users/foo/bar.png');
    expect(escapePath('relative/path-1.txt')).toBe('relative/path-1.txt');
    expect(escapePath('a_b.c')).toBe('a_b.c');
    expect(escapePath('user@host:/some/path')).toBe('user@host:/some/path');
  });

  it('escapes whitespace', () => {
    expect(escapePath('/Users/foo/My Image.png')).toBe('/Users/foo/My\\ Image.png');
    expect(escapePath('a\tb')).toBe('a\\\tb');
  });

  it('escapes embedded apostrophes', () => {
    expect(escapePath(`/tmp/it's.png`)).toBe(`/tmp/it\\'s.png`);
  });

  it('escapes embedded double quotes', () => {
    expect(escapePath('/tmp/say "hi".png')).toBe('/tmp/say\\ \\"hi\\".png');
  });

  it('escapes shell metacharacters', () => {
    expect(escapePath('/tmp/a$b.png')).toBe('/tmp/a\\$b.png');
    expect(escapePath('/tmp/a`b.png')).toBe('/tmp/a\\`b.png');
    expect(escapePath('/tmp/(weird).png')).toBe('/tmp/\\(weird\\).png');
    expect(escapePath('/tmp/a&b.png')).toBe('/tmp/a\\&b.png');
    expect(escapePath('/tmp/a|b.png')).toBe('/tmp/a\\|b.png');
    expect(escapePath('/tmp/a;b.png')).toBe('/tmp/a\\;b.png');
    expect(escapePath('/tmp/a*b.png')).toBe('/tmp/a\\*b.png');
    expect(escapePath('/tmp/a?b.png')).toBe('/tmp/a\\?b.png');
    expect(escapePath('/tmp/[a].png')).toBe('/tmp/\\[a\\].png');
    expect(escapePath('/tmp/{a}.png')).toBe('/tmp/\\{a\\}.png');
    expect(escapePath('/tmp/~a.png')).toBe('/tmp/\\~a.png');
    expect(escapePath('/tmp/#a.png')).toBe('/tmp/\\#a.png');
    expect(escapePath('/tmp/!a.png')).toBe('/tmp/\\!a.png');
    expect(escapePath('/tmp/a<b>.png')).toBe('/tmp/a\\<b\\>.png');
  });

  it('escapes embedded backslash', () => {
    expect(escapePath('a\\b')).toBe('a\\\\b');
  });

  it('renders the empty string as an explicit empty argv', () => {
    expect(escapePath('')).toBe('""');
  });

  it('chains escapes for paths with multiple metacharacters', () => {
    expect(escapePath(`/tmp/it's "weird" & cool.png`)).toBe(
      `/tmp/it\\'s\\ \\"weird\\"\\ \\&\\ cool.png`,
    );
  });
});
