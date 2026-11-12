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

/** The least of the title bar, the window's top strip, that must lie on a display for the user to drag it back. */
const MIN_VISIBLE = { width: 100, height: 40 };

function titleBarShows(window: Rect, area: Rect): boolean {
  const bar = { ...window, height: MIN_VISIBLE.height };
  const width = Math.min(bar.x + bar.width, area.x + area.width) - Math.max(bar.x, area.x);
  const height = Math.min(bar.y + bar.height, area.y + area.height) - Math.max(bar.y, area.y);
  return width >= MIN_VISIBLE.width && height >= MIN_VISIBLE.height;
}

/** `value`, moved into [min, max]; `min` wins where the range is empty. */
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/**
 * Where the window opens: where it was, if enough of its title bar still shows on a display (one may have been
 * unplugged), else the default size centred over Mainframe's window, kept within the display that holds
 * that window's centre, so the title bar can't open off-screen.
 */
export function restoreBounds(saved: Rect | null, workAreas: Rect[], parent: Rect): Rect {
  const shownOn = saved && workAreas.find((a) => titleBarShows(saved, a));
  // No larger than that display: a larger one it was on may have been unplugged.
  if (saved && shownOn) {
    return { ...saved, width: Math.min(saved.width, shownOn.width), height: Math.min(saved.height, shownOn.height) };
  }
  const centre = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
  const area =
    workAreas.find((a) => centre.x >= a.x && centre.x < a.x + a.width && centre.y >= a.y && centre.y < a.y + a.height) ??
    workAreas[0];
  const { width, height } = DIFF_WINDOW_SIZE;
  return {
    x: clamp(Math.round(centre.x - width / 2), area.x, area.x + area.width - width),
    y: clamp(Math.round(centre.y - height / 2), area.y, area.y + area.height - height),
    width,
    height,
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
