// Adapted from Parallel Code (MIT): src/lib/keybindings/defaults.ts (app.nav.next-attention, app.nav.previous-attention) at 97c3558. See THIRD_PARTY_NOTICES.md.

export interface BoardActions {
  jump(step: 1 | -1): void;
  /** Focuses the open project at this place in the list, counted from 0. */
  focusProject(index: number): void;
  /** Takes the focused project's pane off screen. */
  closePane(): void;
}

const DIGIT = /^Digit([1-9])$/;

/**
 * Ctrl+Tab jumps forward through the sessions that need the owner, Ctrl+Shift+Tab back. Ctrl on
 * macOS too: Cmd+Tab is the system's app switcher, and Option types characters on the Swedish layout.
 * Cmd+1 to Cmd+9 focus the open projects in the list's order, by the key, so every layout has them.
 * Cmd+W takes the focused project's pane off screen, by the character as macOS's own shortcuts go;
 * Ctrl+W stays with the terminal, where it deletes the word before the cursor.
 *
 * A capture-phase listener, so the terminal never sees the key. A matched key is always swallowed,
 * even when it has nothing to do; every other key passes through untouched. Returns the function
 * that removes the listener.
 */
export function installBoardShortcuts(target: Window, actions: BoardActions): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const digit = DIGIT.exec(e.code);
    const cmdAlone = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey) actions.jump(e.shiftKey ? -1 : 1);
    else if (digit && cmdAlone) actions.focusProject(Number(digit[1]) - 1);
    else if (e.key === 'w' && cmdAlone) actions.closePane();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
