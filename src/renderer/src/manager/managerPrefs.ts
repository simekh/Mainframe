import { BOARD_ROOM, MIN_WIDTH } from '../panel/panelPrefs';

/** The manager column's width: what it starts at, and the range the owner can drag it through. */
export const MANAGER_WIDTH = { default: 400, min: 320, max: 640 };

const KEY = 'mainframe.manager';
/** What the pane keeps beside the column: the session panel's minimum and the board's room when pinned. */
const BESIDE = MIN_WIDTH + BOARD_ROOM.pinned;

/** The width the column can take in its project pane. The minimum wins when the pane is too narrow. */
export function clampManagerWidth(width: number, paneWidth: number): number {
  const max = Math.min(MANAGER_WIDTH.max, paneWidth - BESIDE);
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
