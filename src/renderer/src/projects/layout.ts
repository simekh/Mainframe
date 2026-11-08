/** How the open projects sit in the window, as the owner left it. Projects are named by their folder. */
export interface Layout {
  /** The projects on screen, left to right (or row by row in the grid). */
  shown: string[];
  /** How two or more projects on screen share the window. */
  arrangement: 'columns' | 'grid';
  /** Each project's share of the width in columns; 1 unless the owner dragged a divider. */
  weights: Record<string, number>;
  /** The projects whose manager column the owner hid while the project was alone on screen. */
  managerHidden: string[];
  /** The projects whose manager column the owner showed beside other projects, where it starts hidden for want of room. */
  managerBeside: string[];
  /** The project on screen the owner works in: the list and its pane mark it, and a project brought on screen takes its place. */
  focused: string | null;
}

export const DEFAULT_LAYOUT: Layout = { shown: [], arrangement: 'columns', weights: {}, managerHidden: [], managerBeside: [], focused: null };

const KEY = 'mainframe.layout';

/** The focus where it was if that project is still on screen, or else on the first one there. */
const keepFocus = (layout: Layout): Layout =>
  layout.focused !== null && layout.shown.includes(layout.focused) ? layout : { ...layout, focused: layout.shown[0] ?? null };

/** The layout for the projects open now: what it kept for the others goes, and one project is always on screen. */
export function fitLayout(layout: Layout, open: string[]): Layout {
  const isOpen = (dir: string) => open.includes(dir);
  const shown = layout.shown.filter(isOpen);
  return keepFocus({
    ...layout,
    shown: shown.length > 0 || open.length === 0 ? shown : [open[0]],
    weights: Object.fromEntries(Object.entries(layout.weights).filter(([dir]) => isOpen(dir))),
    managerHidden: layout.managerHidden.filter(isOpen),
    managerBeside: layout.managerBeside.filter(isOpen),
  });
}

/** Puts the project beside the ones on screen and focuses it, or takes it away; the last one stays. */
export function toggleBeside(layout: Layout, dir: string): Layout {
  if (!layout.shown.includes(dir)) return { ...layout, shown: [...layout.shown, dir], focused: dir };
  return layout.shown.length > 1 ? keepFocus({ ...layout, shown: layout.shown.filter((d) => d !== dir) }) : layout;
}

/**
 * Focuses the project. One off screen takes the focused project's place and width, so the panes on
 * screen stay as the owner set them out.
 */
export function focusOn(layout: Layout, dir: string): Layout {
  if (layout.shown.includes(dir)) return { ...layout, focused: dir };
  const at = Math.max(0, layout.shown.indexOf(keepFocus(layout).focused ?? ''));
  const replaced = layout.shown[at];
  const weights = { ...layout.weights };
  if (replaced !== undefined && weights[replaced] !== undefined) weights[dir] = weights[replaced];
  return { ...layout, shown: layout.shown.toSpliced(at, 1, dir), weights, focused: dir };
}

const toggled = (list: string[], dir: string) => (list.includes(dir) ? list.filter((d) => d !== dir) : [...list, dir]);

/** Whether the project's manager column shows: alone on screen until the owner hides it, beside others once they show it. */
export function managerShown(layout: Layout, dir: string): boolean {
  return layout.shown.length > 1 ? layout.managerBeside.includes(dir) : !layout.managerHidden.includes(dir);
}

/** Hides or shows the project's manager column, alone or beside others as it is on screen now. */
export function toggleManager(layout: Layout, dir: string): Layout {
  return layout.shown.length > 1
    ? { ...layout, managerBeside: toggled(layout.managerBeside, dir) }
    : { ...layout, managerHidden: toggled(layout.managerHidden, dir) };
}

/**
 * The columns' weights once the divider after column `index` moves `dx` pixels, over `total` pixels
 * in all. Only the two columns beside it change, and neither goes under `min` pixels.
 */
export function dragDivider(weights: number[], index: number, dx: number, total: number, min: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const px = (w: number) => (w / sum) * total;
  const [left, right] = [px(weights[index]), px(weights[index + 1])];
  const moved = Math.max(min - left, Math.min(dx, right - min));
  const weightOf = (width: number) => Math.round((width / total) * sum * 10_000) / 10_000;
  const next = [...weights];
  next[index] = weightOf(left + moved);
  next[index + 1] = weightOf(right - moved);
  return next;
}

const isPaths = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

export function loadLayout(storage: Pick<Storage, 'getItem'>): Layout {
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (typeof saved !== 'object' || saved === null) return DEFAULT_LAYOUT;
    const { shown, arrangement, weights, managerHidden, managerBeside, focused } = saved;
    const goodWeights =
      typeof weights === 'object' &&
      weights !== null &&
      Object.values(weights).every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0);
    const lists = [shown, managerHidden, managerBeside];
    if (!lists.every(isPaths) || (arrangement !== 'columns' && arrangement !== 'grid') || !goodWeights) return DEFAULT_LAYOUT;
    return {
      shown: shown as string[],
      arrangement,
      weights: weights as Record<string, number>,
      managerHidden: managerHidden as string[],
      managerBeside: managerBeside as string[],
      // Saved before projects had a focus, it has none; fitLayout puts it on one.
      focused: typeof focused === 'string' ? focused : null,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** A storage that refuses the write (full, or turned off) leaves the layout for this run only. */
export function saveLayout(storage: Pick<Storage, 'setItem'>, layout: Layout): void {
  try {
    storage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Nothing to do: the window keeps working with what it has.
  }
}
