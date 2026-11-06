import { httpUrl } from '../shared/httpUrl';

/**
 * Opens a web page in the owner's browser. The renderer has checked the address already; main
 * checks it again, as the last check before the system opens it: only http: and https: pass and
 * anything else is dropped with a warning.
 */
export async function openLink(url: unknown, openExternal: (url: string) => Promise<void>): Promise<void> {
  const address = httpUrl(url);
  if (address === null) {
    // Nothing of what came: it may be large, or hold a secret.
    console.warn('[links] dropped a link that is not an http(s) address');
    return;
  }
  await openExternal(address);
}
