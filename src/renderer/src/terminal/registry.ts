// Adapted from Parallel Code (MIT): src/lib/terminalFitManager.ts (redrawAllTerminals) at 97c3558. See THIRD_PARTY_NOTICES.md.
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
}

const entries = new Map<string, TerminalEntry>();

export function registerTerminal(id: string, entry: TerminalEntry): void {
  entries.set(id, entry);
}

export function unregisterTerminal(id: string): void {
  entries.delete(id);
}

export function getTerminal(id: string): Terminal | undefined {
  return entries.get(id)?.term;
}

function redraw(term: Terminal): void {
  try {
    term.clearTextureAtlas();
    term.refresh(0, term.rows - 1);
  } catch {
    // The terminal may be mid-dispose; a cosmetic redraw must never crash the app.
  }
}

/**
 * Repaint every terminal. There is deliberately no single-terminal variant: WebGL terminals with
 * the same font and theme share one glyph atlas, and clearing it resets only the calling
 * terminal's render model, which garbles the others. Requests in the same tick share one repaint.
 */
let redrawQueued = false;
export function redrawAllTerminals(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  queueMicrotask(() => {
    redrawQueued = false;
    for (const { term } of entries.values()) redraw(term);
  });
}
