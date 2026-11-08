import { BOARD_ROOM, loadPanelPrefs, MIN_WIDTH, savePanelPrefs, type PanelPrefs } from '../panel/panelPrefs';

/** The Todo panel's width: what it starts at, and the range the owner can drag it through. */
export const TODO_WIDTH = { default: 320, min: 280, max: 480 };

const KEY = 'mainframe.todo';
/** Each project's own: unpinned, it waits for the Todo button. */
const DEFAULTS: PanelPrefs = { width: TODO_WIDTH.default, pinned: false };
/**
 * The width the panel can take in `paneWidth`. Pinned, it keeps the session panel's minimum and the board's room
 * beside it, as the manager does; floating, it takes no room and keeps a strip of board, as the session panel's
 * float does. The minimum wins when that is too narrow.
 */
export function clampTodoWidth(width: number, paneWidth: number, pinned: boolean): number {
  const beside = pinned ? MIN_WIDTH + BOARD_ROOM.pinned : BOARD_ROOM.unpinned;
  const max = Math.min(TODO_WIDTH.max, paneWidth - beside);
  return Math.round(Math.max(TODO_WIDTH.min, Math.min(width, max)));
}

/**
 * Whether the project's list leaves out the cards for the owner. Its own small pref, so the panels' shared
 * `PanelPrefs` stay as they are; each project keeps its own, and it starts off.
 */
const HIDE_MINE_KEY = 'mainframe.todo-hide-mine';

export function loadHideMine(storage: Pick<Storage, 'getItem'>, dir: string): boolean {
  try {
    const saved: unknown = JSON.parse(storage.getItem(`${HIDE_MINE_KEY}:${dir}`) ?? 'null');
    return (saved as Record<string, unknown> | null)?.hideMine === true;
  } catch {
    return false;
  }
}

/** A storage that refuses the write leaves the choice for this run only. */
export function saveHideMine(storage: Pick<Storage, 'setItem'>, dir: string, hideMine: boolean): void {
  try {
    storage.setItem(`${HIDE_MINE_KEY}:${dir}`, JSON.stringify({ hideMine }));
  } catch {
    // Nothing to do: the list keeps working with what it has.
  }
}

export const loadTodoPrefs = (storage: Pick<Storage, 'getItem'>, dir: string): PanelPrefs =>
  loadPanelPrefs(storage, dir, { key: KEY, defaults: DEFAULTS });

export const saveTodoPrefs = (storage: Pick<Storage, 'setItem'>, dir: string, prefs: PanelPrefs): void =>
  savePanelPrefs(storage, dir, prefs, KEY);
