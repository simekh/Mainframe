// Adapted from Parallel Code (MIT): src/lib/keybindings/defaults.ts (app.nav.next-attention, app.nav.previous-attention) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { commandHeld, shortcutLetter } from '../keys';

export interface BoardActions {
  jump(step: 1 | -1): void;
  /** Focuses the open project at this place in the list, counted from 0. */
  focusProject(index: number): void;
  /** Takes the focused project's pane off screen. */
  closePane(): void;
  /** Asks for a folder and opens it beside the others. */
  openProject(): void;
}

const DIGIT = /^Digit([1-9])$/;

/**
 * Ctrl+Tab jumps forward through the sessions that need the owner, Ctrl+Shift+Tab back, on every
 * system. Ctrl on macOS too: Cmd+Tab is the system's app switcher, and Option types characters on the
 * Swedish layout. Cmd+1 to Cmd+9 (Ctrl+1 to Ctrl+9 on Windows and Linux) focus the open projects in
 * the list's order, by the key, so every layout has them.
 *
 * On macOS, Cmd+W takes the focused project's pane off screen, by the character as macOS's own
 * shortcuts go, and Open Project… is the menu's Cmd+O. On Windows and Linux, Ctrl+Shift+W and
 * Ctrl+Shift+O do these, by the character whether Caps Lock is on or not, and on a layout without Latin
 * letters by the letter on the key itself (`shortcutLetter`). Plain Ctrl+W stays with
 * the terminal on every system, where it deletes the word before the cursor, and plain Ctrl+O is
 * Claude Code's. No key matches with Alt held: on Windows AltGr arrives as Ctrl+Alt, typing
 * characters on Nordic and German layouts.
 *
 * A capture-phase listener, so the terminal never sees the key. A matched key is always swallowed,
 * even when it has nothing to do; every other key passes through untouched. Nothing happens while a
 * modal dialog is open: it blocks what lies behind it, and the pane it sits in must stay on screen.
 * Returns the function that removes the listener.
 */
export function installBoardShortcuts(target: Window, actions: BoardActions, platform: NodeJS.Platform): () => void {
  const onMac = platform === 'darwin';
  const onKeyDown = (e: KeyboardEvent) => {
    const digit = DIGIT.exec(e.code);
    // Stricter than commandHeld on macOS, as the board has always been: Cmd without Ctrl or Option.
    const command = onMac ? e.metaKey && !e.ctrlKey && !e.altKey : commandHeld(e, platform);
    const commandAlone = command && !e.shiftKey;
    const commandShift = !onMac && command && e.shiftKey;
    const char = shortcutLetter(e);
    const closeKey = onMac ? e.key === 'w' && commandAlone : commandShift && char === 'w';
    let act: () => void;
    if (e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey) act = () => actions.jump(e.shiftKey ? -1 : 1);
    else if (digit && commandAlone) act = () => actions.focusProject(Number(digit[1]) - 1);
    else if (closeKey) act = () => actions.closePane();
    else if (commandShift && char === 'o') act = () => actions.openProject();
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (!target.document.querySelector('dialog:modal')) act();
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
