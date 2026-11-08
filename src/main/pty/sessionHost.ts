import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** What the launch check asks of the file system. */
export interface LaunchFiles {
  isExecutableFile(path: string): boolean;
  isDirectory(path: string): boolean;
}

export const localFiles: LaunchFiles = {
  isExecutableFile: (path) => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

// What execvp searches when PATH is unset (macOS's _PATH_DEFPATH).
const DEFAULT_PATH = '/usr/bin:/bin';

/**
 * node-pty's helper ends without a word when it can't run the binary or enter the folder, so
 * check both first and say which one is wrong. The binary is looked up as the helper's execvp
 * will: on the PTY's own PATH, from the session's folder.
 */
function checkLaunch(file: string, cwd: string, env: Record<string, string>, files: LaunchFiles): void {
  if (file.includes('/')) {
    if (!files.isExecutableFile(resolve(cwd, file))) {
      throw new Error(`${file} was not found, or is not an executable file`);
    }
  } else {
    const path = env.PATH ?? DEFAULT_PATH;
    const found = path.split(':').some((dir) => files.isExecutableFile(resolve(cwd, dir || '.', file)));
    if (!found) throw new Error(`${file} was not found on PATH (${path})`);
  }
  if (!files.isDirectory(cwd)) throw new Error(`${cwd} is not a folder`);
}

export interface SessionListener {
  onData(data: Uint8Array): void;
  onStatus(status: ProgramStatus | null): void;
  onExit(e: { exitCode: number; signal: number | null }): void;
}

interface Session {
  proc: PtyLike;
  batcher: OutputBatcher;
  records: ProgramStatusRecords;
}

/** Owns the PTYs of running sessions: output batching, OSC 7501 answering and status. */
export class SessionHost {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly opts: {
      spawnPty: SpawnPty;
      outputBatchMs: number;
      env: Record<string, string>;
      files: LaunchFiles;
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
    checkLaunch(file, spec.cwd, this.opts.env, this.opts.files);
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
    this.sessions.set(id, { proc, batcher, records });

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
      // The exit first, so the task has closed before its working state goes: the other way round,
      // a running session with no state shows as starting for a moment.
      listener.onExit({ exitCode, signal: signal ?? null });
      listener.onStatus(records.current());
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

  /** node-pty's default signal is SIGHUP, as when a terminal window closes; SIGKILL ends it outright. */
  kill(id: string, signal?: 'SIGKILL'): void {
    this.sessions.get(id)?.proc.kill(signal);
  }

  killAll(): void {
    for (const { proc } of this.sessions.values()) proc.kill();
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** What the running session last reported; null before its first report and once it has ended. */
  status(id: string): ProgramStatus | null {
    return this.sessions.get(id)?.records.current() ?? null;
  }
}
