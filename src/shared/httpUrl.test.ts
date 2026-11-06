// Adapted from Parallel Code (MIT): src/lib/terminalLinks.test.ts (normalizeHttpUrl cases) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { describe, expect, it } from 'vitest';
import { httpUrl, MAX_HTTP_URL_LENGTH } from './httpUrl';

const PREFIX = 'https://a.b/';
const urlOfLength = (length: number) => PREFIX + 'x'.repeat(length - PREFIX.length);

describe('httpUrl', () => {
  it('passes web addresses, in their normalised form', () => {
    expect(httpUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(httpUrl('HTTPS://EXAMPLE.COM/pr/1')).toBe('https://example.com/pr/1');
    expect(httpUrl('http://localhost:5173/?q=1#top')).toBe('http://localhost:5173/?q=1#top');
  });

  it.each([
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['data:text/html,<b>x</b>'],
    ['vscode://file/etc/passwd'],
    ['ftp://example.com/x'],
    ['not a url'],
    [''],
  ])('drops %j', (raw) => {
    expect(httpUrl(raw)).toBeNull();
  });

  it.each([[42], [null], [undefined], [{ href: 'https://example.com/' }], [['https://example.com/']]])(
    'drops %j, which is not a string',
    (raw) => {
      expect(httpUrl(raw)).toBeNull();
    },
  );

  it('passes an address of the longest length and drops a longer one', () => {
    expect(MAX_HTTP_URL_LENGTH).toBe(8192);
    expect(httpUrl(urlOfLength(MAX_HTTP_URL_LENGTH))).toBe(urlOfLength(MAX_HTTP_URL_LENGTH));
    expect(httpUrl(urlOfLength(MAX_HTTP_URL_LENGTH + 1))).toBeNull();
  });
});
