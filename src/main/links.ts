import { appendFile } from 'node:fs/promises';

/** Where an e2e run, which opens no browser, records the links it was asked to open: one URL a line, in the data folder. */
export const OPENED_LINKS_FILE = 'opened-links.log';

function webAddress(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens a web page in the owner's browser. The renderer has checked the address already; this is
 * the last check before the system opens it, so only http: and https: pass and anything else is
 * dropped with a warning.
 */
export async function openLink(url: unknown, openExternal: (url: string) => Promise<void>): Promise<void> {
  const address = webAddress(url);
  if (address === undefined) {
    console.warn('[links] dropped a link that is not an http(s) address', url);
    return;
  }
  await openExternal(address);
}

/** What an e2e run does in place of opening a link: it appends the address to `file`. */
export function recordLinksTo(file: string): (url: string) => Promise<void> {
  return (url) => appendFile(file, `${url}\n`);
}
