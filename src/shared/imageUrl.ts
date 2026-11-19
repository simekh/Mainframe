/** The scheme main serves a conversation's images on, for the page's `<img>` only (its CSP lists it in `img-src`). */
export const IMAGE_SCHEME = 'mainframe-image';

/** Where the page loads the session's image at `index` in its list. */
export const imageUrl = (sessionId: string, index: number): string => `${IMAGE_SCHEME}://${sessionId}/${index}`;
