// Adapted from Parallel Code (MIT): src/lib/terminalLinks.ts (normalizeHttpUrl) at 97c3558. See THIRD_PARTY_NOTICES.md.

/** The longest address that opens; a longer one is a mistake or an attack, not a link. */
export const MAX_HTTP_URL_LENGTH = 8192;

/**
 * The address in its normalised form if it is a web page; null for anything else (a non-string, one
 * that is too long, javascript:, file:, garbage). The renderer and main both ask it, so they agree
 * on what opens.
 */
export function httpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_HTTP_URL_LENGTH) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
