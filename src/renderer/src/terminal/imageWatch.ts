/**
 * The numbers of the labels a paste of `count` images added: the `count` smallest of those showing `now` above every one
 * known `before` it, in order. Null until that many show, so a paste that got fewer labels is never given a wrong number.
 */
export function newLabelNumbers(before: number[], now: number[], count: number): number[] | null {
  const floor = Math.max(0, ...before);
  const added = [...new Set(now.filter((n) => n > floor))].sort((a, b) => a - b).slice(0, count);
  return added.length === count ? added : null;
}
