import { BOARD_ROOM, loadPanelPrefs, MIN_WIDTH, savePanelPrefs, type PanelPrefs } from '../panel/panelPrefs';

/** The Todo panel's width: what it starts at, and the range the owner can drag it through. */
export const TODO_WIDTH = { default: 320, min: 280, max: 480 };

const KEY = 'mainframe.todo';
/** Each project's own: unpinned, it waits for the Todo button. */
const DEFAULTS: PanelPrefs = { width: TODO_WIDTH.default, pinned: false };
/** What the pane keeps beside the panel: the session panel's minimum and the board's room when pinned. */
const BESIDE = MIN_WIDTH + BOARD_ROOM.pinned;

/** The width the panel can take in `paneWidth`. The minimum wins when that is too narrow. */
export function clampTodoWidth(width: number, paneWidth: number): number {
  const max = Math.min(TODO_WIDTH.max, paneWidth - BESIDE);
  return Math.round(Math.max(TODO_WIDTH.min, Math.min(width, max)));
}

export const loadTodoPrefs = (storage: Pick<Storage, 'getItem'>, dir: string): PanelPrefs =>
  loadPanelPrefs(storage, dir, { key: KEY, defaults: DEFAULTS });

export const saveTodoPrefs = (storage: Pick<Storage, 'setItem'>, dir: string, prefs: PanelPrefs): void =>
  savePanelPrefs(storage, dir, prefs, KEY);
