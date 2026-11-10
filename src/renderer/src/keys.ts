/**
 * The system's command key is held, without the other two of Cmd, Ctrl and Alt: Cmd on macOS, Ctrl
 * on Windows and Linux. Never with Alt: Option types characters on the Mac's Swedish layout, and on
 * Windows AltGr arrives as Ctrl+Alt, typing `@ { [ ] }` on Nordic and German layouts.
 */
export function commandHeld(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }, platform: NodeJS.Platform): boolean {
  return platform === 'darwin' ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && !e.metaKey && !e.altKey;
}

/** The command key as on-screen hints name it. */
export function commandName(platform: NodeJS.Platform): 'Cmd' | 'Ctrl' {
  return platform === 'darwin' ? 'Cmd' : 'Ctrl';
}

/** A click that opens a link in a terminal: Cmd+click on macOS, Ctrl+click on Windows and Linux. */
export function linkClickHeld(e: { metaKey: boolean; ctrlKey: boolean }, platform: NodeJS.Platform): boolean {
  return platform === 'darwin' ? e.metaKey : e.ctrlKey;
}
