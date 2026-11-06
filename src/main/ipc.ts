import { basename } from 'node:path';
import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { RendererConfig } from '../shared/types';
import type { AppConfig } from './config';
import { resolveClipboardPaste, type ClipboardReader } from './clipboard';
import { openLink } from './links';
import type { SessionHost } from './pty/sessionHost';
import type { TaskService } from './tasks/taskService';

export interface ClipboardDeps {
  clipboard: ClipboardReader;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  newImagePath: () => string;
}

export function registerIpc(
  win: BrowserWindow,
  service: TaskService,
  host: SessionHost,
  config: AppConfig,
  clipboardDeps: ClipboardDeps,
  openExternal: (url: string) => Promise<void>,
): void {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle(
    IPC.getConfig,
    (): RendererConfig => ({ inputBatchMs: config.inputBatchMs, e2e: config.e2e, projectName: basename(config.projectDir) }),
  );

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

  // Logged, never thrown: it must not escape the PTY's exit callback or replace a spawn error.
  const sessionEnded = (sessionId: string) => {
    try {
      service.onSessionExit(sessionId);
    } catch (err) {
      console.error(`[tasks] could not record the end of session ${sessionId}`, err);
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
    try {
      host.spawn(sessionId, { ...service.launchSpec(sessionId), cols, rows }, {
        onData: (data) => send(IPC.data, { sessionId, data }),
        onStatus: (status) => {
          service.noteStatus(sessionId, status?.state ?? null);
          send(IPC.status, { sessionId, status });
        },
        onExit: ({ exitCode, signal }) => {
          send(IPC.exit, { sessionId, exitCode, signal });
          sessionEnded(sessionId);
        },
      });
    } catch (err) {
      // The terminal shows the error; the task closes rather than wait for an exit that never comes.
      sessionEnded(sessionId);
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
