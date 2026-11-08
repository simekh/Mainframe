/** A project's side panel's width and pin, as the owner left them. */
export interface PanelPrefs {
  width: number;
  pinned: boolean;
}

export const DEFAULT_PANEL_PREFS: PanelPrefs = { width: 640, pinned: true };

/** What every project shared before each kept its own; a project with none of its own starts from it. */
const SHARED_KEY = 'mainframe.panel';
const keyOf = (dir: string) => `${SHARED_KEY}:${dir}`;
export const MIN_WIDTH = 420;
/** What the pane keeps beside the panel: room for the board when pinned, a strip of it when not. */
export const BOARD_ROOM = { pinned: 360, unpinned: 80 };

/** The width the panel can take in its project pane. The minimum wins when the pane is too narrow. */
export function clampWidth(width: number, paneWidth: number, pinned: boolean): number {
  const max = paneWidth - (pinned ? BOARD_ROOM.pinned : BOARD_ROOM.unpinned);
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, max)));
}

export function loadPanelPrefs(storage: Pick<Storage, 'getItem'>, dir: string): PanelPrefs {
  try {
    const saved: unknown = JSON.parse(storage.getItem(keyOf(dir)) ?? storage.getItem(SHARED_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return DEFAULT_PANEL_PREFS;
    const { width, pinned } = saved as Record<string, unknown>;
    if (typeof width !== 'number' || !Number.isFinite(width) || typeof pinned !== 'boolean') return DEFAULT_PANEL_PREFS;
    return { width, pinned };
  } catch {
    return DEFAULT_PANEL_PREFS;
  }
}

/** A storage that refuses the write (full, or turned off) leaves the prefs for this run only. */
export function savePanelPrefs(storage: Pick<Storage, 'setItem'>, dir: string, prefs: PanelPrefs): void {
  try {
    storage.setItem(keyOf(dir), JSON.stringify({ width: prefs.width, pinned: prefs.pinned }));
  } catch {
    // Nothing to do: the panel keeps working with what it has.
  }
}
