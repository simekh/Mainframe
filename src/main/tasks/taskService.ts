import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile, ProgramState, StartCheck, TaskView } from '../../shared/types';
import type { GitQueries } from '../git';
import { hookSettings, readSessionStart, reopenArgv, SESSION_START_FILE, startArgv } from './launch';
import { sessionName, slugify, uniqueSlug } from './naming';
import { openingPrompt } from './openingPrompt';
import { loadTasks, saveTasks, type TaskRecord } from './taskStore';

const SETTINGS_FILE = 'settings.json';

/** What a reopen says to a session that was interrupted mid-turn: Claude starts no turn of its own after a resume. */
const RESUME_PROMPT = 'Continue where you left off.';

/** The states a session is in the middle of a turn in: a blocked one's prompt dies with the process. */
const inTurn = (state: ProgramState | null): boolean => state === 'working' || state === 'blocked';

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
  /** What its last OSC 7501 report said; null before the first, and after a clear. */
  lastState: ProgramState | null;
  /** Set once it has been told to end: what it reports on the way out is not what its turn was. */
  ending: boolean;
  /** It was launched with the resume prompt and has not yet worked or blocked: the prompt has not taken. */
  resumePending: boolean;
}

export class TaskService {
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private readonly stateFile: string;
  /** Every project's tasks: the other projects' records are written back as they were read. */
  private readonly records: TaskRecord[];
  private readonly sessions = new Map<string, Session>();
  private quitting = false;

  constructor(private readonly deps: TaskServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.warn = deps.warn ?? console.warn;
    this.stateFile = join(deps.dataDir, 'state.json');
    this.records = loadTasks(this.stateFile, this.now(), this.warn);
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
    // Lowercased, as slugs are: the Mac's file system and git's loose refs ignore case.
    const taken = new Set(
      [...this.mine().map((t) => t.slug), ...branchSlugs, ...this.worktreeFolders()].map((s) => s.toLowerCase()),
    );
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
      noQuestions: req.noQuestions,
    };

    const argv = this.startArgvOf(task, this.writeHookSettings(task.id));
    this.records.push(task);
    this.addSession({ taskId: task.id, argv, startedWithPrompt: true, resumePending: false });
    this.commit();
    return this.view(task);
  }

  async reopen(taskId: string): Promise<TaskView> {
    const task = this.find(taskId);
    const branchExists = await this.deps.git.branchExists(this.deps.projectDir, task.branch);

    // Another reopen may have finished while git answered.
    if (this.sessionOf(task.id)) return this.view(task);

    const settingsPath = this.writeHookSettings(task.id);
    const recorded = this.recordedSession(task.id);
    const carryOn = recorded !== null && task.midTurn === true;
    let argv: string[];
    if (recorded) {
      task.claudeSessionId = recorded;
      argv = reopenArgv({
        claudeBin: this.deps.claudeBin,
        slug: task.slug,
        claudeSessionId: task.claudeSessionId,
        settingsPath,
        branchExists,
        prompt: carryOn ? RESUME_PROMPT : undefined,
      });
    } else {
      // SessionStart never fired: claude was missing, or quit before the conversation began, so
      // there is none to resume. This starts it as the first launch would have.
      task.claudeSessionId = this.newId();
      argv = this.startArgvOf(task, settingsPath);
    }
    task.open = true;
    task.closedAt = null;
    // Cleared here; a session whose resume prompt never takes sets it again as it ends.
    task.midTurn = false;
    this.addSession({ taskId: task.id, argv, startedWithPrompt: !recorded || carryOn, resumePending: carryOn });
    this.commit();
    return this.view(task);
  }

  async restore(): Promise<void> {
    for (const task of this.mine().filter((t) => t.open)) {
      try {
        await this.reopen(task.id);
      } catch (err) {
        this.warn(`Could not reopen task ${task.id} (${task.slug}): ${err instanceof Error ? err.message : String(err)}`);
        // Left open it would be retried, and fail, at every start.
        if (!this.sessionOf(task.id)) {
          task.open = false;
          task.closedAt = this.now();
          this.commit();
        }
      }
    }
  }

  close(taskId: string): void {
    const running = this.sessionOf(taskId);
    if (!running) return;
    // Both set before the kill so a crash before the exit arrives does not bring the task back, or
    // lose where its turn was.
    this.markEnding(running);
    this.find(taskId).open = false;
    this.commit();
    this.deps.kill(running.id);
  }

  launchSpec(sessionId: string): { argv: string[]; cwd: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return { argv: session.argv, cwd: this.deps.projectDir };
  }

  /** What the session's OSC 7501 reports say now, as they arrive; null once they are cleared. */
  noteStatus(sessionId: string, state: ProgramState | null): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.ending) return;
    session.lastState = state;
    if (inTurn(state)) session.resumePending = false;
  }

  onSessionExit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (!session.ending) this.markEnding(session);
    const task = this.find(session.taskId);

    task.claudeSessionId = this.recordedSession(task.id) ?? task.claudeSessionId;
    // While quitting, the SIGHUPs end sessions that should run again at the next start.
    if (!(this.quitting && task.open)) {
      task.open = false;
      task.closedAt = this.now();
    }
    this.commit();
  }

  beginQuit(): void {
    this.quitting = true;
    // Now rather than at each exit: the app may be gone before they arrive.
    for (const session of this.sessions.values()) this.markEnding(session);
    // Saved, not sent: nothing the window shows has changed.
    saveTasks(this.stateFile, this.records);
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

  private addSession(session: Pick<Session, 'taskId' | 'argv' | 'startedWithPrompt' | 'resumePending'>): void {
    const id = this.newId();
    this.sessions.set(id, { id, ...session, lastState: null, ending: false });
  }

  /**
   * Records on the task whether the session ends in the middle of a turn, from the state it was in
   * before the end was decided. A resume prompt that never took, as when the launch failed or the
   * app quit at once, leaves the turn still owed.
   */
  private markEnding(session: Session): void {
    session.ending = true;
    this.find(session.taskId).midTurn = inTurn(session.lastState) || session.resumePending;
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

  /** Writes the task's SessionStart hook into its folder, making the folder if it has gone; returns its path. */
  private writeHookSettings(taskId: string): string {
    const taskDir = this.taskDir(taskId);
    mkdirSync(taskDir, { recursive: true });
    const settingsPath = join(taskDir, SETTINGS_FILE);
    writeFileSync(settingsPath, hookSettings(taskDir));
    return settingsPath;
  }

  /** The launch that begins the task's conversation, under its `claudeSessionId`. */
  private startArgvOf(task: TaskRecord, settingsPath: string): string[] {
    return startArgv({
      claudeBin: this.deps.claudeBin,
      slug: task.slug,
      name: task.name,
      claudeSessionId: task.claudeSessionId,
      settingsPath,
      prompt: openingPrompt({
        title: task.title,
        description: task.description,
        branch: task.branch,
        noQuestions: task.noQuestions ?? false,
      }),
    });
  }

  /**
   * The conversation SessionStart last recorded for the task, which `/clear` and compaction change;
   * null while it has never fired.
   */
  private recordedSession(taskId: string): string | null {
    try {
      return readSessionStart(readFileSync(join(this.taskDir(taskId), SESSION_START_FILE), 'utf8'));
    } catch {
      return null;
    }
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
