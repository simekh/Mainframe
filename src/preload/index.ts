import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type MainframeApi } from '../shared/ipc';

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: MainframeApi = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  listTasks: () => ipcRenderer.invoke(IPC.listTasks),
  startCheck: () => ipcRenderer.invoke(IPC.startCheck),
  startTask: (req) => ipcRenderer.invoke(IPC.startTask, req),
  reopenTask: (taskId) => ipcRenderer.invoke(IPC.reopenTask, taskId),
  closeTask: (taskId) => ipcRenderer.send(IPC.closeTask, taskId),
  changedFiles: (taskId) => ipcRenderer.invoke(IPC.changedFiles, taskId),
  onTasks: (cb) => listen(IPC.tasksChanged, cb),
  getManager: () => ipcRenderer.invoke(IPC.getManager),
  restartManager: () => ipcRenderer.invoke(IPC.restartManager),
  onManager: (cb) => listen(IPC.managerChanged, cb),
  spawn: (req) => ipcRenderer.invoke(IPC.spawn, req),
  write: (sessionId, data) => ipcRenderer.send(IPC.write, sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.resize, sessionId, cols, rows),
  pause: (sessionId) => ipcRenderer.send(IPC.pause, sessionId),
  resume: (sessionId) => ipcRenderer.send(IPC.resume, sessionId),
  resolvePaste: () => ipcRenderer.invoke(IPC.resolvePaste),
  openLink: (url) => ipcRenderer.invoke(IPC.openLink, url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onData: (cb) => listen(IPC.data, cb),
  onExit: (cb) => listen(IPC.exit, cb),
  onStatus: (cb) => listen(IPC.status, cb),
};

contextBridge.exposeInMainWorld('mainframe', api);
