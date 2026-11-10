import type {
  ChangedFile,
  ClipboardPaste,
  ManagerView,
  PtyDataEvent,
  ProjectView,
  PtyExitEvent,
  RendererConfig,
  SetupView,
  StartCheck,
  StatusEvent,
  TaskView,
  TodoItemRef,
  TodoNote,
  TodoNoteDraft,
  TodoView,
} from './types';

export const IPC = {
  getConfig: 'app:get-config',
  getSetup: 'setup:get',
  setupChanged: 'setup:changed',
  setupLookAgain: 'setup:look-again',
  setupFindClaude: 'setup:find-claude',
  setupChooseProject: 'setup:choose-project',
  listProjects: 'projects:list',
  openProject: 'projects:open',
  closeProject: 'projects:close',
  projectsChanged: 'projects:changed',
  showProject: 'projects:show',
  listTasks: 'tasks:list',
  startCheck: 'tasks:start-check',
  startTask: 'tasks:start',
  reopenTask: 'tasks:reopen',
  closeTask: 'tasks:close',
  changedFiles: 'tasks:changed-files',
  tasksChanged: 'tasks:changed',
  getManager: 'manager:get',
  restartManager: 'manager:restart',
  managerChanged: 'manager:changed',
  getTodo: 'todo:get',
  todoChanged: 'todo:changed',
  syncTodo: 'todo:sync',
  cancelTodoSync: 'todo:cancel-sync',
  confirmTodoTools: 'todo:confirm-tools',
  pickTodoList: 'todo:pick-list',
  resetTodoSource: 'todo:reset-source',
  saveTodoNote: 'todo:save-note',
  deleteTodoNote: 'todo:delete-note',
  startTodoItem: 'todo:start-item',
  spawn: 'pty:spawn',
  write: 'pty:write',
  resize: 'pty:resize',
  pause: 'pty:pause',
  resume: 'pty:resume',
  data: 'pty:data',
  exit: 'pty:exit',
  status: 'session:status',
  resolvePaste: 'clipboard:resolve-paste',
  copyText: 'clipboard:copy-text',
  openLink: 'shell:open-link',
} as const;

/**
 * What the preload exposes to the renderer as `window.mainframe`. The task, manager and Todo calls and
 * events name their project by its folder (`ProjectView.dir`); the PTY ones need only the session id,
 * which no two projects share.
 */
export interface MainframeApi {
  /** The system Mainframe runs on, there from the start: the page needn't wait for it. */
  platform: NodeJS.Platform;
  getConfig(): Promise<RendererConfig>;
  /**
   * The setup screen to show, once main has checked git and claude: null when none is needed, which
   * also means the projects have started. The project calls below are answered only from then on.
   */
  getSetup(): Promise<SetupView | null>;
  /** Every change to the setup screen, with the whole view; null once the projects have started. */
  onSetup(cb: (view: SetupView | null) => void): () => void;
  /** Checks again what was not found. Rejects when Mainframe can't start, and main then says why and ends the app. */
  setupLookAgain(): Promise<void>;
  /** Asks for a claude file, and uses it if it works. Not offered when MAINFRAME_CLAUDE_BIN names the claude. */
  setupFindClaude(): Promise<void>;
  /** Asks for the first project's folder and starts Mainframe on it. */
  setupChooseProject(): Promise<void>;
  /** The open projects, in the order the owner opened them. */
  listProjects(): Promise<ProjectView[]>;
  /** Asks for a folder and opens it as a project; main says why when it can't. */
  openProject(): Promise<void>;
  /** Ends the project's sessions as Quit does, so they come back when it opens again. */
  closeProject(dir: string): Promise<void>;
  /** Every change to the open projects, with the whole list. */
  onProjects(cb: (projects: ProjectView[]) => void): () => void;
  /** A project the owner just opened, or picked again while it was open, to bring on screen. */
  onShowProject(cb: (dir: string) => void): () => void;
  listTasks(dir: string): Promise<TaskView[]>;
  startCheck(dir: string): Promise<StartCheck | null>;
  startTask(dir: string, req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView>;
  reopenTask(dir: string, taskId: string): Promise<TaskView>;
  closeTask(dir: string, taskId: string): void;
  /** What the task changed in its worktree since it left origin/HEAD; null without a worktree. */
  changedFiles(dir: string, taskId: string): Promise<ChangedFile[] | null>;
  /** Every change to a project's tasks, with its whole list. */
  onTasks(cb: (e: { dir: string; tasks: TaskView[] }) => void): () => void;
  getManager(dir: string): Promise<ManagerView>;
  /** Launches the manager again, carrying on its chat, unless it runs; rejects with why it couldn't. */
  restartManager(dir: string): Promise<ManagerView>;
  /** Every change to a project's manager session. */
  onManager(cb: (e: { dir: string; view: ManagerView }) => void): () => void;
  getTodo(dir: string): Promise<TodoView>;
  /** Every change to a project's Todo panel, with its whole view. */
  onTodo(cb: (e: { dir: string; view: TodoView }) => void): () => void;
  /** Reads the list with a background run; what it found, asked or failed with shows in the view. */
  syncTodo(dir: string): Promise<void>;
  /** Stops the project's running sync, which leaves the list and the view's error as they were; a later sync starts afresh. */
  cancelTodoSync(dir: string): Promise<void>;
  /** Allows the tools the sync asked about to read the list, and syncs again. */
  confirmTodoTools(dir: string): Promise<void>;
  /** Picks the list the sync asked about, by its index in the ask, and syncs again. */
  pickTodoList(dir: string, index: number): Promise<void>;
  /** Forgets the allowed tools and the picked list; the cards and notes stay. */
  resetTodoSource(dir: string): Promise<void>;
  /** Adds a note, or changes the one with `id`. */
  saveTodoNote(dir: string, note: TodoNoteDraft): Promise<TodoNote>;
  deleteTodoNote(dir: string, id: string): Promise<void>;
  /**
   * Starts a task from a card or a note. A note leaves the list once its task has started. A card marked for the owner
   * starts only with `ownersCard`, which only the ticket's Start anyway sets: the owner chose it.
   */
  startTodoItem(dir: string, req: { item: TodoItemRef; noQuestions: boolean; ownersCard?: boolean }): Promise<TaskView>;
  /** The PTY calls and events below take a task's or the manager's `session.id`. */
  spawn(req: { sessionId: string; cols: number; rows: number }): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  resolvePaste(): Promise<ClipboardPaste>;
  /** Puts the text on the clipboard, through main: the page's `navigator.clipboard` refuses when the document isn't focused. */
  copyText(text: string): void;
  /** Opens a web page in the owner's browser; main passes on only http: and https: addresses. */
  openLink(url: string): Promise<void>;
  getPathForFile(file: File): string;
  onData(cb: (e: PtyDataEvent) => void): () => void;
  onExit(cb: (e: PtyExitEvent) => void): () => void;
  onStatus(cb: (e: StatusEvent) => void): () => void;
}
