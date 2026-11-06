import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_HTTP_URL_LENGTH } from '../shared/httpUrl';
import { openLink } from './links';

afterEach(() => vi.restoreAllMocks());

describe('openLink', () => {
  it('opens a web address, in its normalised form', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    await openLink('HTTPS://EXAMPLE.COM/pr/1', openExternal);
    await openLink('http://localhost:5173/', openExternal);
    expect(openExternal.mock.calls).toEqual([['https://example.com/pr/1'], ['http://localhost:5173/']]);
  });

  it.each([
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['vscode://file/etc/passwd'],
    ['not a url'],
    [42],
    [{ href: 'https://example.com/' }],
    [undefined],
    ['https://a.b/' + 'x'.repeat(MAX_HTTP_URL_LENGTH)],
  ])('drops %j with a warning, and opens nothing', async (url) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const openExternal = vi.fn();
    await openLink(url, openExternal);
    expect(openExternal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs the type and a short prefix of what it drops, never all of it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openLink('x'.repeat(10_000), vi.fn());
    await openLink({ secret: 'token' }, vi.fn());
    const logged = warn.mock.calls.map((args) => args.map(String).join(' '));
    expect(logged[0]).toContain('string');
    expect(logged[0]).toContain('x'.repeat(200));
    expect(logged[0]).not.toContain('x'.repeat(201));
    expect(logged[1]).toContain('object');
    expect(logged[1]).not.toContain('token');
  });

  it('lets the opener failing reach the caller', async () => {
    await expect(openLink('https://example.com/', () => Promise.reject(new Error('no browser')))).rejects.toThrow('no browser');
  });
});
