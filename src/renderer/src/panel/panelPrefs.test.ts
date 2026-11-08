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

  it('each project keeps its own prefs, and a bad stored value gives the defaults', () => {
    const storage = memoryStorage();
    savePanelPrefs(storage, '/acme', { width: 812, pinned: false });
    savePanelPrefs(storage, '/globex', { width: 500, pinned: true });
    expect(loadPanelPrefs(storage, '/acme')).toEqual({ width: 812, pinned: false });
    expect(loadPanelPrefs(storage, '/globex')).toEqual({ width: 500, pinned: true });

    for (const bad of ['{', '{"width":"x"}']) {
      expect(loadPanelPrefs(memoryStorage({ 'mainframe.panel:/acme': bad }), '/acme')).toEqual(DEFAULT_PANEL_PREFS);
    }
    expect(loadPanelPrefs(memoryStorage(), '/acme')).toEqual(DEFAULT_PANEL_PREFS);
    expect(DEFAULT_PANEL_PREFS).toEqual({ width: 640, pinned: true });
  });

  it('a project with none of its own starts from the prefs every project shared before', () => {
    const storage = memoryStorage({ 'mainframe.panel': '{"width":700,"pinned":false}' });
    expect(loadPanelPrefs(storage, '/acme')).toEqual({ width: 700, pinned: false });
    savePanelPrefs(storage, '/acme', { width: 900, pinned: true });
    expect(loadPanelPrefs(storage, '/acme')).toEqual({ width: 900, pinned: true });
    expect(storage.map.get('mainframe.panel')).toBe('{"width":700,"pinned":false}');
  });

  it("another key and defaults leave the session panel's alone", () => {
    const storage = memoryStorage({ 'mainframe.panel': '{"width":700,"pinned":false}' });
    const other = { key: 'mainframe.other', defaults: { width: 300, pinned: true } };
    // Nothing of its own: its defaults, never the session panel's shared prefs.
    expect(loadPanelPrefs(storage, '/acme', other)).toEqual({ width: 300, pinned: true });

    savePanelPrefs(storage, '/acme', { width: 360, pinned: false }, 'mainframe.other');
    expect(storage.map.get('mainframe.other:/acme')).toBe('{"width":360,"pinned":false}');
    expect(loadPanelPrefs(storage, '/acme', other)).toEqual({ width: 360, pinned: false });
    expect(loadPanelPrefs(storage, '/acme')).toEqual({ width: 700, pinned: false });
    expect(loadPanelPrefs(memoryStorage({ 'mainframe.other:/acme': '{' }), '/acme', other)).toEqual({ width: 300, pinned: true });
  });

  it('a storage that refuses the write is ignored', () => {
    const full = {
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    };
    expect(() => savePanelPrefs(full, '/acme', { width: 700, pinned: true })).not.toThrow();
  });
});
