import type { ProgramStatus } from '../../shared/types';
import { OSC7501_SUPPORT_REPLY, Osc7501Scanner } from '../status/osc7501';
import { ProgramStatusRecords } from '../status/programStatus';
import { createOutputBatcher, type OutputBatcher } from './outputBatcher';

export interface PtyLike {
  onData(cb: (data: string) => void): unknown;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(signal?: string): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  opts: { name: string; cwd: string; env: Record<string, string>; cols: number; rows: number },
) => PtyLike;

export interface SessionListener {
  onData(data: Uint8Array): void;
  onStatus(status: ProgramStatus | null): void;
  onExit(e: { exitCode: number; signal: number | null }): void;
}

interface Session {
  proc: PtyLike;
  batcher: OutputBatcher;
}

/** Owns the PTYs of running sessions: output batching, OSC 7501 answering and status. */
export class SessionHost {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly opts: {
      spawnPty: SpawnPty;
      outputBatchMs: number;
      env: Record<string, string>;
      log?: (line: string) => void;
    },
  ) {}

  spawn(
    id: string,
    spec: { argv: string[]; cwd: string; cols: number; rows: number },
    listener: SessionListener,
  ): void {
    if (this.sessions.has(id)) throw new Error(`Session ${id} is already running`);
    const { log } = this.opts;
    const [file, ...args] = spec.argv;
    const proc = this.opts.spawnPty(file, args, {
      name: 'xterm-256color',
      cwd: spec.cwd,
      env: this.opts.env,
      cols: spec.cols,
      rows: spec.rows,
    });
    const scanner = new Osc7501Scanner(
      log && ((payload) => log(`[osc7501] ${id} ${payload.trim() === '?' ? 'query' : payload}`)),
    );
    const records = new ProgramStatusRecords();
    const batcher = createOutputBatcher({ intervalMs: this.opts.outputBatchMs, send: (d) => listener.onData(d) });
    this.sessions.set(id, { proc, batcher });

    proc.onData((chunk) => {
      for (const event of scanner.feed(chunk)) {
        if (event.type === 'query') {
          // Answer at once: Claude Code sends CSI c right after the query, and xterm's reply to
          // that, if it arrives first, means "unsupported".
          proc.write(OSC7501_SUPPORT_REPLY);
        } else {
          records.apply(event.report, Date.now());
          listener.onStatus(records.current());
        }
      }
      batcher.push(chunk);
    });

    proc.onExit(({ exitCode, signal }) => {
      batcher.flush();
      batcher.dispose();
      records.onProcessExit();
      listener.onStatus(records.current());
      listener.onExit({ exitCode, signal: signal ?? null });
      this.sessions.delete(id);
    });
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(cols, rows);
  }

  pause(id: string): void {
    this.sessions.get(id)?.proc.pause();
  }

  resume(id: string): void {
    this.sessions.get(id)?.proc.resume();
  }

  /** node-pty's default signal is SIGHUP, as when a terminal window closes. */
  kill(id: string): void {
    this.sessions.get(id)?.proc.kill();
  }

  killAll(): void {
    for (const { proc } of this.sessions.values()) proc.kill();
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }
}
