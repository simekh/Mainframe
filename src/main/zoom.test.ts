import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, nextZoomLevel, readZoomLevel, writeZoomLevel, zoomFactorOf } from './zoom';

describe('nextZoomLevel', () => {
  it('steps in and out by half a level, and resets to 0', () => {
    expect(nextZoomLevel(0, 'in')).toBe(0.5);
    expect(nextZoomLevel(0, 'out')).toBe(-0.5);
    expect(nextZoomLevel(2.5, 'reset')).toBe(0);
  });

  it('stays within its limits', () => {
    expect(nextZoomLevel(MAX_ZOOM_LEVEL, 'in')).toBe(MAX_ZOOM_LEVEL);
    expect(nextZoomLevel(MIN_ZOOM_LEVEL, 'out')).toBe(MIN_ZOOM_LEVEL);
  });
});

describe('zoomFactorOf', () => {
  it("is Chromium's 1.2 to the power of the level", () => {
    expect(zoomFactorOf(0)).toBe(1);
    expect(zoomFactorOf(2)).toBeCloseTo(1.44);
  });
});

describe('the zoom file', () => {
  let dataDir: string;
  let warnings: string[];
  const warn = (msg: string) => warnings.push(msg);
  beforeEach(() => {
    dataDir = mkdtempSync(join(os.tmpdir(), 'mainframe-zoom-'));
    warnings = [];
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it('round-trips, and a missing, bad, out-of-range or newer one is 0', () => {
    writeZoomLevel(dataDir, 1.5);
    expect(readZoomLevel(dataDir, warn)).toBe(1.5);

    const file = join(dataDir, 'zoom.json');
    rmSync(file);
    expect(readZoomLevel(dataDir, warn)).toBe(0);
    expect(warnings).toEqual([]);

    writeFileSync(file, JSON.stringify({ version: 1, level: 'big' }));
    expect(readZoomLevel(dataDir, warn)).toBe(0);
    writeFileSync(file, JSON.stringify({ version: 1, level: MAX_ZOOM_LEVEL + 1 }));
    expect(readZoomLevel(dataDir, warn)).toBe(0);
    expect(warnings).toHaveLength(2);

    writeFileSync(file, JSON.stringify({ version: 2, level: 1 }));
    expect(readZoomLevel(dataDir, warn)).toBe(0);
  });
});
