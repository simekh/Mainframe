// The window's own keys, read from Electron's `before-input-event` input. No `electron` import here,
// so a unit test never loads it.

type Input = { type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };

/**
 * Ctrl+Shift+I pressed down: DevTools on Windows and Linux, as in Chrome and VS Code. Never with Alt,
 * as AltGr arrives as Ctrl+Alt on Windows, nor with Meta.
 */
export function isDevToolsKey(input: Input): boolean {
  return input.type === 'keyDown' && input.control && input.shift && !input.alt && !input.meta && input.key.toLowerCase() === 'i';
}

/** Ctrl+, pressed down: Settings on Windows and Linux, which have no menu for it. Never with Shift, Alt (AltGr) or Meta. */
export function isSettingsKey(input: Input): boolean {
  return input.type === 'keyDown' && input.control && !input.shift && !input.alt && !input.meta && input.key === ',';
}

/**
 * Cmd (the Mac) or Ctrl (elsewhere) with + or =, - or 0 pressed down: zoom in, out or back to 100%, as in
 * browsers. + and = both zoom in, as + is Shift+= on many layouts and a key of its own on others. Never with
 * Alt (AltGr on Windows), nor with the other of Cmd and Ctrl. Off the Mac this takes Ctrl+- from the terminals,
 * which read it as Ctrl+_ (undo in shells and agents' prompts), as VS Code and browsers do; Ctrl+Shift+- still
 * reaches them, as its key is _.
 */
export function zoomKey(input: Input, onMac: boolean): 'in' | 'out' | 'reset' | null {
  const mod = onMac ? input.meta && !input.control : input.control && !input.meta;
  if (input.type !== 'keyDown' || !mod || input.alt) return null;
  if (input.key === '+' || input.key === '=') return 'in';
  if (input.key === '-') return 'out';
  if (input.key === '0') return 'reset';
  return null;
}
