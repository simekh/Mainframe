import { appendFile } from 'node:fs/promises';
import { httpUrl } from '../shared/httpUrl';

/** Where an e2e run, which opens no browser, records the links it was asked to open: one URL a line, in the data folder. */
export const OPENED_LINKS_FILE = 'opened-links.log';

const LOGGED_PREFIX_LENGTH = 200;

/**
 * Opens a web page in the owner's browser. The renderer has checked the address already; main
 * checks it again, as the last check before the system opens it: only http: and https: pass and
 * anything else is dropped with a warning.
 */
export async function openLink(url: unknown, openExternal: (url: string) => Promise<void>): Promise<void> {
  const address = httpUrl(url);
  if (address === null) {
    // Only the type and a prefix: what came from the renderer may be large, or hold a secret.
    const prefix = typeof url === 'string' ? url.slice(0, LOGGED_PREFIX_LENGTH) : '';
    console.warn('[links] dropped a link that is not an http(s) address', typeof url, prefix);
    return;
  }
  await openExternal(address);
}

/** What an e2e run does in place of opening a link: it appends the address to `file`. */
export function recordLinksTo(file: string): (url: string) => Promise<void> {
  return (url) => appendFile(file, `${url}\n`);
}
