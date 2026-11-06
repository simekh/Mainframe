// Adapted from Parallel Code (MIT): src/lib/terminalLinks.test.ts at 97c3558. See THIRD_PARTY_NOTICES.md.
import { describe, expect, it, vi } from 'vitest';
import { createTerminalHttpLinkHandler, normalizeHttpUrl } from './terminalLinks';

const click = (overrides: { metaKey?: boolean } = {}) => ({ metaKey: false, preventDefault: vi.fn(), ...overrides });

describe('normalizeHttpUrl', () => {
  it('passes web addresses, in their normalised form', () => {
    expect(normalizeHttpUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(normalizeHttpUrl('HTTPS://EXAMPLE.COM/pr/1')).toBe('https://example.com/pr/1');
    expect(normalizeHttpUrl('http://localhost:5173/?q=1#top')).toBe('http://localhost:5173/?q=1#top');
  });

  it.each([
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['data:text/html,<b>x</b>'],
    ['vscode://file/etc/passwd'],
    ['ftp://example.com/x'],
    ['not a url'],
    [''],
  ])('drops %j', (uri) => {
    expect(normalizeHttpUrl(uri)).toBeNull();
  });
});

describe('createTerminalHttpLinkHandler', () => {
  it('ignores a plain click and leaves it to the terminal', () => {
    const openExternal = vi.fn();
    const e = click();
    createTerminalHttpLinkHandler({ openExternal })(e, 'https://example.com/');
    expect(openExternal).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('opens the link with Cmd held', () => {
    const openExternal = vi.fn();
    const e = click({ metaKey: true });
    createTerminalHttpLinkHandler({ openExternal })(e, 'HTTPS://EXAMPLE.COM/pr/1');
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/pr/1');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([['javascript:alert(1)'], ['file:///etc/passwd'], ['not a url']])(
    'takes over a Cmd+click on %j and opens nothing',
    (uri) => {
      const openExternal = vi.fn();
      const e = click({ metaKey: true });
      createTerminalHttpLinkHandler({ openExternal })(e, uri);
      expect(openExternal).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
    },
  );

  it('reports an opener that rejects, without throwing', async () => {
    const onOpenError = vi.fn();
    const failure = new Error('no');
    const handler = createTerminalHttpLinkHandler({ openExternal: () => Promise.reject(failure), onOpenError });
    handler(click({ metaKey: true }), 'https://example.com/');
    await vi.waitFor(() => expect(onOpenError).toHaveBeenCalledExactlyOnceWith(failure));
  });

  it('reports an opener that throws, without throwing', () => {
    const onOpenError = vi.fn();
    const failure = new Error('no');
    const handler = createTerminalHttpLinkHandler({
      openExternal: () => {
        throw failure;
      },
      onOpenError,
    });
    handler(click({ metaKey: true }), 'https://example.com/');
    expect(onOpenError).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
