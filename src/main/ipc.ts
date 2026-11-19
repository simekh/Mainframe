import { existsSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { ipcMain, shell } from 'electron';
import { IPC } from '../shared/ipc';
import { isAgentName, type AgentChoice, type AgentName, type DiffView, type ImageEntry, type RendererConfig, type TodoItemRef, type TerminalText, type TodoNoteDraft } from '../shared/types';
import { resolveClipboardPaste, type ClipboardReader } from './clipboard';
import { readImages, recordImages } from './images/imageLog';
import { openLink } from './links';
import type { ManagerService } from './manager/managerService';
import type { ProjectRegistry, RegisteredProject } from './projectRegistry';
import type { SessionHost } from './pty/sessionHost';
import type { AgentSettingPatch, AgentsInUse } from './setup/agentsInUse';
import type { SetupFlow } from './setup/setupFlow';
import type { TaskService } from './tasks/taskService';
import type { TodoService } from './todo/todoService';
import type { UpdateService } from './updates/updateService';

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
  /** The folder pasted images are saved to; one the agent took is copied from it into its conversation's folder. */
  pasteDir: string;
}

/** The one diff window, which shows a task of any open project. */
export interface DiffWindowControl {
  /** Taken at the click, so a slower read for an earlier one can be told apart. */
  nextSeq(): number;
  show(view: DiffView): void;
  current(): DiffView | null;
  close(): void;
}

/** An open project: its tasks, its manager and its to-do list. */
export interface Project extends RegisteredProject {
  service: TaskService;
  manager: ManagerService;
  todo: TodoService;
}

/**
 * The folder of the session's conversation, running or ended, asked of each open project's tasks and manager; each
 * answers only for its own sessions. Null for a session of no open project.
 */
function imagesDirOf(projects: ProjectRegistry<Project>, sessionId: string): string | null {
  for (const { dir } of projects.list()) {
    const project = projects.get(dir);
    const found = project && (project.service.imagesDir(sessionId) ?? project.manager.imagesDir(sessionId));
    if (found) return found;
  }
  return null;
}

/** The session's list of images; null for a session of no open project. */
export function imagesOf(projects: ProjectRegistry<Project>, sessionId: string): ImageEntry[] | null {
  const dir = imagesDirOf(projects, sessionId);
  return dir ? readImages(dir) : null;
}

/** The images the page says the agent took, each as its type; anything else is refused. */
function addedImages(raw: unknown): { path: string; number: number | null }[] {
  const entries = Array.isArray(raw) ? raw.map((e) => (e ?? {}) as Record<string, unknown>) : null;
  const usable = (e: Record<string, unknown>) =>
    typeof e.path === 'string' && isAbsolute(e.path) && (e.number === null || (Number.isInteger(e.number) && (e.number as number) > 0));
  if (!entries || !entries.every(usable)) throw new Error("Those images can't be recorded");
  return entries.map((e) => ({ path: e.path as string, number: e.number as number | null }));
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
  ipcMain.handle(IPC.setupUseAgent, (_e, name: unknown) => (isAgentName(name) ? action(() => flow.useAgent(name)) : undefined));
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
  // Not offered while the agent's env var names it: that path wins. One picker at a time: a call while one is open joins it.
  let finding: Promise<void> | null = null;
  ipcMain.handle(IPC.settingsFindAgent, (_e, name: unknown) => {
    const agent = agentOf(name);
    if (agents.view().agents[agent].fromEnv) return;
    finding ??= (async () => {
      const path = await pickAgent(agent);
      if (path !== undefined) await agents.find(agent, path);
    })().finally(() => (finding = null));
    return finding;
  });
  ipcMain.handle(IPC.setAgentOptions, (_e, name: unknown, raw: unknown) => {
    // Only these two, each as its type: anything else the page sends is left out.
    const { managerAgent, syncModel } = (raw ?? {}) as Record<string, unknown>;
    const patch: AgentSettingPatch = {};
    if (managerAgent === null || typeof managerAgent === 'string') patch.managerAgent = managerAgent;
    if (typeof syncModel === 'string') patch.syncModel = syncModel;
    agents.saveAgentSetting(agentOf(name), patch);
  });
  ipcMain.handle(IPC.setTerminalText, (_e, raw: unknown) => {
    const { fontSize, lineHeight } = (raw ?? {}) as Record<string, unknown>;
    const patch: Partial<TerminalText> = {};
    if (typeof fontSize === 'number') patch.fontSize = fontSize;
    if (typeof lineHeight === 'number') patch.lineHeight = lineHeight;
    agents.setTerminalText(patch);
  });
  ipcMain.handle(IPC.opencodeChoices, () => agents.opencodeChoices());
  ipcMain.handle(IPC.taskModelChoices, (_e, agent: unknown) => agents.taskModelChoices(agentOf(agent)));
}

/** The update calls take nothing from the page. */
export function registerUpdateIpc(updates: UpdateService): void {
  ipcMain.handle(IPC.getUpdate, () => updates.view());
  ipcMain.handle(IPC.checkForUpdates, () => updates.check());
  ipcMain.handle(IPC.installUpdate, () => updates.install());
}

export function registerIpc(
  /** Sends to the window, unless it has gone. */
  send: (channel: string, payload: unknown) => void,
  projects: ProjectRegistry<Project>,
  /** Asks for a folder and opens it; says why itself when it can't. */
  openPicked: () => Promise<void>,
  host: SessionHost,
  clipboardDeps: ClipboardDeps,
  diff: DiffWindowControl,
): void {
  ipcMain.handle(IPC.listProjects, () => projects.list());
  ipcMain.handle(IPC.openProject, () => openPicked());
  ipcMain.handle(IPC.closeProject, (_e, dir: string) => projects.close(dir));
  ipcMain.handle(IPC.moveProject, (_e, dir: string, to: number) => projects.move(dir, to));

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
  ipcMain.handle(IPC.codexClaudeMdNote, (_e, dir: string) => tasksOf(dir).codexClaudeMdNote());
  // Only these four: a card reaches `start` through the Todo service alone, which checks it against the synced list.
  ipcMain.handle(
    IPC.startTask,
    (_e, dir: string, { title, description, noQuestions, agent, model, effort }: { title: string; description: string; noQuestions: boolean; agent?: unknown; model?: unknown; effort?: unknown }) =>
      tasksOf(dir).start({
        title,
        description,
        noQuestions,
        ...(isAgentName(agent) && { agent }),
        ...(typeof model === 'string' && { model }),
        ...(typeof effort === 'string' && { effort }),
      }),
  );
  ipcMain.handle(IPC.reopenTask, (_e, dir: string, taskId: string) => tasksOf(dir).reopen(taskId));
  ipcMain.handle(IPC.discardPreview, (_e, dir: string, taskId: string) => tasksOf(dir).discardPreview(taskId));
  ipcMain.handle(IPC.discardTask, (_e, dir: string, taskId: string) => tasksOf(dir).discard(taskId));
  ipcMain.handle(IPC.continueTask, (_e, dir: string, taskId: string) => tasksOf(dir).continueTask(taskId));
  ipcMain.handle(IPC.changedFiles, (_e, dir: string, taskId: string) => tasksOf(dir).changedFiles(taskId));
  ipcMain.handle(IPC.openDiff, async (_e, dir: string, taskId: string, path: string) => {
    const seq = diff.nextSeq();
    const { taskTitle, result } = await tasksOf(dir).diff(taskId, path);
    diff.show({ seq, projectName: basename(dir), taskTitle, focus: path, result });
  });
  ipcMain.handle(IPC.getDiff, () => diff.current());
  ipcMain.on(IPC.closeDiff, () => diff.close());
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
  ipcMain.handle(IPC.putBackTask, (_e, dir: string, taskId: string) => todoOf(dir).putBack(taskId));

  // Logged, never thrown: it must not escape the PTY's exit callback or replace a spawn error.
  const sessionEnded = (
    owner: { onSessionExit(sessionId: string, exit?: { exitCode: number; signal: number | null }): void },
    sessionId: string,
    exit?: { exitCode: number; signal: number | null },
  ) => {
    try {
      owner.onSessionExit(sessionId, exit);
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
          // The state first: a task list the report changes (a merged mark cleared) is never drawn with the old state.
          send(IPC.status, { sessionId, status });
          owner.noteStatus(sessionId, status?.state ?? null);
        },
        onExit: ({ exitCode, signal }) => {
          send(IPC.exit, { sessionId, exitCode, signal });
          sessionEnded(owner, sessionId, { exitCode, signal });
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
  ipcMain.handle(IPC.getImages, (_e, sessionId: unknown) => (typeof sessionId === 'string' && imagesOf(projects, sessionId)) || []);
  ipcMain.handle(IPC.recordImages, (_e, sessionId: unknown, raw: unknown) => {
    const added = addedImages(raw);
    const dir = typeof sessionId === 'string' ? imagesDirOf(projects, sessionId) : null;
    if (!dir) throw new Error(`Unknown session ${String(sessionId)}`);
    send(IPC.images, { sessionId, images: recordImages(dir, added, clipboardDeps.pasteDir) });
  });
  ipcMain.handle(IPC.showImageInFolder, (_e, sessionId: unknown, index: unknown) => {
    if (typeof sessionId !== 'string' || !Number.isInteger(index)) return;
    const entry = imagesOf(projects, sessionId)?.[index as number];
    if (entry && existsSync(entry.path)) shell.showItemInFolder(entry.path);
  });
  ipcMain.on(IPC.copyText, (_e, text: string) => {
    clipboardDeps.clipboard.writeText(text).catch((err: unknown) => console.error('[clipboard] copy failed', err));
  });

  ipcMain.on(IPC.write, (_e, sessionId: string, data: string) => host.write(sessionId, data));
  ipcMain.on(IPC.resize, (_e, sessionId: string, cols: number, rows: number) => host.resize(sessionId, cols, rows));
  ipcMain.on(IPC.pause, (_e, sessionId: string) => host.pause(sessionId));
  ipcMain.on(IPC.resume, (_e, sessionId: string) => host.resume(sessionId));
}
