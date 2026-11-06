import { describe, it, expect } from 'vitest';
import { clampManagerWidth, loadManagerWidth, MANAGER_WIDTH, saveManagerWidth } from './managerPrefs';

/** A Storage stand-in over a plain map. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('managerPrefs', () => {
  it.each([
    // The window keeps 780 px beside the column: 620 px are left for it at 1400.
    [1400, 2000, 620],
    [1400, 480.4, 480],
    [1400, 100, 320],
    // 320 px are left at 1100: only the minimum.
    [1100, 400, 320],
    [1100, 100, 320],
    // 120 px are left at 900: the minimum wins.
    [900, 400, 320],
    // A wide window leaves the column its own maximum.
    [2400, 2000, 640],
  ])('in a %i px window, %d px gives %i px', (windowWidth, width, want) => {
    expect(clampManagerWidth(width, windowWidth)).toBe(want);
  });

  it('the width round-trips, and a bad stored value gives 400', () => {
    const storage = memoryStorage();
    saveManagerWidth(storage, 496);
    expect([...storage.map.keys()]).toEqual(['mainframe.manager']);
    expect(loadManagerWidth(storage)).toBe(496);

    for (const bad of ['{', 'null', '{"width":"x"}', '{"width":1e999}']) {
      expect(loadManagerWidth(memoryStorage({ 'mainframe.manager': bad }))).toBe(400);
    }
    expect(loadManagerWidth(memoryStorage())).toBe(400);
    expect(MANAGER_WIDTH).toEqual({ default: 400, min: 320, max: 640 });
  });

  it('a storage that refuses the write is ignored', () => {
    const full = {
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    };
    expect(() => saveManagerWidth(full, 500)).not.toThrow();
  });
});
