import { ipcMain } from 'electron';
import { IPC } from '../shared/ipc';
import type { RendererConfig } from '../shared/types';
import { resolveClipboardPaste, type ClipboardReader } from './clipboard';
import { openLink } from './links';
import type { ManagerService } from './manager/managerService';
import type { SessionHost } from './pty/sessionHost';
import type { TaskService } from './tasks/taskService';

export interface ClipboardDeps {
  clipboard: ClipboardReader;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  newImagePath: () => string;
}

/** What a session's launch, reports and end go to: the manager for its own, the tasks for the rest. */
type SessionOwner = Pick<TaskService, 'launchSpec' | 'noteStatus' | 'onSessionExit'>;

export function registerIpc(
  /** Sends to the window, unless it has gone. */
  send: (channel: string, payload: unknown) => void,
  service: TaskService,
  manager: ManagerService,
  host: SessionHost,
  rendererConfig: RendererConfig,
  clipboardDeps: ClipboardDeps,
  openExternal: (url: string) => Promise<void>,
): void {
  ipcMain.handle(IPC.getConfig, () => rendererConfig);

  // Rejections reach the renderer's invoke, which shows them.
  ipcMain.handle(IPC.listTasks, () => service.list());
  ipcMain.handle(IPC.startCheck, () => service.startCheck());
  ipcMain.handle(IPC.startTask, (_e, req: Parameters<TaskService['start']>[0]) => service.start(req));
  ipcMain.handle(IPC.reopenTask, (_e, taskId: string) => service.reopen(taskId));
  ipcMain.handle(IPC.changedFiles, (_e, taskId: string) => service.changedFiles(taskId));
  ipcMain.on(IPC.closeTask, (_e, taskId: string) => {
    try {
      service.close(taskId);
    } catch (err) {
      console.error(`[tasks] could not close task ${taskId}`, err);
    }
  });

  ipcMain.handle(IPC.getManager, () => manager.view());
  ipcMain.handle(IPC.restartManager, () => manager.start());

  const ownerOf = (sessionId: string): SessionOwner => (manager.owns(sessionId) ? manager : service);

  // Logged, never thrown: it must not escape the PTY's exit callback or replace a spawn error.
  const sessionEnded = (owner: SessionOwner, sessionId: string) => {
    try {
      owner.onSessionExit(sessionId);
    } catch (err) {
      console.error(`[sessions] could not record the end of session ${sessionId}`, err);
    }
  };

  ipcMain.handle(IPC.spawn, (_e, req: { sessionId: string; cols: number; rows: number }) => {
    const { sessionId, cols, rows } = req;
    // A reloaded window mounts the terminals of sessions that still run. Their PTY already sends
    // to this window; it takes the new terminal's size, and is resumed in case the old one had
    // paused it. The new page knows nothing of their state yet: it gets the last one again.
    if (host.has(sessionId)) {
      host.resize(sessionId, cols, rows);
      host.resume(sessionId);
      send(IPC.status, { sessionId, status: host.status(sessionId) });
      return;
    }
    const owner = ownerOf(sessionId);
    try {
      host.spawn(sessionId, { ...owner.launchSpec(sessionId), cols, rows }, {
        onData: (data) => send(IPC.data, { sessionId, data }),
        onStatus: (status) => {
          owner.noteStatus(sessionId, status?.state ?? null);
          send(IPC.status, { sessionId, status });
        },
        onExit: ({ exitCode, signal }) => {
          send(IPC.exit, { sessionId, exitCode, signal });
          sessionEnded(owner, sessionId);
        },
      });
    } catch (err) {
      // The terminal shows the error; its task or the manager stops rather than wait for an exit that never comes.
      sessionEnded(owner, sessionId);
      throw err;
    }
  });
  ipcMain.handle(IPC.resolvePaste, () =>
    resolveClipboardPaste(clipboardDeps.clipboard, clipboardDeps.writeFile, clipboardDeps.newImagePath),
  );

  ipcMain.handle(IPC.openLink, (_e, url: unknown) => openLink(url, openExternal));

  ipcMain.on(IPC.write, (_e, sessionId: string, data: string) => host.write(sessionId, data));
  ipcMain.on(IPC.resize, (_e, sessionId: string, cols: number, rows: number) => host.resize(sessionId, cols, rows));
  ipcMain.on(IPC.pause, (_e, sessionId: string) => host.pause(sessionId));
  ipcMain.on(IPC.resume, (_e, sessionId: string) => host.resume(sessionId));
}
