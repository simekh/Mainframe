import { describe, it, expect } from 'vitest';
import { clampTodoWidth, loadTodoPrefs, saveTodoPrefs, TODO_WIDTH } from './todoPrefs';

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
  ])('in a %i px pane, %d px gives %i px', (paneWidth, width, want) => {
    expect(clampTodoWidth(width, paneWidth)).toBe(want);
  });
});
