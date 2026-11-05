// Adapted from Parallel Code (MIT): src/lib/keybindings/defaults.ts (app.nav.next-attention, app.nav.previous-attention) at 97c3558. See THIRD_PARTY_NOTICES.md.

/**
 * Ctrl+Tab jumps forward through the sessions that need the owner, Ctrl+Shift+Tab back. Ctrl on
 * macOS too: Cmd+Tab is the system's app switcher, and Option types characters on the Swedish layout.
 *
 * A capture-phase listener, so the terminal never sees the key. A matched key is always swallowed,
 * even when nothing needs the owner; every other key passes through untouched. Returns the function
 * that removes the listener.
 */
export function installBoardShortcuts(target: Window, jump: (step: 1 | -1) => void): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    jump(e.shiftKey ? -1 : 1);
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
