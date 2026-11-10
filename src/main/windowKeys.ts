// The window's own keys, read from Electron's `before-input-event` input. No `electron` import here,
// so a unit test never loads it.

/**
 * Ctrl+Shift+I pressed down: DevTools on Windows and Linux, as in Chrome and VS Code. Never with Alt,
 * as AltGr arrives as Ctrl+Alt on Windows, nor with Meta.
 */
export function isDevToolsKey(input: {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}): boolean {
  return input.type === 'keyDown' && input.control && input.shift && !input.alt && !input.meta && input.key.toLowerCase() === 'i';
}
