// Adapted from Parallel Code (MIT): electron/ipc/pty.ts (attachPtyOutputHandlers) at 97c3558. See THIRD_PARTY_NOTICES.md.

export interface OutputBatcher {
  push(chunk: string): void;
  flush(): void;
  dispose(): void;
}

/**
 * Leading-edge batching of PTY output. Output after a quiet spell (a keystroke echo, a prompt)
 * goes out at once; anything arriving within `intervalMs` of the last send is coalesced, because
 * agent TUIs stream many tiny chunks and one IPC message per chunk costs more than the delay.
 */
export function createOutputBatcher(opts: {
  intervalMs: number;
  maxBytes?: number;
  send: (data: Uint8Array) => void;
}): OutputBatcher {
  const { intervalMs, maxBytes = 65536, send } = opts;
  let queued: string[] = [];
  let queuedBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSendAt = -Infinity;

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    if (queuedBytes === 0) return;
    const data = Buffer.from(queued.join(''), 'utf8');
    queued = [];
    queuedBytes = 0;
    lastSendAt = Date.now();
    send(data);
  };

  return {
    push(chunk) {
      queued.push(chunk);
      queuedBytes += Buffer.byteLength(chunk, 'utf8');
      if (queuedBytes >= maxBytes || (timer === null && Date.now() - lastSendAt >= intervalMs)) {
        flush();
        return;
      }
      timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    dispose() {
      cancelTimer();
      queued = [];
      queuedBytes = 0;
    },
  };
}
