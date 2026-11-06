// Adapted from Parallel Code (MIT): src/lib/terminalLinks.ts (normalizeHttpUrl, createTerminalHttpLinkHandler) at 97c3558. See THIRD_PARTY_NOTICES.md.

/** The part of a mouse event the handler reads. */
export interface TerminalLinkMouseEvent {
  metaKey: boolean;
  preventDefault: () => void;
}

export interface TerminalLinkHandlerOptions {
  openExternal: (url: string) => Promise<void> | void;
  onOpenError?: (err: unknown) => void;
}

/** The address in its normalised form if it is a web page; null for anything else (javascript:, file:, garbage). */
export function normalizeHttpUrl(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * What a click on a link does. Only a click with Cmd held opens it, in the owner's browser; a plain
 * click is left to the terminal, which selects and focuses as it always did. Only web pages open.
 */
export function createTerminalHttpLinkHandler(options: TerminalLinkHandlerOptions) {
  return (event: TerminalLinkMouseEvent, uri: string): void => {
    if (!event.metaKey) return;

    event.preventDefault();
    const url = normalizeHttpUrl(uri);
    if (!url) return;

    try {
      Promise.resolve(options.openExternal(url)).catch((err: unknown) => options.onOpenError?.(err));
    } catch (err) {
      options.onOpenError?.(err);
    }
  };
}
