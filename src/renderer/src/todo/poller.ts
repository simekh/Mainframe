/**
 * Calls poll() every every() ms while active(); also at once when started. Returns stop. A tick while inactive is
 * skipped, so nothing polls in the background, and every() is read again for each wait.
 */
export function startPolling(o: {
  every: () => number;
  active: () => boolean;
  poll: () => void;
  setTimer?: (fn: () => void, ms: number) => () => void;
}): () => void {
  const setTimer =
    o.setTimer ??
    ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
  let cancel: () => void;
  const tick = () => {
    if (o.active()) o.poll();
    cancel = setTimer(tick, o.every());
  };
  tick();
  return () => cancel();
}
