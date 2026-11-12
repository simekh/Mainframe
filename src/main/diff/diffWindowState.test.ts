import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffWindowTitle, readDiffWindowBounds, restoreBounds, writeDiffWindowBounds } from './diffWindowState';

const screen = { x: 0, y: 0, width: 1920, height: 1080 };
const parent = { x: 100, y: 50, width: 1400, height: 900 };

describe('restoreBounds', () => {
  it('keeps saved bounds that show on a display', () => {
    const saved = { x: 100, y: 100, width: 900, height: 600 };
    expect(restoreBounds(saved, [screen], parent)).toEqual(saved);
  });

  it.each([{ x: 5000, y: 0, width: 900, height: 600 }, null])(
    'centres the default size over the parent when saved bounds are off every display (%j)',
    (saved) => {
      expect(restoreBounds(saved, [screen], parent)).toEqual({ x: 300, y: 140, width: 1000, height: 720 });
    },
  );

  it('needs 100 by 40 px on a display', () => {
    const size = { width: 500, height: 500 };
    const onScreen = (x: number, y: number) => restoreBounds({ x, y, ...size }, [screen], parent);
    const dropped = { x: 300, y: 140, width: 1000, height: 720 };
    expect(onScreen(1920 - 99, 0)).toEqual(dropped);
    expect(onScreen(1920 - 100, 0)).toEqual({ x: 1820, y: 0, ...size });
    expect(onScreen(0, 1080 - 39)).toEqual(dropped);
    expect(onScreen(0, 1080 - 40)).toEqual({ x: 0, y: 1040, ...size });
  });
});

describe('the bounds file', () => {
  let dataDir: string;
  let warnings: string[];
  const warn = (msg: string) => warnings.push(msg);
  beforeEach(() => {
    dataDir = mkdtempSync(join(os.tmpdir(), 'mainframe-diff-window-'));
    warnings = [];
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it('round-trips, and a missing, bad or newer one is null', () => {
    const bounds = { x: 10, y: 20, width: 800, height: 500 };
    writeDiffWindowBounds(dataDir, bounds);
    expect(readDiffWindowBounds(dataDir, warn)).toEqual(bounds);

    const file = join(dataDir, 'diff-window.json');
    rmSync(file);
    expect(readDiffWindowBounds(dataDir, warn)).toBeNull();
    expect(warnings).toEqual([]);

    writeFileSync(file, JSON.stringify({ version: 1, bounds: { x: 'a' } }));
    expect(readDiffWindowBounds(dataDir, warn)).toBeNull();
    expect(warnings).toHaveLength(1);

    writeFileSync(file, JSON.stringify({ version: 2, bounds }));
    expect(readDiffWindowBounds(dataDir, warn)).toBeNull();
  });
});

describe('diffWindowTitle', () => {
  it('names the task and the project', () => {
    expect(diffWindowTitle({ taskTitle: 'Fix login', projectName: 'shop' })).toBe('Changes · Fix login · shop');
  });
});
