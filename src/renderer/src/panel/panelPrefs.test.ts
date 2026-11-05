import { describe, it, expect } from 'vitest';
import { clampWidth, DEFAULT_PANEL_PREFS, loadPanelPrefs, savePanelPrefs } from './panelPrefs';

/** A Storage stand-in over a plain map. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('panelPrefs', () => {
  it('clampWidth keeps room for the board when pinned', () => {
    expect(clampWidth(2000, 1400, true)).toBe(1040);
    expect(clampWidth(100, 1400, true)).toBe(420);
    expect(clampWidth(1350, 1400, false)).toBe(1320);
    expect(clampWidth(700, 600, true)).toBe(420);
  });

  it('prefs round-trip, and a bad stored value gives the defaults', () => {
    const storage = memoryStorage();
    savePanelPrefs(storage, { width: 812, pinned: false });
    expect([...storage.map.keys()]).toEqual(['thesource.panel']);
    expect(loadPanelPrefs(storage)).toEqual({ width: 812, pinned: false });

    for (const bad of ['{', '{"width":"x"}']) {
      expect(loadPanelPrefs(memoryStorage({ 'thesource.panel': bad }))).toEqual(DEFAULT_PANEL_PREFS);
    }
    expect(loadPanelPrefs(memoryStorage())).toEqual(DEFAULT_PANEL_PREFS);
    expect(DEFAULT_PANEL_PREFS).toEqual({ width: 640, pinned: true });
  });
});
