import { errorMessage } from './bridgeError';

/** Opens `url` in the owner's browser. A failure has nowhere to show, so it is logged under `tag`. */
export function openLinkLogged(url: string, tag: string): void {
  window.mainframe.openLink(url).catch((err: unknown) => console.error(`[${tag}] could not open ${url}: ${errorMessage(err)}`));
}
