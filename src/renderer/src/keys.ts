/**
 * The system's command key is held. On macOS that is Cmd, whatever else is held, as the Mac has always
 * had it. On Windows and Linux it is Ctrl without Meta or Alt: on Windows AltGr arrives as Ctrl+Alt,
 * typing `@ { [ ] }` on Nordic and German layouts.
 */
export function commandHeld(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }, platform: NodeJS.Platform): boolean {
  return platform === 'darwin' ? e.metaKey : e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * The letter a Ctrl shortcut on Windows and Linux means, in lower case, or '' for a key that is none. It
 * is the character the layout gives when that is a Latin letter, so Dvorak and AZERTY keep the letter
 * they see, and nothing when it is another ASCII character (Dvorak's `,` where W is). Only when the
 * key gives no ASCII character, on a layout without Latin letters (Russian, Greek), is it the letter on
 * the key's own place, so Ctrl+C copies there too, as in Windows Terminal and VS Code.
 */
export function shortcutLetter(e: { key: string; code: string }): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  if (/^[\x20-\x7e]$/.test(e.key)) return '';
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : '';
}

/** The command key as on-screen hints name it. */
export function commandName(platform: NodeJS.Platform): 'Cmd' | 'Ctrl' {
  return platform === 'darwin' ? 'Cmd' : 'Ctrl';
}

/** A click that opens a link in a terminal: Cmd+click on macOS, Ctrl+click on Windows and Linux. */
export function linkClickHeld(e: { metaKey: boolean; ctrlKey: boolean }, platform: NodeJS.Platform): boolean {
  return platform === 'darwin' ? e.metaKey : e.ctrlKey;
}
