import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile, StartCheck, TaskView } from '../../shared/types';
import type { GitQueries } from '../git';
import { hookSettings, readSessionStart, reopenArgv, SESSION_START_FILE, startArgv } from './launch';
import { sessionName, slugify, uniqueSlug } from './naming';
import { openingPrompt } from './openingPrompt';
import { loadTasks, saveTasks, type TaskRecord } from './taskStore';

const SETTINGS_FILE = 'settings.json';

export interface TaskServiceDeps {
  projectDir: string;
  dataDir: string;
  claudeBin: string;
  git: GitQueries;
  kill(sessionId: string): void;
  onChange(tasks: TaskView[]): void;
  newId?: () => string;
  now?: () => number;
  warn?: (msg: string) => void;
}

/** One `claude` process of a task, held with its launch spec until it exits. */
interface Session {
  id: string;
  taskId: string;
  argv: string[];
  startedWithPrompt: boolean;
}

export class TaskService {
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly stateFile: string;
  /** Every project's tasks: the other projects' records are written back as they were read. */
  private readonly records: TaskRecord[];
  private readonly sessions = new Map<string, Session>();
  private quitting = false;

  constructor(private readonly deps: TaskServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.stateFile = join(deps.dataDir, 'state.json');
    this.records = loadTasks(this.stateFile, this.now(), deps.warn ?? console.warn);
  }

  list(): TaskView[] {
    return this.mine().map((task) => this.view(task));
  }

  startCheck(): Promise<StartCheck | null> {
    return this.deps.git.startCheck(this.deps.projectDir);
  }

  async start(req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView> {
    const title = req.title.trim();
    if (!title) throw new Error('A task needs a title');

    // Everything after this await is synchronous, so two starts at once cannot pick the same slug.
    const branchSlugs = await this.deps.git.worktreeBranchNames(this.deps.projectDir);
    const taken = new Set([...this.mine().map((t) => t.slug), ...branchSlugs, ...this.worktreeFolders()]);
    const slug = uniqueSlug(slugify(title), taken);

    const task: TaskRecord = {
      id: this.newId(),
      projectDir: this.deps.projectDir,
      title,
      description: req.description,
      slug,
      name: sessionName(this.deps.projectDir, slug),
      claudeSessionId: this.newId(),
      worktreePath: join(this.deps.projectDir, '.claude', 'worktrees', slug),
      branch: `worktree-${slug}`,
      createdAt: this.now(),
      closedAt: null,
      open: true,
    };

    const taskDir = this.taskDir(task.id);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, SETTINGS_FILE), hookSettings(taskDir));

    const prompt = openingPrompt({ title, description: req.description, branch: task.branch, noQuestions: req.noQuestions });
    const argv = startArgv({
      claudeBin: this.deps.claudeBin,
      slug,
      name: task.name,
      claudeSessionId: task.claudeSessionId,
      settingsPath: join(taskDir, SETTINGS_FILE),
      prompt,
    });

    this.records.push(task);
    this.addSession({ taskId: task.id, argv, startedWithPrompt: true });
    this.commit();
    return this.view(task);
  }

  async reopen(taskId: string): Promise<TaskView> {
    const task = this.find(taskId);
    const branchExists = await this.deps.git.branchExists(this.deps.projectDir, task.branch);

    // Another reopen may have finished while git answered.
    if (this.sessionOf(task.id)) return this.view(task);

    this.takeSessionStart(task);
    const argv = reopenArgv({
      claudeBin: this.deps.claudeBin,
      slug: task.slug,
      claudeSessionId: task.claudeSessionId,
      settingsPath: join(this.taskDir(task.id), SETTINGS_FILE),
      branchExists,
    });
    task.open = true;
    task.closedAt = null;
    this.addSession({ taskId: task.id, argv, startedWithPrompt: false });
    this.commit();
    return this.view(task);
  }

  async restore(): Promise<void> {
    for (const task of this.mine().filter((t) => t.open)) await this.reopen(task.id);
  }

  close(taskId: string): void {
    const running = this.sessionOf(taskId);
    if (!running) return;
    // Cleared before the kill so a crash before the exit arrives does not bring the task back.
    this.find(taskId).open = false;
    this.commit();
    this.deps.kill(running.id);
  }

  launchSpec(sessionId: string): { argv: string[]; cwd: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return { argv: session.argv, cwd: this.deps.projectDir };
  }

  onSessionExit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const task = this.records.find((t) => t.id === session.taskId)!;

    this.takeSessionStart(task);
    // While quitting, the SIGHUPs end sessions that should run again at the next start.
    if (!(this.quitting && task.open)) {
      task.open = false;
      task.closedAt = this.now();
    }
    this.commit();
  }

  beginQuit(): void {
    this.quitting = true;
  }

  async changedFiles(taskId: string): Promise<ChangedFile[] | null> {
    const task = this.mine().find((t) => t.id === taskId);
    return task ? this.deps.git.changedFiles(task.worktreePath) : null;
  }

  private mine(): TaskRecord[] {
    return this.records.filter((t) => t.projectDir === this.deps.projectDir);
  }

  private find(taskId: string): TaskRecord {
    const task = this.mine().find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }

  private addSession(session: Omit<Session, 'id'>): void {
    const id = this.newId();
    this.sessions.set(id, { id, ...session });
  }

  private sessionOf(taskId: string): Session | undefined {
    return [...this.sessions.values()].find((session) => session.taskId === taskId);
  }

  private taskDir(taskId: string): string {
    return join(this.deps.dataDir, 'tasks', taskId);
  }

  private worktreeFolders(): string[] {
    try {
      return readdirSync(join(this.deps.projectDir, '.claude', 'worktrees'));
    } catch {
      return [];
    }
  }

  /** The conversation SessionStart last recorded for the task, which `/clear` and compaction change. */
  private takeSessionStart(task: TaskRecord): void {
    let text: string | null;
    try {
      text = readFileSync(join(this.taskDir(task.id), SESSION_START_FILE), 'utf8');
    } catch {
      text = null;
    }
    task.claudeSessionId = readSessionStart(text) ?? task.claudeSessionId;
  }

  private view(task: TaskRecord): TaskView {
    const running = this.sessionOf(task.id);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      slug: task.slug,
      branch: task.branch,
      worktreePath: task.worktreePath,
      createdAt: task.createdAt,
      closedAt: task.closedAt,
      session: running ? { id: running.id, startedWithPrompt: running.startedWithPrompt } : null,
    };
  }

  private commit(): void {
    saveTasks(this.stateFile, this.records);
    this.deps.onChange(this.list());
  }
}
