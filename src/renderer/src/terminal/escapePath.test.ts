// Adapted from Parallel Code (MIT): src/lib/terminalDrop.test.ts (escapePath cases) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { describe, it, expect } from 'vitest';
import { escapePath } from './escapePath';

describe.each(['darwin', 'linux'] as const)('escapePath on %s', (platform) => {
  it('passes safe paths through unchanged', () => {
    expect(escapePath('/Users/foo/bar.png', platform)).toBe('/Users/foo/bar.png');
    expect(escapePath('relative/path-1.txt', platform)).toBe('relative/path-1.txt');
    expect(escapePath('a_b.c', platform)).toBe('a_b.c');
    expect(escapePath('user@host:/some/path', platform)).toBe('user@host:/some/path');
  });

  it('escapes whitespace', () => {
    expect(escapePath('/Users/foo/My Image.png', platform)).toBe('/Users/foo/My\\ Image.png');
    expect(escapePath('a\tb', platform)).toBe('a\\\tb');
  });

  it('escapes embedded apostrophes', () => {
    expect(escapePath(`/tmp/it's.png`, platform)).toBe(`/tmp/it\\'s.png`);
  });

  it('escapes embedded double quotes', () => {
    expect(escapePath('/tmp/say "hi".png', platform)).toBe('/tmp/say\\ \\"hi\\".png');
  });

  it('escapes shell metacharacters', () => {
    expect(escapePath('/tmp/a$b.png', platform)).toBe('/tmp/a\\$b.png');
    expect(escapePath('/tmp/a`b.png', platform)).toBe('/tmp/a\\`b.png');
    expect(escapePath('/tmp/(weird).png', platform)).toBe('/tmp/\\(weird\\).png');
    expect(escapePath('/tmp/a&b.png', platform)).toBe('/tmp/a\\&b.png');
    expect(escapePath('/tmp/a|b.png', platform)).toBe('/tmp/a\\|b.png');
    expect(escapePath('/tmp/a;b.png', platform)).toBe('/tmp/a\\;b.png');
    expect(escapePath('/tmp/a*b.png', platform)).toBe('/tmp/a\\*b.png');
    expect(escapePath('/tmp/a?b.png', platform)).toBe('/tmp/a\\?b.png');
    expect(escapePath('/tmp/[a].png', platform)).toBe('/tmp/\\[a\\].png');
    expect(escapePath('/tmp/{a}.png', platform)).toBe('/tmp/\\{a\\}.png');
    expect(escapePath('/tmp/~a.png', platform)).toBe('/tmp/\\~a.png');
    expect(escapePath('/tmp/#a.png', platform)).toBe('/tmp/\\#a.png');
    expect(escapePath('/tmp/!a.png', platform)).toBe('/tmp/\\!a.png');
    expect(escapePath('/tmp/a<b>.png', platform)).toBe('/tmp/a\\<b\\>.png');
  });

  it('escapes embedded backslash', () => {
    expect(escapePath('a\\b', platform)).toBe('a\\\\b');
  });

  it('renders the empty string as an explicit empty argv', () => {
    expect(escapePath('', platform)).toBe('""');
  });

  it('chains escapes for paths with multiple metacharacters', () => {
    expect(escapePath(`/tmp/it's "weird" & cool.png`, platform)).toBe(
      `/tmp/it\\'s\\ \\"weird\\"\\ \\&\\ cool.png`,
    );
  });
});

describe('escapePath on win32', () => {
  it('passes a path without whitespace through unchanged', () => {
    expect(escapePath('C:\\Users\\anna\\shot.png', 'win32')).toBe('C:\\Users\\anna\\shot.png');
  });

  // Review Focus 4: a backslash added would garble the path.
  it('puts a path with spaces in double quotes, adding no backslash', () => {
    expect(escapePath('C:\\Users\\Anna Berg\\Pictures\\shot 1.png', 'win32')).toBe(
      '"C:\\Users\\Anna Berg\\Pictures\\shot 1.png"',
    );
  });

  it('renders the empty string as an explicit empty argument', () => {
    expect(escapePath('', 'win32')).toBe('""');
  });

  it('leaves the characters a POSIX shell treats specially as they are', () => {
    expect(escapePath("C:\\Users\\anna\\Tom&Jerry's(1).png", 'win32')).toBe("C:\\Users\\anna\\Tom&Jerry's(1).png");
  });
});
