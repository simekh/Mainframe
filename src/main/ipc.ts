import { basename } from 'node:path';
import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { RendererConfig } from '../shared/types';
import type { AppConfig } from './config';
import { resolveClipboardPaste, type ClipboardReader } from './clipboard';
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
  ipcMain.on(IPC.closeTask, (_e, taskId: string) => {
    try {
      service.close(taskId);
    } catch (err) {
      console.error(`[tasks] could not close task ${taskId}`, err);
    }
  });

  ipcMain.handle(IPC.spawn, (_e, req: { sessionId: string; cols: number; rows: number }) => {
    const { sessionId, cols, rows } = req;
    try {
      host.spawn(sessionId, { ...service.launchSpec(sessionId), cols, rows }, {
        onData: (data) => send(IPC.data, { sessionId, data }),
        onStatus: (status) => send(IPC.status, { sessionId, status }),
        onExit: ({ exitCode, signal }) => {
          send(IPC.exit, { sessionId, exitCode, signal });
          try {
            service.onSessionExit(sessionId);
          } catch (err) {
            console.error(`[tasks] could not record the exit of session ${sessionId}`, err);
          }
        },
      });
    } catch (err) {
      // The terminal shows the error; the task closes rather than wait for an exit that never comes.
      service.onSessionExit(sessionId);
      throw err;
    }
  });
  ipcMain.handle(IPC.resolvePaste, () =>
    resolveClipboardPaste(clipboardDeps.clipboard, clipboardDeps.writeFile, clipboardDeps.newImagePath),
  );

  ipcMain.on(IPC.write, (_e, sessionId: string, data: string) => host.write(sessionId, data));
  ipcMain.on(IPC.resize, (_e, sessionId: string, cols: number, rows: number) => host.resize(sessionId, cols, rows));
  ipcMain.on(IPC.pause, (_e, sessionId: string) => host.pause(sessionId));
  ipcMain.on(IPC.resume, (_e, sessionId: string) => host.resume(sessionId));
}
