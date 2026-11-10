// Adapted from Parallel Code (MIT): src/lib/terminalDrop.ts (escapePath) at 97c3558. See THIRD_PARTY_NOTICES.md.
//
// On macOS and Linux, paths are backslash-escaped before insertion so spaces,
// quotes, and other shell metacharacters round-trip correctly through both
// POSIX shells (bash, zsh) and CLI agents that parse paths from prompt text.
// Backslash escaping matches macOS Terminal / iTerm2 / VS Code muscle memory
// and renders cleanly inside agent prompts (no quote walls).
//
// On Windows a backslash is the path separator, so a path is never
// backslash-escaped: one with whitespace goes in double quotes, which a
// Windows name can't hold, and any other goes in as it is.

const SAFE_PATH = /^[A-Za-z0-9_./@:+,%=-]+$/;
// Conservative metaset: every byte that has special meaning in any common
// POSIX shell. Backslash-escaping a non-special character is harmless, so
// over-escaping is preferred to under-escaping.
//
// Note: `\` itself is in this set so an embedded backslash gets escaped to
// `\\`. The character class is in a single line (not split across lines)
// so the literal whitespace between brackets is part of the set.
// eslint-disable-next-line no-useless-escape -- explicit escapes document intent
const META_CHAR = /[\s'"\\$`!()<>;&|*?\[\]{}~#]/g;

/**
 * Escape a path, or quote it on Windows, so it survives insertion into a
 * terminal that may be hosting either a shell or a CLI agent as one word.
 * The empty string renders as `""` so a real shell receives an explicit
 * empty argument.
 */
export function escapePath(p: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return p === '' || /\s/.test(p) ? `"${p}"` : p;
  if (p === '') return '""';
  if (SAFE_PATH.test(p)) return p;
  return p.replace(META_CHAR, '\\$&');
}
