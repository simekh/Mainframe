import { describe, it, expect } from 'vitest';
import {
  BOARD_ROOM, clampWidth, DEFAULT_PANEL_PREFS, loadPanelPrefs, panelState, roomTaken, roomToPin, savePanelPrefs, STRIP_WIDTH,
  stripShows,
} from './panelPrefs';

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
    // Floating, a strip of board and its own strip beside it.
    expect(clampWidth(1350, 1400, false)).toBe(1296);
    expect(clampWidth(700, 600, true)).toBe(420);
  });

  it("a floating panel's clamp counts its own strip, and a pinned one's doesn't, so a fold keeps its width", () => {
    expect(clampWidth(2000, 1400, false)).toBe(1400 - BOARD_ROOM.unpinned - STRIP_WIDTH);
    expect(clampWidth(2000, 1400, true)).toBe(1400 - BOARD_ROOM.pinned);
  });

  it('a panel that is on is as its pin shows it until the owner first folds or opens it: open pinned, folded floating', () => {
    expect(panelState(false, true, true)).toBe('off');
    expect(panelState(true, null, true)).toBe('open');
    expect(panelState(true, undefined, false)).toBe('folded');
    expect(panelState(true, false, true)).toBe('folded');
    expect(panelState(true, true, false)).toBe('open');
  });

  it('a strip shows while its panel is on and either folded or floating', () => {
    expect(stripShows('open', true)).toBe(false);
    expect(stripShows('open', false)).toBe(true);
    expect(stripShows('folded', true)).toBe(true);
    expect(stripShows('folded', false)).toBe(true);
    expect(stripShows('off', true)).toBe(false);
    expect(stripShows('off', false)).toBe(false);
  });

  it('a panel takes its strip beside the board while that shows, its width when open and pinned, and nothing when off', () => {
    expect(roomTaken('off', true, 400)).toBe(0);
    expect(roomTaken('open', true, 400)).toBe(400);
    expect(roomTaken('open', false, 400)).toBe(STRIP_WIDTH);
    expect(roomTaken('folded', true, 400)).toBe(STRIP_WIDTH);
  });

  it('the session panel pins where the board keeps its room beside it at its narrowest, the strips beside it counted', () => {
    expect(roomToPin(780, 0)).toBe(true);
    expect(roomToPin(779, 0)).toBe(false);
    expect(roomToPin(828, 2 * STRIP_WIDTH)).toBe(true);
    expect(roomToPin(827, 2 * STRIP_WIDTH)).toBe(false);
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
    // Nothing of its own: its defaults, never the session panel's shared prefs, nor anything under its bare key.
    expect(loadPanelPrefs(storage, '/acme', other)).toEqual({ width: 300, pinned: true });
    const bare = memoryStorage({ 'mainframe.other': '{"width":500,"pinned":false}' });
    expect(loadPanelPrefs(bare, '/acme', other)).toEqual({ width: 300, pinned: true });

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
