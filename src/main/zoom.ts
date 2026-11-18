import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './tasks/taskStore';

export type ZoomStep = 'in' | 'out' | 'reset';

/** `zoom.json`, in the data folder: the windows' zoom level, for the next launch. */
const FILE = 'zoom.json';
const VERSION = 1;

/** Chromium's levels: 0 is 100%, each step of 1 is 20% larger or smaller. Half steps, as Electron's own zoom roles take. */
const STEP = 0.5;
/** About 58% to 250%: beyond them the board and terminals are no longer of use. */
export const MIN_ZOOM_LEVEL = -3;
export const MAX_ZOOM_LEVEL = 5;

export function nextZoomLevel(level: number, step: ZoomStep): number {
  if (step === 'reset') return 0;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level + (step === 'in' ? STEP : -STEP)));
}

/** A window's `zoomFactor` for `level`; the factor is what a window takes as it is made. */
export const zoomFactorOf = (level: number): number => 1.2 ** level;

/** The saved level, or 0 (100%) when there is none, it is bad, or a newer Mainframe wrote it. */
export function readZoomLevel(dataDir: string, warn: (msg: string) => void): number {
  const file = join(dataDir, FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Could not read ${file} (${String(err)}); ignoring it`);
    return 0;
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record.version === 'number' && record.version > VERSION) return 0;
  const { level } = record;
  if (record.version !== VERSION || typeof level !== 'number' || level < MIN_ZOOM_LEVEL || level > MAX_ZOOM_LEVEL) {
    warn(`Could not use ${file} (it does not hold a version ${VERSION} zoom level); ignoring it`);
    return 0;
  }
  return level;
}

export function writeZoomLevel(dataDir: string, level: number): void {
  writeJsonAtomic(join(dataDir, FILE), { version: VERSION, level });
}
