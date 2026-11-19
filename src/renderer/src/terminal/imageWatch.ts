const POLL_MS = 100;
/** How long a paste waits for its labels before the watch stops reading the screen. */
const LABEL_WAIT_MS = 3000;
/** How long after its last paste a watch takes the next paste in, also once it has stopped reading. */
const JOIN_MS = 10_000;

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
 */
export function createImageWatch(shown: () => number[], record: (added: Added) => void) {
  let highest = 0;
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
      if (numbers.length === w.paths.length) record(w.paths.map((path, i) => ({ path, number: numbers[i] })));
    } else if (Date.now() < w.readUntil) w.timer = setTimeout(poll, POLL_MS);
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
    dispose(): void {
      clearTimeout(watch?.timer);
      watch = undefined;
    },
  };
}
