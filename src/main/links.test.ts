import { afterEach, describe, expect, it, vi } from 'vitest';
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
    ['data:text/html,<b>x</b>'],
    ['vscode://file/etc/passwd'],
    ['ftp://example.com/x'],
    ['not a url'],
    [''],
    [42],
    [{ href: 'https://example.com/' }],
    [undefined],
  ])('drops %j with a warning, and opens nothing', async (url) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const openExternal = vi.fn();
    await openLink(url, openExternal);
    expect(openExternal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('lets the opener failing reach the caller', async () => {
    await expect(openLink('https://example.com/', () => Promise.reject(new Error('no browser')))).rejects.toThrow('no browser');
  });
});
