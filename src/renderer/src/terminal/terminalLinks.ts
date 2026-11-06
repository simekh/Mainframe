// Adapted from Parallel Code (MIT): src/lib/terminalLinks.ts (createTerminalHttpLinkHandler) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { httpUrl } from '../../../shared/httpUrl';

/** The part of a mouse event the handler reads. */
export interface TerminalLinkMouseEvent {
  metaKey: boolean;
  preventDefault: () => void;
}

export interface TerminalLinkHandlerOptions {
  openExternal: (url: string) => Promise<void>;
  onOpenError: (err: unknown) => void;
}

/**
 * What a click on a link does. Only a click with Cmd held opens it, in the owner's browser; a plain
 * click is left to the terminal, which selects and focuses as it always did. Only web pages open.
 */
export function createTerminalHttpLinkHandler(options: TerminalLinkHandlerOptions) {
  return (event: TerminalLinkMouseEvent, uri: string): void => {
    if (!event.metaKey) return;

    event.preventDefault();
    const url = httpUrl(uri);
    if (!url) return;

    options.openExternal(url).catch(options.onOpenError);
  };
}
