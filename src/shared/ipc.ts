import type {
  ClipboardPaste,
  PtyDataEvent,
  PtyExitEvent,
  RendererConfig,
  SessionInfo,
  StatusEvent,
} from './types';

export const IPC = {
  getConfig: 'app:get-config',
  createSession: 'session:create',
  spawn: 'pty:spawn',
  write: 'pty:write',
  resize: 'pty:resize',
  pause: 'pty:pause',
  resume: 'pty:resume',
  kill: 'pty:kill',
  data: 'pty:data',
  exit: 'pty:exit',
  status: 'session:status',
  resolvePaste: 'clipboard:resolve-paste',
  redrawTerminals: 'app:redraw-terminals',
} as const;

/** What the preload exposes to the renderer as `window.thesource`. */
export interface TheSourceApi {
  getConfig(): Promise<RendererConfig>;
  createSession(): Promise<SessionInfo>;
  spawn(req: { sessionId: string; cols: number; rows: number }): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  kill(sessionId: string): void;
  resolvePaste(): Promise<ClipboardPaste>;
  getPathForFile(file: File): string;
  onData(cb: (e: PtyDataEvent) => void): () => void;
  onExit(cb: (e: PtyExitEvent) => void): () => void;
  onStatus(cb: (e: StatusEvent) => void): () => void;
  onRedrawTerminals(cb: () => void): () => void;
}
