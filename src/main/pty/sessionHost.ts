import { accessSync, constants, statSync } from 'node:fs';
import type { ProgramStatus } from '../../shared/types';
import { OSC7501_SUPPORT_REPLY, Osc7501Scanner } from '../status/osc7501';
import { ProgramStatusRecords } from '../status/programStatus';
import { resolveExecutable, type ExecutableFiles } from './findExecutable';
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
export interface LaunchFiles extends ExecutableFiles {
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

export interface SessionListener {
  onData(data: Uint8Array): void;
  onStatus(status: ProgramStatus | null): void;
  onExit(e: { exitCode: number; signal: number | null }): void;
}

interface Session {
  proc: PtyLike;
  batcher: OutputBatcher;
  records: ProgramStatusRecords;
  /** Whether Windows' one kill of the pty has been made. */
  killed: boolean;
  /** Ends the early answers of `answerStatusEarly`; set while they run. */
  stopEarly?: () => void;
}

/** Turns bracketed paste on: a program sends it as its screen takes input, in raw mode, so a reply is not echoed. */
const PASTE_ON = '\x1b[?2004h';
const EARLY_EVERY_MS = 250;
const EARLY_FOR_MS = 30_000;

/** Owns the PTYs of running sessions: output batching, OSC 7501 answering and status. */
export class SessionHost {
  private readonly sessions = new Map<string, Session>();
  /** The waits of `whenAllEnded`, ended when the last running session exits. */
  private readonly endWaits: Array<() => void> = [];
  /** Set by killAll: the app is quitting, and no session starts. */
  private quitting = false;

  constructor(
    private readonly opts: {
      spawnPty: SpawnPty;
      outputBatchMs: number;
      env: Record<string, string>;
      platform: NodeJS.Platform;
      files: LaunchFiles;
      log?: (line: string) => void;
    },
  ) {}

  spawn(
    id: string,
    /**
     * `env` is the session's own, laid over the host's. `answerStatusEarly`: answer OSC 7501 before the program asks, from
     * when its screen takes input until its query or first report. Claude Code waits 2 seconds from the start of its
     * probe, which under load is long before its query gets out; a reply already in the pty is read once it waits.
     */
    spec: { argv: string[]; cwd: string; env?: Record<string, string>; cols: number; rows: number; answerStatusEarly?: boolean },
    listener: SessionListener,
  ): void {
    // Started after the hang-ups, it would still be running as the app goes.
    if (this.quitting) throw new Error('Mainframe is quitting');
    if (this.sessions.has(id)) throw new Error(`Session ${id} is already running`);
    const { log, platform, files } = this.opts;
    const env = { ...this.opts.env, ...spec.env };
    const [name, ...args] = spec.argv;
    // node-pty's helper ends without a word when it can't run the binary or enter the folder, so
    // check both first and say which one is wrong. The binary is looked up on the PTY's own PATH,
    // and node-pty gets the absolute path found.
    const file = resolveExecutable(name, { env, cwd: spec.cwd, platform, files });
    if (!files.isDirectory(spec.cwd)) throw new Error(`${spec.cwd} is not a folder`);
    const proc = this.opts.spawnPty(file, args, {
      name: 'xterm-256color',
      cwd: spec.cwd,
      env,
      cols: spec.cols,
      rows: spec.rows,
    });
    const scanner = new Osc7501Scanner(
      log && ((payload) => log(`[osc7501] ${id} ${payload.trim() === '?' ? 'query' : payload}`)),
    );
    const records = new ProgramStatusRecords();
    const batcher = createOutputBatcher({ intervalMs: this.opts.outputBatchMs, send: (d) => listener.onData(d) });
    const session: Session = { proc, batcher, records, killed: false };
    this.sessions.set(id, session);
    // The end of the output so far, to see PASTE_ON split across two chunks; null once the early answers have begun, or
    // once the session has asked or reported, so none are needed.
    let pasteTail: string | null = spec.answerStatusEarly ? '' : null;

    proc.onData((chunk) => {
      for (const event of scanner.feed(chunk)) {
        pasteTail = null;
        session.stopEarly?.();
        if (event.type === 'query') {
          // Answer at once: Claude Code sends CSI c right after the query, and xterm's reply to
          // that, if it arrives first, means "unsupported".
          proc.write(OSC7501_SUPPORT_REPLY);
        } else {
          records.apply(event.report, Date.now());
          listener.onStatus(records.current());
        }
      }
      if (pasteTail !== null) {
        const seen = pasteTail + chunk;
        pasteTail = seen.slice(1 - PASTE_ON.length);
        if (seen.includes(PASTE_ON)) {
          pasteTail = null;
          this.answerEarly(id, session);
        }
      }
      batcher.push(chunk);
    });

    proc.onExit(({ exitCode, signal }) => {
      session.stopEarly?.();
      batcher.flush();
      batcher.dispose();
      records.onProcessExit();
      // The exit first, so the task has closed before its working state goes: the other way round,
      // a running session with no state shows as starting for a moment.
      listener.onExit({ exitCode, signal: signal ?? null });
      listener.onStatus(records.current());
      this.sessions.delete(id);
      if (this.sessions.size === 0) for (const end of this.endWaits.splice(0)) end();
    });
  }

  /**
   * Writes the OSC 7501 reply now and every EARLY_EVERY_MS, for EARLY_FOR_MS or until `session.stopEarly` is called.
   * Again and again, as Claude Code drops a reply it reads before its probe waits, and on a busy machine that wait may
   * begin seconds after its screen takes input. A pty that refuses one has gone: the answers end there, as an error thrown
   * from the timer would reach no caller.
   */
  private answerEarly(id: string, session: Session): void {
    const answer = () => {
      try {
        this.write(id, OSC7501_SUPPORT_REPLY);
      } catch {
        session.stopEarly?.();
      }
    };
    const every = setInterval(answer, EARLY_EVERY_MS);
    const end = setTimeout(() => session.stopEarly?.(), EARLY_FOR_MS);
    session.stopEarly = () => {
      clearInterval(every);
      clearTimeout(end);
      delete session.stopEarly;
    };
    answer();
  }

  write(id: string, data: string): void {
    this.ignoringExit(() => this.sessions.get(id)?.proc.write(data));
  }

  resize(id: string, cols: number, rows: number): void {
    this.ignoringExit(() => this.sessions.get(id)?.proc.resize(cols, rows));
  }

  /**
   * Windows' ConPTY refuses a write or a resize for up to about a second after the pty has exited,
   * before node-pty reports the exit. The exit follows, so there the error says nothing the
   * session's end won't. On other systems the error goes up as it comes.
   */
  private ignoringExit(act: () => void): void {
    try {
      act();
    } catch (err) {
      if (this.opts.platform !== 'win32') throw err;
    }
  }

  pause(id: string): void {
    this.sessions.get(id)?.proc.pause();
  }

  resume(id: string): void {
    this.sessions.get(id)?.proc.resume();
  }

  /** node-pty's default signal is SIGHUP, as when a terminal window closes; SIGKILL ends it outright. */
  kill(id: string, signal?: 'SIGKILL'): void {
    const session = this.sessions.get(id);
    if (session) this.killSession(session, signal);
  }

  /** Hangs up on every running session as the app quits; no session starts after it. */
  killAll(): void {
    this.quitting = true;
    for (const session of this.sessions.values()) this.killSession(session);
  }

  /** Resolves once no session is running, or once `timeoutMs` has gone by with some still running. */
  whenAllEnded(timeoutMs: number): Promise<void> {
    if (this.sessions.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.endWaits.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Windows has no signals: node-pty's kill throws when given one, and a second kill of a pty can
   * crash the process (node-pty issue 983). A project's close and Quit both kill, so there each
   * pty is killed once, with no signal.
   */
  private killSession(session: Session, signal?: 'SIGKILL'): void {
    session.stopEarly?.();
    if (this.opts.platform !== 'win32') {
      session.proc.kill(signal);
      return;
    }
    if (session.killed) return;
    session.killed = true;
    session.proc.kill();
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** What the running session last reported; null before its first report and once it has ended. */
  status(id: string): ProgramStatus | null {
    return this.sessions.get(id)?.records.current() ?? null;
  }
}
