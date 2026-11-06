import type {
  ChangedFile,
  ClipboardPaste,
  ManagerView,
  PtyDataEvent,
  PtyExitEvent,
  RendererConfig,
  StartCheck,
  StatusEvent,
  TaskView,
} from './types';

export const IPC = {
  getConfig: 'app:get-config',
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
  spawn: 'pty:spawn',
  write: 'pty:write',
  resize: 'pty:resize',
  pause: 'pty:pause',
  resume: 'pty:resume',
  data: 'pty:data',
  exit: 'pty:exit',
  status: 'session:status',
  resolvePaste: 'clipboard:resolve-paste',
  openLink: 'shell:open-link',
} as const;

/** What the preload exposes to the renderer as `window.mainframe`. */
export interface MainframeApi {
  getConfig(): Promise<RendererConfig>;
  listTasks(): Promise<TaskView[]>;
  startCheck(): Promise<StartCheck | null>;
  startTask(req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView>;
  reopenTask(taskId: string): Promise<TaskView>;
  closeTask(taskId: string): void;
  /** What the task changed in its worktree since it left origin/HEAD; null without a worktree. */
  changedFiles(taskId: string): Promise<ChangedFile[] | null>;
  /** Every change to the tasks, with the whole list. */
  onTasks(cb: (tasks: TaskView[]) => void): () => void;
  getManager(): Promise<ManagerView>;
  /** Launches the manager again, carrying on its chat, unless it runs; rejects with why it couldn't. */
  restartManager(): Promise<ManagerView>;
  /** Every change to the manager's session. */
  onManager(cb: (view: ManagerView) => void): () => void;
  /** The PTY calls and events below take a task's or the manager's `session.id`. */
  spawn(req: { sessionId: string; cols: number; rows: number }): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  resolvePaste(): Promise<ClipboardPaste>;
  /** Opens a web page in the owner's browser; main passes on only http: and https: addresses. */
  openLink(url: string): Promise<void>;
  getPathForFile(file: File): string;
  onData(cb: (e: PtyDataEvent) => void): () => void;
  onExit(cb: (e: PtyExitEvent) => void): () => void;
  onStatus(cb: (e: StatusEvent) => void): () => void;
}
