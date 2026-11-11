import { describe, it, expect } from 'vitest';
import { BOARD_ROOM, MIN_WIDTH, STRIP_WIDTH } from '../panel/panelPrefs';
import { clampTodoWidth, loadHideMine, loadTodoPrefs, saveHideMine, saveTodoPrefs, TODO_WIDTH } from './todoPrefs';

/** A Storage stand-in over a plain map. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('todoPrefs', () => {
  it('the Todo panel starts unpinned at 320 px, per project', () => {
    // The session panel's prefs, the shared ones too, are not the Todo panel's.
    const storage = memoryStorage({ 'mainframe.panel': '{"width":700,"pinned":true}' });
    expect(loadTodoPrefs(storage, '/acme')).toEqual({ width: 320, pinned: false });
    expect(TODO_WIDTH).toEqual({ default: 320, min: 280, max: 480 });

    saveTodoPrefs(storage, '/acme', { width: 400, pinned: true });
    expect(storage.map.get('mainframe.todo:/acme')).toBe('{"width":400,"pinned":true}');
    expect(loadTodoPrefs(storage, '/acme')).toEqual({ width: 400, pinned: true });
    expect(loadTodoPrefs(storage, '/globex')).toEqual({ width: 320, pinned: false });

    expect(loadTodoPrefs(memoryStorage({ 'mainframe.todo:/acme': '{' }), '/acme')).toEqual({ width: 320, pinned: false });
  });

  it("Hide my tasks starts off, is kept per project, and doesn't touch the panel's own prefs", () => {
    const storage = memoryStorage({ 'mainframe.todo:/acme': '{"width":400,"pinned":true}' });
    expect(loadHideMine(storage, '/acme')).toBe(false);

    saveHideMine(storage, '/acme', true);
    expect(storage.map.get('mainframe.todo-hide-mine:/acme')).toBe('true');
    expect(loadHideMine(storage, '/acme')).toBe(true);
    expect(loadHideMine(storage, '/globex')).toBe(false);
    expect(loadTodoPrefs(storage, '/acme')).toEqual({ width: 400, pinned: true });

    saveHideMine(storage, '/globex', true);
    saveHideMine(storage, '/acme', false);
    expect(loadHideMine(storage, '/acme')).toBe(false);
    expect(loadHideMine(storage, '/globex')).toBe(true);
  });

  it('a storage that refuses the write leaves Hide my tasks for this run only', () => {
    const full = {
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    };
    expect(() => saveHideMine(full, '/acme', true)).not.toThrow();
  });

  it.each([
    // The pane keeps 780 px beside the panel: at 1400, 620 px are left, past the panel's own maximum.
    [1400, 2000, 480],
    [1400, 350.4, 350],
    [1400, 100, 280],
    // 320 px are left at 1100.
    [1100, 400, 320],
    [1100, 300, 300],
    [1100, 100, 280],
    // 120 px are left at 900: the minimum wins.
    [900, 400, 280],
  ])('pinned, in a %i px pane, %d px gives %i px', (paneWidth, width, want) => {
    expect(clampTodoWidth(width, paneWidth, true)).toBe(want);
  });

  it.each([
    // Floating, it takes no room: the pane keeps only a strip of board and the panel's own strip beside it, so it grows
    // to its maximum in a 1400 px pane, whatever the manager takes there.
    [1400, 2000, 480],
    [1400, 400, 400],
    [1400, 100, 280],
    // 296 px are left at 400, and 196 at 300: the minimum wins.
    [400, 2000, 296],
    [300, 400, 280],
  ])('floating, in a %i px pane, %d px gives %i px', (paneWidth, width, want) => {
    expect(clampTodoWidth(width, paneWidth, false)).toBe(want);
  });

  it("floating, its own strip counts too; pinned, it doesn't, so a fold keeps its width", () => {
    expect(clampTodoWidth(2000, 500, false)).toBe(500 - BOARD_ROOM.unpinned - STRIP_WIDTH);
    expect(clampTodoWidth(2000, 1100, true)).toBe(1100 - MIN_WIDTH - BOARD_ROOM.pinned);
  });
});
