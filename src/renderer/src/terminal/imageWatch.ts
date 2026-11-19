const POLL_MS = 100;
/** How long a paste waits for its labels before the watch stops reading the screen. */
const LABEL_WAIT_MS = 3000;
/** How long after its last paste a watch takes the next paste in, also once it has stopped reading. */
const JOIN_MS = 10_000;
/** How long an unsent image's label must stay off the screen before the image counts as taken off the prompt. */
const GONE_MS = 1000;

/**
 * The new label numbers above every one known `before`, distinct and in order; null while fewer than `count` show. More
 * than `count` means labels no paste accounts for: the caller refuses them rather than guess.
 */
export function newLabelNumbers(before: number[], now: number[], count: number): number[] | null {
  const floor = Math.max(0, ...before);
  const added = [...new Set(now.filter((n) => n > floor))].sort((a, b) => a - b);
  return added.length >= count ? added : null;
}

/** A buffer row, as xterm's IBufferLine has it. */
interface Row { isWrapped: boolean; translateToString(trimRight?: boolean): string }

/**
 * The rows' text, one line per row, except that a row soft-wrapped from the one above joins it with no break, so a
 * label the wrap cut in two reads whole. A row the next one continues keeps its trailing spaces: the wrap may fall on one.
 */
export function screenText(rows: Row[]): string {
  return rows.map((row, i) => (i > 0 && !row.isWrapped ? '\n' : '') + row.translateToString(!rows[i + 1]?.isWrapped)).join('');
}

type Added = { path: string; number: number }[];

/**
 * One terminal's watch for the labels its pasted images get, so an image is recorded only with a number that is surely
 * its own. `shown` reads the label numbers on the screen; `record` lists images that got all their labels.
 *
 * - The floor a paste's labels must be above takes in the numbers listed, the ones on screen, and the highest any read
 *   on this terminal has seen, so a label that showed during a watch that gave up is never taken later.
 * - A paste within 10 s of the last one joins its watch, also one that has given up, as its own labels may come late:
 *   the joined pastes record together once every one has its label, and never otherwise.
 * - More new labels than pasted images: none is recorded.
 *
 * An image recorded while `removable()` (the agent waits for a message) can still be taken off the prompt: once its label
 * has been off the screen for a second, `forget` drops it, and it comes back, with its number, if the label does. A turn
 * beginning (`settle`) means it was sent, and it stays for good. One recorded at any other time stays from the start.
 */
export function createImageWatch(
  shown: () => number[],
  record: (added: Added) => void,
  forget: (numbers: number[]) => void,
  removable: () => boolean,
) {
  let highest = 0;
  /** Unsent images by number, with when their label left the screen; and those forgotten, which may come back. */
  const unsent = new Map<number, { path: string; goneSince?: number }>();
  const forgotten = new Map<number, string>();
  let recheck: ReturnType<typeof setTimeout> | undefined;
  let watch: { floor: number; paths: string[]; joinUntil: number; readUntil: number; timer?: ReturnType<typeof setTimeout> } | undefined;

  const read = () => {
    const numbers = shown();
    highest = Math.max(highest, ...numbers);
    return numbers;
  };
  const joinable = () => watch !== undefined && Date.now() < watch.joinUntil;

  const poll = () => {
    const w = watch!;
    w.timer = undefined;
    const numbers = newLabelNumbers([w.floor], read(), w.paths.length);
    if (numbers) {
      watch = undefined;
      if (numbers.length === w.paths.length) {
        const added = w.paths.map((path, i) => ({ path, number: numbers[i] }));
        record(added);
        if (removable()) for (const { path, number } of added) unsent.set(number, { path });
      }
    } else if (Date.now() < w.readUntil) w.timer = setTimeout(poll, POLL_MS);
  };

  const check = (): void => {
    if (unsent.size === 0 && forgotten.size === 0) return;
    const now = Date.now();
    const onScreen = new Set(read());
    const gone: number[] = [];
    for (const [number, image] of unsent) {
      if (onScreen.has(number)) image.goneSince = undefined;
      else if (now - (image.goneSince ??= now) >= GONE_MS) gone.push(number);
    }
    const back = [...forgotten].filter(([number]) => onScreen.has(number)).map(([number, path]) => ({ path, number }));
    for (const number of gone) {
      forgotten.set(number, unsent.get(number)!.path);
      unsent.delete(number);
    }
    for (const { path, number } of back) {
      forgotten.delete(number);
      unsent.set(number, { path });
    }
    if (gone.length > 0) forget(gone);
    if (back.length > 0) record(back);
    // Nothing may be written after a label goes, so nothing else would call this again: due when the first one is.
    clearTimeout(recheck);
    const since = [...unsent.values()].flatMap((image) => image.goneSince ?? []);
    recheck = since.length > 0 ? setTimeout(check, Math.min(...since) + GONE_MS - now) : undefined;
  };

  return {
    /** Whether the next paste joins the watch, so needs no listed numbers. */
    joinable,
    /** Call just before pasting the images' paths. `listed`: the numbers already in the conversation's list. */
    paste(paths: string[], listed: number[]): void {
      const now = Date.now();
      if (joinable()) watch!.paths.push(...paths);
      else watch = { floor: Math.max(highest, ...listed, ...read()), paths: [...paths], joinUntil: 0, readUntil: 0 };
      const w = watch!;
      w.joinUntil = now + JOIN_MS;
      w.readUntil = now + LABEL_WAIT_MS;
      w.timer ??= setTimeout(poll, POLL_MS);
    },
    /** Call when the screen may have changed: forgets an unsent image whose label has gone, brings back one that returned. */
    check,
    /** Call when a turn begins: the unsent images were sent with its message. */
    settle(): void {
      unsent.clear();
      forgotten.clear();
      clearTimeout(recheck);
    },
    dispose(): void {
      clearTimeout(watch?.timer);
      clearTimeout(recheck);
      watch = undefined;
    },
  };
}
