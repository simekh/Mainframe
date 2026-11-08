import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile, ProgramState, ProgramStatus, StartCheck, TaskCardRef, TaskView } from '../../shared/types';
import type { GitQueries } from '../git';
import { resumePromptFor, TurnTracker } from './carryOn';
import { readRecordedSession, reopenArgv, startArgv, writeHookSettings } from './launch';
import { MANAGER_SLUG, sessionName, slugify, uniqueSlug } from './naming';
import { openingPrompt } from './openingPrompt';
import type { TaskRecord, TaskRecords } from './taskStore';

export interface TaskServiceDeps {
  projectDir: string;
  dataDir: string;
  /** Every project's tasks, shared with the other open projects' services. */
  records: TaskRecords;
  claudeBin: string;
  git: GitQueries;
  kill(sessionId: string): void;
  /** What a running session last reported, as the session host keeps it. */
  status(sessionId: string): ProgramStatus | null;
  onChange(tasks: TaskView[]): void;
  newId?: () => string;
  now?: () => number;
  warn?: (msg: string) => void;
}

/** A task as the manager sees it: the raw OSC 7501 state of its session, not the board's lane. */
export interface SessionReport {
  taskId: string;
  title: string;
  branch: string;
  worktreePath: string;
  claudeSessionId: string;
  createdAt: number;
  closedAt: number | null;
  running: boolean;
  /** What its running session last reported; null before the first report, after a clear, and when none runs. */
  state: ProgramState | null;
  /** The `msg` of that report; null when it had none. */
  msg: string | null;
  /** The card the task was started from; null for a task that has none. */
  card: Pick<TaskCardRef, 'number' | 'url'> | null;
}

/** One `claude` process of a task, held with its launch spec until it exits. */
interface Session {
  id: string;
  taskId: string;
  argv: string[];
  startedWithPrompt: boolean;
  turn: TurnTracker;
}

export class TaskService {
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private readonly sessions = new Map<string, Session>();
  private quitting = false;

  constructor(private readonly deps: TaskServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.warn = deps.warn ?? console.warn;
  }

  list(): TaskView[] {
    return this.mine().map((task) => this.view(task));
  }

  /** Every task of the project, oldest first, with what its session last reported. */
  reports(): SessionReport[] {
    return this.mine().map((task) => {
      const running = this.sessionOf(task.id);
      const status = running ? this.deps.status(running.id) : null;
      return {
        taskId: task.id,
        title: task.title,
        branch: task.branch,
        worktreePath: task.worktreePath,
        claudeSessionId: task.claudeSessionId,
        createdAt: task.createdAt,
        closedAt: task.closedAt,
        running: running !== undefined,
        state: status?.state ?? null,
        msg: status?.msg ?? null,
        card: task.card ? { number: task.card.number, url: task.card.url } : null,
      };
    });
  }

  startCheck(): Promise<StartCheck | null> {
    return this.deps.git.startCheck(this.deps.projectDir);
  }

  async start(req: { title: string; description: string; noQuestions: boolean; card?: TaskCardRef }): Promise<TaskView> {
    const title = req.title.trim();
    if (!title) throw new Error('A task needs a title');

    // Everything after this await is synchronous, so two starts at once cannot pick the same slug, or both take the same card.
    const branchSlugs = await this.deps.git.worktreeBranchNames(this.deps.projectDir);
    if (req.card) {
      const { id } = req.card;
      // A card has one task for good: a closed one is reopened, never started again. An open one is the one to name.
      const had = this.mine().filter((t) => t.card?.id === id);
      const other = had.find((t) => t.open) ?? had[0];
      const name = req.card.number ?? title;
      if (other?.open) throw new Error(`${name} is already open as the task "${other.title}"`);
      if (other) throw new Error(`${name} already has the task "${other.title}"; reopen it instead`);
    }
    // Lowercased, as slugs are: the Mac's file system and git's loose refs ignore case.
    const taken = new Set(
      [MANAGER_SLUG, ...this.mine().map((t) => t.slug), ...branchSlugs, ...this.worktreeFolders()].map((s) => s.toLowerCase()),
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
      ...(req.card && { card: req.card }),
    };

    const argv = this.startArgvOf(task, writeHookSettings(this.taskDir(task.id)));
    this.deps.records.all.push(task);
    this.addSession({ taskId: task.id, argv, startedWithPrompt: true, resumePending: false });
    this.commit();
    return this.view(task);
  }

  async reopen(taskId: string): Promise<TaskView> {
    const task = this.find(taskId);
    const branchExists = await this.deps.git.branchExists(this.deps.projectDir, task.branch);

    // Another reopen may have finished while git answered, or the project closed or the app began
    // to quit: then the task stays as recorded, to carry on when the project next opens.
    if (this.sessionOf(task.id) || this.quitting) return this.view(task);

    const settingsPath = writeHookSettings(this.taskDir(task.id));
    const recorded = readRecordedSession(this.taskDir(task.id));
    const prompt = recorded === null ? undefined : resumePromptFor(task);
    const carryOn = prompt !== undefined;
    let argv: string[];
    if (recorded) {
      task.claudeSessionId = recorded;
      argv = reopenArgv({
        claudeBin: this.deps.claudeBin,
        slug: task.slug,
        claudeSessionId: task.claudeSessionId,
        settingsPath,
        branchExists,
        prompt,
      });
    } else {
      // SessionStart never fired: claude was missing, or quit before the conversation began, so
      // there is none to resume. This starts it as the first launch would have.
      task.claudeSessionId = this.newId();
      argv = this.startArgvOf(task, settingsPath);
    }
    task.open = true;
    task.closedAt = null;
    // Cleared here; a session whose resume prompt never takes sets it again as it ends. askAgain is
    // kept, so the prompt owed again is the same one.
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

  /** The sessions it runs: one per open task. */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  launchSpec(sessionId: string): { argv: string[]; cwd: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return { argv: session.argv, cwd: this.deps.projectDir };
  }

  /** What the session's OSC 7501 reports say now, as they arrive; null once they are cleared. */
  noteStatus(sessionId: string, state: ProgramState | null): void {
    this.sessions.get(sessionId)?.turn.note(state);
  }

  onSessionExit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (!session.turn.ending) this.markEnding(session);
    const task = this.find(session.taskId);

    task.claudeSessionId = readRecordedSession(this.taskDir(task.id)) ?? task.claudeSessionId;
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
    this.deps.records.save();
  }

  async changedFiles(taskId: string): Promise<ChangedFile[] | null> {
    const task = this.mine().find((t) => t.id === taskId);
    return task ? this.deps.git.changedFiles(task.worktreePath) : null;
  }

  private mine(): TaskRecord[] {
    return this.deps.records.all.filter((t) => t.projectDir === this.deps.projectDir);
  }

  private find(taskId: string): TaskRecord {
    const task = this.mine().find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }

  private addSession({ resumePending, ...session }: Pick<Session, 'taskId' | 'argv' | 'startedWithPrompt'> & { resumePending: boolean }): void {
    const id = this.newId();
    this.sessions.set(id, { id, ...session, turn: new TurnTracker(resumePending) });
  }

  /** Records on the task where the session's turn was as its end was decided (`turnAtEnd` says how). */
  private markEnding(session: Session): void {
    Object.assign(this.find(session.taskId), session.turn.end());
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
        card: task.card,
      }),
    });
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
      card: task.card ?? null,
      session: running ? { id: running.id, startedWithPrompt: running.startedWithPrompt } : null,
    };
  }

  private commit(): void {
    this.deps.records.save();
    this.deps.onChange(this.list());
  }
}
