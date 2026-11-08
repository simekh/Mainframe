import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type MainframeApi } from '../shared/ipc';

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: MainframeApi = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  closeProject: (dir) => ipcRenderer.invoke(IPC.closeProject, dir),
  onProjects: (cb) => listen(IPC.projectsChanged, cb),
  onShowProject: (cb) => listen(IPC.showProject, cb),
  listTasks: (dir) => ipcRenderer.invoke(IPC.listTasks, dir),
  startCheck: (dir) => ipcRenderer.invoke(IPC.startCheck, dir),
  startTask: (dir, req) => ipcRenderer.invoke(IPC.startTask, dir, req),
  reopenTask: (dir, taskId) => ipcRenderer.invoke(IPC.reopenTask, dir, taskId),
  closeTask: (dir, taskId) => ipcRenderer.send(IPC.closeTask, dir, taskId),
  changedFiles: (dir, taskId) => ipcRenderer.invoke(IPC.changedFiles, dir, taskId),
  onTasks: (cb) => listen(IPC.tasksChanged, cb),
  getManager: (dir) => ipcRenderer.invoke(IPC.getManager, dir),
  restartManager: (dir) => ipcRenderer.invoke(IPC.restartManager, dir),
  onManager: (cb) => listen(IPC.managerChanged, cb),
  getTodo: (dir) => ipcRenderer.invoke(IPC.getTodo, dir),
  onTodo: (cb) => listen(IPC.todoChanged, cb),
  syncTodo: (dir) => ipcRenderer.invoke(IPC.syncTodo, dir),
  cancelTodoSync: (dir) => ipcRenderer.invoke(IPC.cancelTodoSync, dir),
  confirmTodoTools: (dir) => ipcRenderer.invoke(IPC.confirmTodoTools, dir),
  pickTodoList: (dir, index) => ipcRenderer.invoke(IPC.pickTodoList, dir, index),
  resetTodoSource: (dir) => ipcRenderer.invoke(IPC.resetTodoSource, dir),
  saveTodoNote: (dir, note) => ipcRenderer.invoke(IPC.saveTodoNote, dir, note),
  deleteTodoNote: (dir, id) => ipcRenderer.invoke(IPC.deleteTodoNote, dir, id),
  startTodoItem: (dir, req) => ipcRenderer.invoke(IPC.startTodoItem, dir, req),
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
