/** A project's side panel's width and pin, as the owner left them. */
export interface PanelPrefs {
  width: number;
  pinned: boolean;
}

export const DEFAULT_PANEL_PREFS: PanelPrefs = { width: 640, pinned: true };

/**
 * The session panel's key. Alone, it holds what every project shared before each kept its own; a project with none
 * of its own starts from it. Only the session panel has that: another island's project starts from its defaults.
 */
const SHARED_KEY = 'mainframe.panel';
export const MIN_WIDTH = 420;
/** What the pane keeps beside the panel: room for the board when pinned, a strip of it when not. */
export const BOARD_ROOM = { pinned: 360, unpinned: 80 };

/** The width the panel can take in its project pane. The minimum wins when the pane is too narrow. */
export function clampWidth(width: number, paneWidth: number, pinned: boolean): number {
  const max = paneWidth - (pinned ? BOARD_ROOM.pinned : BOARD_ROOM.unpinned);
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, max)));
}

export function loadPanelPrefs(
  storage: Pick<Storage, 'getItem'>,
  dir: string,
  { key = SHARED_KEY, defaults = DEFAULT_PANEL_PREFS }: { key?: string; defaults?: PanelPrefs } = {},
): PanelPrefs {
  try {
    const shared = key === SHARED_KEY ? storage.getItem(SHARED_KEY) : null;
    const saved: unknown = JSON.parse(storage.getItem(`${key}:${dir}`) ?? shared ?? 'null');
    if (typeof saved !== 'object' || saved === null) return defaults;
    const { width, pinned } = saved as Record<string, unknown>;
    if (typeof width !== 'number' || !Number.isFinite(width) || typeof pinned !== 'boolean') return defaults;
    return { width, pinned };
  } catch {
    return defaults;
  }
}

/** A storage that refuses the write (full, or turned off) leaves the prefs for this run only. */
export function savePanelPrefs(storage: Pick<Storage, 'setItem'>, dir: string, prefs: PanelPrefs, key = SHARED_KEY): void {
  try {
    storage.setItem(`${key}:${dir}`, JSON.stringify({ width: prefs.width, pinned: prefs.pinned }));
  } catch {
    // Nothing to do: the panel keeps working with what it has.
  }
}
