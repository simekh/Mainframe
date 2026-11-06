// Adapted from Parallel Code (MIT): src/components/TerminalView.tsx (enqueueInput) at 97c3558. See THIRD_PARTY_NOTICES.md.

/**
 * Trailing batching of keystrokes, as in Parallel Code, so `MAINFRAME_INPUT_BATCH_MS=8` reproduces
 * its behaviour in the feel test. With interval 0 every keystroke is sent at once.
 */
export class InputBatcher {
  private pending = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly intervalMs: number;
  private readonly maxChars: number;
  private readonly send: (data: string) => void;

  constructor(opts: { intervalMs: number; maxChars?: number; send: (data: string) => void }) {
    this.intervalMs = opts.intervalMs;
    this.maxChars = opts.maxChars ?? 2048;
    this.send = opts.send;
  }

  push(data: string): void {
    if (this.intervalMs === 0) {
      this.send(data);
      return;
    }
    this.pending += data;
    if (this.pending.length >= this.maxChars) {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
  }

  flush(): void {
    this.cancelTimer();
    if (!this.pending) return;
    const data = this.pending;
    this.pending = '';
    this.send(data);
  }

  dispose(): void {
    this.cancelTimer();
    this.pending = '';
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
