import { BOARD_ROOM, MIN_WIDTH, STRIP_WIDTH } from '../panel/panelPrefs';

/** The manager column's width: what it starts at, and the range the owner can drag it through. */
export const MANAGER_WIDTH = { default: 400, min: 320, max: 640 };

const KEY = 'mainframe.manager';
/** What the pane keeps beside the column: the session panel's minimum and the board's room when pinned. */
const BESIDE = MIN_WIDTH + BOARD_ROOM.pinned;

/**
 * The width the column can take in its project pane. Floating, its own strip beside it counts too; pinned, it doesn't,
 * so a fold keeps the column's width. The minimum wins when the pane is too narrow.
 */
export function clampManagerWidth(width: number, paneWidth: number, pinned: boolean): number {
  const max = Math.min(MANAGER_WIDTH.max, paneWidth - BESIDE - (pinned ? 0 : STRIP_WIDTH));
  return Math.round(Math.max(MANAGER_WIDTH.min, Math.min(width, max)));
}

export function loadManagerWidth(storage: Pick<Storage, 'getItem'>): number {
  try {
    const saved: unknown = JSON.parse(storage.getItem(KEY) ?? 'null');
    const width = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>).width : undefined;
    return typeof width === 'number' && Number.isFinite(width) ? width : MANAGER_WIDTH.default;
  } catch {
    return MANAGER_WIDTH.default;
  }
}

/** A storage that refuses the write (full, or turned off) leaves the width for this run only. */
export function saveManagerWidth(storage: Pick<Storage, 'setItem'>, width: number): void {
  try {
    storage.setItem(KEY, JSON.stringify({ width }));
  } catch {
    // Nothing to do: the column keeps working with what it has.
  }
}

/** Each project's own pin: pinning one project's manager leaves the others' as they are. */
const pinKeyOf = (dir: string) => `${KEY}:${dir}`;

/** Whether the project's manager is pinned beside the board; until the owner unpins it, it is. */
export function loadManagerPinned(storage: Pick<Storage, 'getItem'>, dir: string): boolean {
  try {
    const saved: unknown = JSON.parse(storage.getItem(pinKeyOf(dir)) ?? 'null');
    return (saved as Record<string, unknown> | null)?.pinned !== false;
  } catch {
    return true;
  }
}

/** A storage that refuses the write leaves the pin for this run only. */
export function saveManagerPinned(storage: Pick<Storage, 'setItem'>, dir: string, pinned: boolean): void {
  try {
    storage.setItem(pinKeyOf(dir), JSON.stringify({ pinned }));
  } catch {
    // Nothing to do: the column keeps working with what it has.
  }
}
