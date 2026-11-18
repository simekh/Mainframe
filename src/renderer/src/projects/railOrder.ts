/** A copy of the list with the item at `from` now at `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  copy.splice(to, 0, ...copy.splice(from, 1));
  return copy;
}

/** Where the dragged row lands: past every other row whose middle is above the dragged row's middle, `center`. */
export function dropIndex(mids: readonly number[], from: number, center: number): number {
  return mids.filter((mid, i) => i !== from && mid < center).length;
}

/** Which way another row slides while the row at `from` hovers over the slot at `to`: up (-1), down (1) or not at all. */
export function shiftOf(i: number, from: number, to: number): -1 | 0 | 1 {
  if (from < i && i <= to) return -1;
  if (to <= i && i < from) return 1;
  return 0;
}
