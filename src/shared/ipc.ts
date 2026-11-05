import type {
  ClipboardPaste,
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
  tasksChanged: 'tasks:changed',
  spawn: 'pty:spawn',
  write: 'pty:write',
  resize: 'pty:resize',
  pause: 'pty:pause',
  resume: 'pty:resume',
  data: 'pty:data',
  exit: 'pty:exit',
  status: 'session:status',
  resolvePaste: 'clipboard:resolve-paste',
} as const;

/** What the preload exposes to the renderer as `window.thesource`. */
export interface TheSourceApi {
  getConfig(): Promise<RendererConfig>;
  listTasks(): Promise<TaskView[]>;
  startCheck(): Promise<StartCheck | null>;
  startTask(req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView>;
  reopenTask(taskId: string): Promise<TaskView>;
  closeTask(taskId: string): void;
  /** Every change to the tasks, with the whole list. */
  onTasks(cb: (tasks: TaskView[]) => void): () => void;
  /** The PTY calls and events below take a task's `session.id`. */
  spawn(req: { sessionId: string; cols: number; rows: number }): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  resolvePaste(): Promise<ClipboardPaste>;
  getPathForFile(file: File): string;
  onData(cb: (e: PtyDataEvent) => void): () => void;
  onExit(cb: (e: PtyExitEvent) => void): () => void;
  onStatus(cb: (e: StatusEvent) => void): () => void;
}
