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
  /** The Windows build Mainframe runs on, for xterm's ConPTY handling; null on other systems. */
  windowsBuild: number | null;
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

/** The oldest OpenCode Mainframe works with. */
export const MIN_OPENCODE_VERSION = '2.1.0';

/** The agent CLIs a task can run on. */
export type AgentName = 'claude' | 'opencode';

export const AGENT_NAMES: Record<AgentName, string> = { claude: 'Claude Code', opencode: 'OpenCode' };

/** The order agents are listed and tried in. */
export const AGENT_ORDER = ['claude', 'opencode'] as const satisfies readonly AgentName[];

export const isAgentName = (value: unknown): value is AgentName => AGENT_ORDER.includes(value as AgentName);

export const MIN_AGENT_VERSION: Record<AgentName, string> = { claude: MIN_CLAUDE_VERSION, opencode: MIN_OPENCODE_VERSION };

/** What looking for a program Mainframe needs (git, an agent) found. */
type CheckState = 'found' | 'missing' | 'too-old' | 'broken';

export type ProgramCheck = {
  /** The file looked at; not set when nothing was found anywhere. */
  path?: string;
  /** What the program says it is, when it said so. */
  version?: string;
} & ({ state: 'found'; path: string } | { state: Exclude<CheckState, 'found'> });

/** Which agents Mainframe uses, and the one the manager, the Todo sync and new tasks run on. */
export interface AgentChoice {
  ticked: AgentName[];
  defaultAgent: AgentName;
}

export interface AgentStatus { check: ProgramCheck; fromEnv: boolean; ticked: boolean }

/** What the setup screen shows. The main process publishes a new one at every step, and `null` once the board can appear. */
export interface SetupView {
  /** The welcome at a true first start; "something moved" at any later start. */
  intro: 'welcome' | 'moved';
  git: ProgramCheck;
  /**
   * `fromEnv`: the agent's env var (MAINFRAME_CLAUDE_BIN, MAINFRAME_OPENCODE_BIN) names it, so it is the only place looked
   * at and nothing is saved. `ticked`: the settings use it (with nothing saved, when it is found). An agent works for
   * Mainframe when it is ticked and found.
   */
  agents: Record<AgentName, AgentStatus>;
  /** The user asked to look again and something is still missing: a fresh install may need a new terminal. */
  lookedAgain: boolean;
  /** Everything needed is found at a first start: the agents step and the project question, starting from this choice. */
  ask: AgentChoice | null;
}

/** One agent in Settings: as the setup screen shows it, with its saved options. */
export interface AgentView extends AgentStatus { managerAgent?: string; syncModel?: string }

/** What the Settings dialog shows, for the whole app. */
export interface SettingsView {
  agents: Record<AgentName, AgentView>;
  /** The saved default, which the choice shows. */ defaultAgent: AgentName;
  /** The default this run uses: another ticked agent when the saved one didn't work at start. */ runDefault: AgentName;
}

/** OpenCode's lists for Settings: only each agent's id, the first primary one marked as OpenCode's default. */
export interface OpencodeChoices { agents: { id: string; isDefault: boolean }[]; models: SyncModel[] }

export interface TaskGitState {
  /** gone: no local branch. no-commits: no commit was made on the branch, though it may have moved up to a newer base. merged: merging it into the base changes nothing. */
  branch: 'gone' | 'no-commits' | 'merged' | 'unmerged';
  /** The commit the branch pointed at when it was judged; null when it is gone. */
  tip: string | null;
  /** Paths with uncommitted changes or untracked (not ignored) files in the worktree; [] when the folder is gone or is not a worktree's top. */
  uncommitted: string[];
  /** The worktree has something other than the task's branch checked out: another branch, or a detached HEAD. False when the folder is gone or is not a worktree's top. */
  elsewhere: boolean;
  /** Subjects of the commits on the branch, or on the worktree's HEAD, that are on neither the base nor any remote branch, newest first. */
  unsaved: string[];
}

export type ByHandWhy = 'not-launcher' | 'one-click-failed' | 'uncommitted' | 'own-commits';

/** How an update gets applied: by one click, or by commands the user runs themselves. */
export type UpdateHow = { kind: 'one-click' } | { kind: 'by-hand'; why: ByHandWhy; commands: string[] };

/** A newer release than the one running: its version ('0.5.0'), the notes for every release missed, and how to take it. */
export interface UpdateAvailable {
  latest: string;
  notes: string;
  how: UpdateHow;
}

/**
 * The app's update state. `current` is the running release, null when the clone has none (shown as unreleased);
 * `failure` is why the last one-click update did not happen, as start.mjs said.
 */
export interface UpdateView {
  current: string | null;
  available: UpdateAvailable | null;
  failure: string | null;
}

/** What a Check for Updates… found. */
export type CheckResult = { kind: 'available' } | { kind: 'up-to-date' } | { kind: 'failed'; why: string };

export interface StartCheck {
  /** Commits on the main checkout's branch that origin/HEAD does not have. */
  ahead: number;
  /** The main checkout's current branch. */
  branch: string;
  /** What origin/HEAD points at: the remote's default branch, as `origin/<branch>`. */
  base: string;
}

/** Where a task is off the board: put back on the to-do list, finished, or discarded. */
export type TaskPlace = 'putBack' | 'finished' | 'discarded';

/** Finished or discarded: its worktree and branch are gone, and only Continue brings it back. */
export const isEnded = (place: TaskPlace | null | undefined): boolean => place === 'finished' || place === 'discarded';

/** What a Discard would lose: files in the worktree and commits that exist nowhere else. */
export interface DiscardPreview {
  uncommitted: string[];
  unsaved: string[];
}

export interface TaskView {
  id: string;
  title: string;
  description: string;
  slug: string;
  /** `worktree-<slug>`. */
  branch: string;
  /** `<projectDir>/<the agent's worktrees folder>/<slug>`. */
  worktreePath: string;
  createdAt: number;
  /** When its last session ended; null while one runs. Closed cards show their age from it. */
  closedAt: number | null;
  /** Where the task is; null on the board. */
  place: TaskPlace | null;
  /** When it went to its place; null on the board. */
  endedAt: number | null;
  /** A running task the last round found had nothing to lose. */
  merged: boolean;
  /** A Put back is under way for it, from its session to the sync after it: Reopen, Put back and Discard wait for it. */
  puttingBack: boolean;
  /** Why Put back, or a removal of its worktree, failed, kept in memory until a reopen or a move clears it; null for none. */
  problem: string | null;
  /** The to-do card the task was started from; null for a task that wasn't. */
  card: TaskCardRef | null;
  /** The agent CLI its sessions run on. */
  agent: AgentName;
  /** The running agent process; null when the task is closed. */
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

/** One line of a file's diff: a removed line has no new number, an added one no old number. */
export interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

/** Why a file shows a note in place of its lines. */
export type DiffNote = 'binary' | 'tooLarge' | 'notShown' | 'modeOnly' | 'noLines' | 'empty' | 'repository';

export interface FileDiff {
  path: string;
  status: ChangedFile['status'];
  /** The panel's counts; for an untracked text file, its line count and 0. Null where unknown. */
  added: number | null;
  removed: number | null;
  /** Each hunk a run of lines; empty when `note` is set. */
  hunks: DiffLine[][];
  note: DiffNote | null;
}

export type DiffResult =
  | { kind: 'files'; files: FileDiff[] }
  | { kind: 'noWorktree' }
  | { kind: 'failed'; message: string };

/** What the diff window shows. `seq` orders the requests: a higher one is a later click. */
export interface DiffView {
  seq: number;
  projectName: string;
  taskTitle: string;
  focus: string;
  result: DiffResult;
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
  /** The task Put back took off the board: starting the note continues it. */
  taskId?: string;
}

/** A note as the owner saves it: without an `id` it is new. */
export type TodoNoteDraft = { id?: string; title: string; text: string; taskId?: string };

/** A card or a note on the list, by its id. */
export type TodoItemRef = { kind: 'card' | 'note'; id: string };

export interface TodoListRef {
  name: string;
  board: string | null;
  url: string | null;
}

/** A model the OpenCode sync can run on; `price` is USD per million tokens, null when OpenCode doesn't know it. */
export interface SyncModel { id: string; name: string; status: string; price: { input: number; output: number } | null }

/** What the sync run needs from the owner before it can go on. */
export type TodoAsk =
  | { kind: 'tools'; connector: string; tools: string[] }
  | { kind: 'lists'; lists: TodoListRef[] }
  | { kind: 'model'; models: SyncModel[]; suggested: string | null };

export interface TodoView {
  source: TodoSource | null;
  syncedAt: number | null;
  cards: TodoCard[];
  notes: TodoNote[];
  syncing: boolean;
  /** The running sync has gone on past two minutes and the owner has not said to keep going. */
  longSync: boolean;
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
