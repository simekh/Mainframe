import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { RendererConfig } from '../shared/types';
import type { AppConfig } from './config';
import { resolveClipboardPaste, type ClipboardReader } from './clipboard';
import type { SessionHost } from './pty/sessionHost';
import type { SessionRegistry } from './sessions';

export interface ClipboardDeps {
  clipboard: ClipboardReader;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  newImagePath: () => string;
}

export function registerIpc(
  win: BrowserWindow,
  registry: SessionRegistry,
  host: SessionHost,
  config: AppConfig,
  clipboardDeps: ClipboardDeps,
): void {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle(IPC.getConfig, (): RendererConfig => ({ inputBatchMs: config.inputBatchMs, e2e: config.e2e }));
  ipcMain.handle(IPC.createSession, () => registry.create());
  ipcMain.handle(IPC.spawn, (_e, req: { sessionId: string; cols: number; rows: number }) => {
    const { sessionId, cols, rows } = req;
    host.spawn(sessionId, { ...registry.launchSpec(sessionId), cols, rows }, {
      onData: (data) => send(IPC.data, { sessionId, data }),
      onStatus: (status) => send(IPC.status, { sessionId, status }),
      onExit: ({ exitCode, signal }) => send(IPC.exit, { sessionId, exitCode, signal }),
    });
  });
  ipcMain.handle(IPC.resolvePaste, () =>
    resolveClipboardPaste(clipboardDeps.clipboard, clipboardDeps.writeFile, clipboardDeps.newImagePath),
  );

  ipcMain.on(IPC.write, (_e, sessionId: string, data: string) => host.write(sessionId, data));
  ipcMain.on(IPC.resize, (_e, sessionId: string, cols: number, rows: number) => host.resize(sessionId, cols, rows));
  ipcMain.on(IPC.pause, (_e, sessionId: string) => host.pause(sessionId));
  ipcMain.on(IPC.resume, (_e, sessionId: string) => host.resume(sessionId));
  ipcMain.on(IPC.kill, (_e, sessionId: string) => host.kill(sessionId));
}
