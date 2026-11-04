import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type TheSourceApi } from '../shared/ipc';

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: TheSourceApi = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  createSession: () => ipcRenderer.invoke(IPC.createSession),
  spawn: (req) => ipcRenderer.invoke(IPC.spawn, req),
  write: (sessionId, data) => ipcRenderer.send(IPC.write, sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.resize, sessionId, cols, rows),
  pause: (sessionId) => ipcRenderer.send(IPC.pause, sessionId),
  resume: (sessionId) => ipcRenderer.send(IPC.resume, sessionId),
  kill: (sessionId) => ipcRenderer.send(IPC.kill, sessionId),
  resolvePaste: () => ipcRenderer.invoke(IPC.resolvePaste),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onData: (cb) => listen(IPC.data, cb),
  onExit: (cb) => listen(IPC.exit, cb),
  onStatus: (cb) => listen(IPC.status, cb),
  onRedrawTerminals: (cb) => listen(IPC.redrawTerminals, () => cb()),
};

contextBridge.exposeInMainWorld('thesource', api);
