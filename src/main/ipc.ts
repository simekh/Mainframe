import { ipcMain } from 'electron';
import { IPC } from '../shared/ipc';
import { isAgentName, type AgentChoice, type AgentName, type RendererConfig, type TodoItemRef, type TodoNoteDraft } from '../shared/types';
import { resolveClipboardPaste, type ClipboardReader } from './clipboard';
import { openLink } from './links';
import type { ManagerService } from './manager/managerService';
import type { ProjectRegistry, RegisteredProject } from './projectRegistry';
import type { SessionHost } from './pty/sessionHost';
import type { AgentSettingPatch, AgentsInUse } from './setup/agentsInUse';
import type { SetupFlow } from './setup/setupFlow';
import type { TaskService } from './tasks/taskService';
import type { TodoService } from './todo/todoService';

/** The page's choice of agents, with only names in AGENT_ORDER; anything else is refused. */
function agentChoice(raw: unknown): AgentChoice {
  const { ticked, defaultAgent } = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(ticked) || !ticked.every(isAgentName) || !isAgentName(defaultAgent)) throw new Error("That choice of agents can't be used");
  return { ticked, defaultAgent };
}

export interface ClipboardDeps {
  /** Electron's clipboard: a paste reads it, and a terminal's copy keys write it. */
  clipboard: ClipboardReader & { writeText(text: string): Promise<void> };
  writeFile: (path: string, data: Buffer) => Promise<void>;
  newImagePath: () => string;
}

/** An open project: its tasks, its manager and its to-do list. */
export interface Project extends RegisteredProject {
  service: TaskService;
  manager: ManagerService;
  todo: TodoService;
}

/**
 * The calls that work before any project has started: the page's config, the setup screen's, and
 * opening a link (its How to install buttons). `begun` is the flow's `begin`, so the page's first
 * answer is never a screen it doesn't need.
 */
export function registerSetupIpc(
  rendererConfig: RendererConfig,
  flow: SetupFlow,
  begun: Promise<void>,
  /** Told why the projects couldn't start; it ends the app. */
  startFailed: (err: unknown) => void,
  openExternal: (url: string) => Promise<void>,
): void {
  ipcMain.handle(IPC.getConfig, () => rendererConfig);
  ipcMain.handle(IPC.openLink, (_e, url: unknown) => openLink(url, openExternal));
  ipcMain.handle(IPC.getSetup, async () => {
    await begun;
    return flow.view();
  });
  // The screen would wait for an answer that never comes, so a failure is told and ends the app; the page's invoke still rejects.
  const action = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      startFailed(err);
      throw err;
    }
  };
  ipcMain.handle(IPC.setupLookAgain, () => action(() => flow.lookAgain()));
  ipcMain.handle(IPC.setupFindAgent, (_e, name: unknown) => (isAgentName(name) ? action(() => flow.findAgent(name)) : undefined));
  ipcMain.handle(IPC.setupChooseProject, (_e, choice: unknown) => action(() => flow.chooseProject(agentChoice(choice))));
}

/** The Settings calls: the whole app's, naming no project. Each saves through `agents`, which tells the page. */
export function registerSettingsIpc(agents: AgentsInUse, pickAgent: (name: AgentName) => Promise<string | undefined>): void {
  const agentOf = (name: unknown): AgentName => {
    if (!isAgentName(name)) throw new Error(`There is no agent ${String(name)}`);
    return name;
  };
  ipcMain.handle(IPC.getSettings, () => agents.view());
  ipcMain.handle(IPC.setAgentTicked, (_e, name: unknown, ticked: unknown) => agents.setTicked(agentOf(name), ticked === true));
  ipcMain.handle(IPC.setDefaultAgent, (_e, name: unknown) => agents.setDefault(agentOf(name)));
  // Not offered while the agent's env var names it: that path wins.
  ipcMain.handle(IPC.settingsFindAgent, async (_e, name: unknown) => {
    const agent = agentOf(name);
    if (agents.view().agents[agent].fromEnv) return;
    const path = await pickAgent(agent);
    if (path !== undefined) await agents.find(agent, path);
  });
  ipcMain.handle(IPC.setAgentOptions, (_e, name: unknown, raw: unknown) => {
    // Only these two, each as its type: anything else the page sends is left out.
    const { managerAgent, syncModel } = (raw ?? {}) as Record<string, unknown>;
    const patch: AgentSettingPatch = {};
    if (managerAgent === null || typeof managerAgent === 'string') patch.managerAgent = managerAgent;
    if (typeof syncModel === 'string') patch.syncModel = syncModel;
    agents.saveAgentSetting(agentOf(name), patch);
  });
  ipcMain.handle(IPC.opencodeChoices, () => agents.opencodeChoices());
}

export function registerIpc(
  /** Sends to the window, unless it has gone. */
  send: (channel: string, payload: unknown) => void,
  projects: ProjectRegistry<Project>,
  /** Asks for a folder and opens it; says why itself when it can't. */
  openPicked: () => Promise<void>,
  host: SessionHost,
  clipboardDeps: ClipboardDeps,
): void {
  ipcMain.handle(IPC.listProjects, () => projects.list());
  ipcMain.handle(IPC.openProject, () => openPicked());
  ipcMain.handle(IPC.closeProject, (_e, dir: string) => projects.close(dir));

  const projectOf = (dir: string): Project => {
    const project = projects.get(dir);
    if (!project) throw new Error(`The project ${dir} is not open`);
    return project;
  };
  const tasksOf = (dir: string) => projectOf(dir).service;
  const managerOf = (dir: string) => projectOf(dir).manager;
  const todoOf = (dir: string) => projectOf(dir).todo;

  // Rejections reach the renderer's invoke, which shows them.
  ipcMain.handle(IPC.listTasks, (_e, dir: string) => tasksOf(dir).list());
  ipcMain.handle(IPC.startCheck, (_e, dir: string) => tasksOf(dir).startCheck());
  // Only these four: a card reaches `start` through the Todo service alone, which checks it against the synced list.
  ipcMain.handle(
    IPC.startTask,
    (_e, dir: string, { title, description, noQuestions, agent }: { title: string; description: string; noQuestions: boolean; agent?: unknown }) =>
      tasksOf(dir).start({ title, description, noQuestions, ...(isAgentName(agent) && { agent }) }),
  );
  ipcMain.handle(IPC.reopenTask, (_e, dir: string, taskId: string) => tasksOf(dir).reopen(taskId));
  ipcMain.handle(IPC.changedFiles, (_e, dir: string, taskId: string) => tasksOf(dir).changedFiles(taskId));
  ipcMain.on(IPC.closeTask, (_e, dir: string, taskId: string) => {
    try {
      tasksOf(dir).close(taskId);
    } catch (err) {
      console.error(`[tasks] could not close task ${taskId}`, err);
    }
  });

  ipcMain.handle(IPC.getManager, (_e, dir: string) => managerOf(dir).view());
  ipcMain.handle(IPC.restartManager, (_e, dir: string) => managerOf(dir).start());

  ipcMain.handle(IPC.getTodo, (_e, dir: string) => todoOf(dir).view());
  // What a sync, an allow or a pick found shows in the view, which `todoChanged` sends: the call itself resolves with nothing.
  ipcMain.handle(IPC.syncTodo, async (_e, dir: string) => {
    await todoOf(dir).sync();
  });
  // Not `close()`, which refuses every later sync.
  ipcMain.handle(IPC.cancelTodoSync, (_e, dir: string) => todoOf(dir).cancel());
  ipcMain.handle(IPC.keepTodoSync, (_e, dir: string) => todoOf(dir).keepSyncing());
  ipcMain.handle(IPC.confirmTodoTools, async (_e, dir: string) => {
    await todoOf(dir).confirmTools();
  });
  ipcMain.handle(IPC.pickTodoList, async (_e, dir: string, index: number) => {
    await todoOf(dir).pickList(index);
  });
  ipcMain.handle(IPC.pickTodoModel, async (_e, dir: string, id: string) => {
    await todoOf(dir).pickModel(id);
  });
  ipcMain.handle(IPC.resetTodoSource, (_e, dir: string) => todoOf(dir).resetSource());
  ipcMain.handle(IPC.saveTodoNote, (_e, dir: string, note: TodoNoteDraft) => todoOf(dir).saveNote(note));
  ipcMain.handle(IPC.deleteTodoNote, (_e, dir: string, id: string) => todoOf(dir).deleteNote(id));
  ipcMain.handle(
    IPC.startTodoItem,
    (_e, dir: string, { item, noQuestions, ownersCard }: { item: TodoItemRef; noQuestions: boolean; ownersCard?: boolean }) =>
      todoOf(dir).startItem(item, { noQuestions, ownersCard }),
  );

  // Logged, never thrown: it must not escape the PTY's exit callback or replace a spawn error.
  const sessionEnded = (owner: TaskService | ManagerService, sessionId: string) => {
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
    const owner = projects.ownerOf(sessionId);
    if (!owner) throw new Error(`Unknown session ${sessionId}`);
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
  ipcMain.on(IPC.copyText, (_e, text: string) => {
    clipboardDeps.clipboard.writeText(text).catch((err: unknown) => console.error('[clipboard] copy failed', err));
  });

  ipcMain.on(IPC.write, (_e, sessionId: string, data: string) => host.write(sessionId, data));
  ipcMain.on(IPC.resize, (_e, sessionId: string, cols: number, rows: number) => host.resize(sessionId, cols, rows));
  ipcMain.on(IPC.pause, (_e, sessionId: string) => host.pause(sessionId));
  ipcMain.on(IPC.resume, (_e, sessionId: string) => host.resume(sessionId));
}
