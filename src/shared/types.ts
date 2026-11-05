// OSC 7501 program status (https://superlogical.com/rex/docs/build/program-status).
export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error';
export type ProgramKind = 'permission' | 'question' | 'auth';

export interface ProgramReport {
  state: ProgramState | 'clear';
  /** `/`-separated record path; '' is the root record. */
  id: string;
  kind?: ProgramKind;
  progress?: number;
  app?: string;
  title?: string;
  msg?: string;
}

export interface ProgramStatus extends Omit<ProgramReport, 'state'> {
  state: ProgramState;
  updatedAt: number;
}

export type ClipboardPaste =
  | { kind: 'file' | 'image'; path: string }
  | { kind: 'text'; text: string }
  | { kind: 'empty' };

export interface RendererConfig {
  inputBatchMs: number;
  e2e: boolean;
  /** The basename of the project folder. */
  projectName: string;
}

export interface PtyDataEvent {
  sessionId: string;
  data: Uint8Array;
}

export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
  signal: number | null;
}

export interface StatusEvent {
  sessionId: string;
  status: ProgramStatus | null;
}

export interface StartCheck {
  /** Commits on the main checkout's branch that origin/HEAD does not have. */
  ahead: number;
  /** The main checkout's current branch. */
  branch: string;
  /** What origin/HEAD points at, e.g. `origin/stage`. */
  base: string;
}

export interface TaskView {
  id: string;
  title: string;
  description: string;
  slug: string;
  /** `worktree-<slug>`. */
  branch: string;
  /** `<projectDir>/.claude/worktrees/<slug>`. */
  worktreePath: string;
  createdAt: number;
  /** When its last session ended; null while one runs. Closed cards show their age from it. */
  closedAt: number | null;
  /** The running `claude` process; null when the task is closed. */
  session: { id: string; startedWithPrompt: boolean } | null;
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'T' | 'U' | '?';
  /** Null where git gives no count: untracked and binary files. */
  added: number | null;
  removed: number | null;
}
