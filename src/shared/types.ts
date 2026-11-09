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
}

/** An open project. Its folder is its id in every call and event that concerns it. */
export interface ProjectView {
  dir: string;
  /** The folder's basename. */
  name: string;
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

/** The oldest Claude Code Mainframe works with: it needs OSC 7501 status reports and hook `onFailure`. */
export const MIN_CLAUDE_VERSION = '2.1.295';

/** What looking for a program Mainframe needs (git, claude) found. */
export type CheckState = 'found' | 'missing' | 'too-old' | 'broken';

export interface ProgramCheck {
  state: CheckState;
  /** The file looked at; not set when nothing was found anywhere. */
  path?: string;
  /** What the program says it is, when it said so. */
  version?: string;
}

/** What the setup screen shows. The main process publishes a new one at every step, and `null` once the board can appear. */
export interface SetupView {
  /** The welcome at a true first start; "something moved" at any later start. */
  intro: 'welcome' | 'moved';
  git: ProgramCheck;
  claude: ProgramCheck;
  /** MAINFRAME_CLAUDE_BIN names the claude, so it is the only place looked at and nothing is saved. */
  claudeFromEnv: boolean;
  /** The user asked to look again and something is still missing: a fresh install may need a new terminal. */
  lookedAgain: boolean;
  /** Everything is found, and a first project is the next question. */
  askProject: boolean;
  platform: NodeJS.Platform;
}

export interface StartCheck {
  /** Commits on the main checkout's branch that origin/HEAD does not have. */
  ahead: number;
  /** The main checkout's current branch. */
  branch: string;
  /** What origin/HEAD points at: the remote's default branch, as `origin/<branch>`. */
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
  /** The to-do card the task was started from; null for a task that wasn't. */
  card: TaskCardRef | null;
  /** The running `claude` process; null when the task is closed. */
  session: { id: string; startedWithPrompt: boolean } | null;
}

export interface ManagerView {
  /** The running `claude` process; null before it starts and after it ends. */
  session: { id: string; startedWithPrompt: boolean } | null;
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'T' | 'U' | '?';
  /** Null where git gives no count: untracked and binary files. */
  added: number | null;
  removed: number | null;
}

/** Where a project's to-do list came from, as the sync run found it. */
export interface TodoSource {
  kind: string;
  board: string | null;
  list: string;
  url: string | null;
}

export interface TodoChecklist {
  name: string;
  items: { text: string; done: boolean }[];
}

export interface TodoCard {
  id: string;
  number: string | null;
  title: string;
  description: string;
  labels: string[];
  checklists: TodoChecklist[];
  url: string | null;
  forOwner: boolean;
  urgent: boolean;
}

export interface TodoNote {
  id: string;
  title: string;
  text: string;
}

/** A note as the owner saves it: without an `id` it is new. */
export type TodoNoteDraft = { id?: string; title: string; text: string };

/** A card or a note on the list, by its id. */
export type TodoItemRef = { kind: 'card' | 'note'; id: string };

export interface TodoListRef {
  name: string;
  board: string | null;
  url: string | null;
}

/** What the sync run needs from the owner before it can go on. */
export type TodoAsk = { kind: 'tools'; connector: string; tools: string[] } | { kind: 'lists'; lists: TodoListRef[] };

export interface TodoView {
  source: TodoSource | null;
  syncedAt: number | null;
  cards: TodoCard[];
  notes: TodoNote[];
  syncing: boolean;
  error: string | null;
  ask: TodoAsk | null;
  /** Whether tools are confirmed or a list picked, so "Set up again" has something to forget. */
  setUp: boolean;
}

/** What a task started from a card keeps of it. */
export interface TaskCardRef {
  sourceKind: string;
  id: string;
  number: string | null;
  url: string | null;
  labels: string[];
  /** The card's place in the list when the task started, from 0. */
  position: number;
  urgent: boolean;
}
