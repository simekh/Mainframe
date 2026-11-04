// Adapted from Parallel Code (MIT): src/components/TerminalView.tsx (enqueueOutput, flushOutputQueue,
// scheduleOutputFlush) at 97c3558. See THIRD_PARTY_NOTICES.md.

/**
 * Queue between PTY output and `term.write`, with flow control. Chunks are written as one payload
 * per frame (or at once past `flushAt`), one write in flight at a time. The watermark counts bytes
 * pushed and not yet acknowledged by the write's `done`; above `highWater` the PTY is paused, and
 * it resumes once the terminal has caught up below `lowWater`.
 */
export class OutputFlow {
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private writeInFlight = false;
  private watermark = 0;
  private paused = false;
  private cancelScheduled: (() => void) | undefined;
  private drainWaiters: Array<() => void> = [];
  private readonly highWater: number;
  private readonly lowWater: number;
  private readonly flushAt: number;

  constructor(
    private readonly opts: {
      write: (data: Uint8Array, done: () => void) => void;
      pause: () => void;
      resume: () => void;
      schedule: (flush: () => void) => () => void;
      highWater?: number;
      lowWater?: number;
      flushAt?: number;
    },
  ) {
    this.highWater = opts.highWater ?? 256 * 1024;
    this.lowWater = opts.lowWater ?? 32 * 1024;
    this.flushAt = opts.flushAt ?? 64 * 1024;
  }

  push(chunk: Uint8Array): void {
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;
    this.watermark += chunk.length;
    if (this.watermark > this.highWater && !this.paused) {
      this.paused = true;
      this.opts.pause();
    }
    // Large bursts go out at once to keep perceived latency low.
    if (this.queuedBytes >= this.flushAt) this.flushQueue();
    else this.scheduleFlush();
  }

  /** Runs `cb` once everything pushed so far has been written, or at once when idle. */
  whenDrained(cb: () => void): void {
    if (!this.writeInFlight && this.queue.length === 0) cb();
    else this.drainWaiters.push(cb);
  }

  private scheduleFlush(): void {
    if (this.cancelScheduled) return;
    this.cancelScheduled = this.opts.schedule(() => {
      this.cancelScheduled = undefined;
      this.flushQueue();
    });
  }

  private flushQueue(): void {
    if (this.writeInFlight || this.queue.length === 0) return;
    const payload = this.takeQueue();
    this.writeInFlight = true;
    this.opts.write(payload, () => {
      this.writeInFlight = false;
      this.watermark = Math.max(this.watermark - payload.length, 0);
      if (this.watermark < this.lowWater && this.paused) {
        this.paused = false;
        this.opts.resume();
      }
      if (this.queue.length > 0) {
        this.scheduleFlush();
        return;
      }
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      for (const cb of waiters) cb();
    });
  }

  private takeQueue(): Uint8Array {
    const chunks = this.queue;
    const total = this.queuedBytes;
    this.queue = [];
    this.queuedBytes = 0;
    if (chunks.length === 1) return chunks[0];
    const payload = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
    return payload;
  }
}
