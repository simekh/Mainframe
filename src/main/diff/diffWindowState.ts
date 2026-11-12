import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../tasks/taskStore';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DIFF_WINDOW_SIZE = { width: 1000, height: 720 };

/** `diff-window.json`, in the data folder: where the diff window was last, for its next opening. */
const FILE = 'diff-window.json';
const VERSION = 1;

/** The least of a window that must lie on a display for the user to find it and drag it back. */
const MIN_VISIBLE = { width: 100, height: 40 };

function overlaps(a: Rect, b: Rect): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width >= MIN_VISIBLE.width && height >= MIN_VISIBLE.height;
}

/**
 * Where the window opens: where it was, if enough of it still shows on a display (one may have been
 * unplugged), else the default size centred over Mainframe's window.
 */
export function restoreBounds(saved: Rect | null, workAreas: Rect[], parent: Rect): Rect {
  if (saved && workAreas.some((area) => overlaps(saved, area))) return saved;
  return {
    x: Math.round(parent.x + (parent.width - DIFF_WINDOW_SIZE.width) / 2),
    y: Math.round(parent.y + (parent.height - DIFF_WINDOW_SIZE.height) / 2),
    ...DIFF_WINDOW_SIZE,
  };
}

/** The saved bounds, or null when there are none, they are bad, or a newer Mainframe wrote them. */
export function readDiffWindowBounds(dataDir: string, warn: (msg: string) => void): Rect | null {
  const file = join(dataDir, FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Could not read ${file} (${String(err)}); ignoring it`);
    return null;
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record.version === 'number' && record.version > VERSION) return null;
  const bounds = (record.bounds ?? {}) as Record<string, unknown>;
  const { x, y, width, height } = bounds;
  if (
    record.version !== VERSION ||
    ![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    (width as number) <= 0 ||
    (height as number) <= 0
  ) {
    warn(`Could not use ${file} (it does not hold version ${VERSION} window bounds); ignoring it`);
    return null;
  }
  return { x, y, width, height } as Rect;
}

export function writeDiffWindowBounds(dataDir: string, bounds: Rect): void {
  writeJsonAtomic(join(dataDir, FILE), { version: VERSION, bounds });
}

export function diffWindowTitle(view: { taskTitle: string; projectName: string }): string {
  return `Changes · ${view.taskTitle} · ${view.projectName}`;
}
