// Adapted from Parallel Code (MIT): src/lib/terminalLinks.test.ts (createTerminalHttpLinkHandler cases) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { describe, expect, it, vi } from 'vitest';
import { createTerminalHttpLinkHandler } from './terminalLinks';

const click = (overrides: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
  metaKey: false,
  ctrlKey: false,
  preventDefault: vi.fn(),
  ...overrides,
});

function handlerWith(platform: NodeJS.Platform, openExternal = vi.fn().mockResolvedValue(undefined), onOpenError = vi.fn()) {
  return { handler: createTerminalHttpLinkHandler({ openExternal, onOpenError, platform }), openExternal, onOpenError };
}

describe('createTerminalHttpLinkHandler', () => {
  it('ignores a plain click and leaves it to the terminal', () => {
    const { handler, openExternal } = handlerWith('darwin');
    const e = click();
    handler(e, 'https://example.com/');
    expect(openExternal).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('opens the link with Cmd held, in its normalised form', () => {
    const { handler, openExternal } = handlerWith('darwin');
    const e = click({ metaKey: true });
    handler(e, 'HTTPS://EXAMPLE.COM/pr/1');
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/pr/1');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([['javascript:alert(1)'], ['file:///etc/passwd'], ['not a url']])(
    'takes over a Cmd+click on %j and opens nothing',
    (uri) => {
      const { handler, openExternal } = handlerWith('darwin');
      const e = click({ metaKey: true });
      handler(e, uri);
      expect(openExternal).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
    },
  );

  it('reports an opener that rejects, without throwing', async () => {
    const failure = new Error('no');
    const { handler, onOpenError } = handlerWith('darwin', vi.fn().mockRejectedValue(failure));
    handler(click({ metaKey: true }), 'https://example.com/');
    await vi.waitFor(() => expect(onOpenError).toHaveBeenCalledExactlyOnceWith(failure));
  });

  it.each([
    ['darwin', { metaKey: true }, { ctrlKey: true }],
    ['win32', { ctrlKey: true }, { metaKey: true }],
    ['linux', { ctrlKey: true }, { metaKey: true }],
  ] as const)('on %s opens the link with %o held, and leaves a click with %o to the terminal', (platform, held, other) => {
    const { handler, openExternal } = handlerWith(platform);
    const notHeld = click(other);
    handler(notHeld, 'https://example.com/');
    expect(openExternal).not.toHaveBeenCalled();
    expect(notHeld.preventDefault).not.toHaveBeenCalled();

    const e = click(held);
    handler(e, 'https://example.com/');
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });
});
