import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_NAMES, MIN_AGENT_VERSION, type AgentName, type ChangedFile, type DiffResult, type ProgramState, type ProgramStatus, type StartCheck, type TaskCardRef, type TaskView } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import type { LaunchArgs } from '../agents/agent';
import type { GitQueries } from '../git';
import type { AgentsInUse } from '../setup/agentsInUse';
import { fitsWindowsCommandLine } from '../pty/windowsCommandLine';
import { inTurn, resumePromptFor, TurnTracker } from './carryOn';
import { MANAGER_SLUG, sessionName, slugify, uniqueSlug, WINDOWS_RESERVED_NAMES } from './naming';
import { openingPrompt } from './openingPrompt';
import type { TaskRecord, TaskRecords } from './taskStore';

export interface TaskServiceDeps {
  projectDir: string;
  dataDir: string;
  /** Every project's tasks, shared with the other open projects' services. */
  records: TaskRecords;
  /** The agents found at start, shared with the other open projects' services: asked at each start and reopen. */
  agents: Pick<AgentsInUse, 'bin' | 'defaultAgent' | 'ticked'>;
  /** What Claude Code's SessionStart hook runs: a real program path; null when no node was found. */
  nodeBin: string | null;
  /**
   * Windows caps a command line, so a task's long description goes to a file there; and it reserves
   * names a task's folder can't take.
   */
  platform: NodeJS.Platform;
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
  /** What kind of id `claudeSessionId` is. */
  agent: AgentName;
}

/** How a session is launched; `env` is laid over the session host's own. */
interface LaunchSpec extends LaunchArgs {
  cwd: string;
}

/** One agent process of a task, held with its launch spec until it exits. */
interface Session {
  id: string;
  taskId: string;
  launch: LaunchSpec;
  startedWithPrompt: boolean;
  turn: TurnTracker;
}

export class TaskService {
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private readonly sessions = new Map<string, Session>();
  /** Tasks whose worktree git is adding before their session starts: a reopen meanwhile would start a second one. */
  private readonly launching = new Set<string>();
  /** Tasks start has recorded but not yet given a session: off the board and the manager's list until then. */
  private readonly starting = new Set<string>();
  private quitting = false;

  constructor(private readonly deps: TaskServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? Date.now;
    this.warn = deps.warn ?? console.warn;
  }

  list(): TaskView[] {
    return this.shown().map((task) => this.view(task));
  }

  /** Every task of the project, oldest first, with what its session last reported. */
  reports(): SessionReport[] {
    return this.shown().map((task) => {
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
        agent: agentOf(task),
      };
    });
  }

  startCheck(): Promise<StartCheck | null> {
    return this.deps.git.startCheck(this.deps.projectDir);
  }

  async start(req: { title: string; description: string; noQuestions: boolean; card?: TaskCardRef; agent?: AgentName }): Promise<TaskView> {
    const title = req.title.trim();
    if (!title) throw new Error('A task needs a title');
    // Without one, the default: that covers the tasks the manager starts and those started from a Todo card.
    const agent = req.agent ?? this.deps.agents.defaultAgent();
    const adapter = ADAPTERS[agent];
    const bin = this.binOf(agent);
    if (!this.deps.agents.ticked().includes(agent)) throw new Error(`${AGENT_NAMES[agent]} is turned off in Settings`);

    // Everything after this await is synchronous, so two starts at once cannot pick the same slug, or both take the same card.
    const branchSlugs = await this.deps.git.worktreeBranchNames(this.deps.projectDir);
    if (req.card) {
      const { id } = req.card;
      // A card has one task for good: a closed one is reopened, never started again.
      const other = this.mine().find((t) => t.card?.id === id);
      const name = req.card.number ?? title;
      if (other?.open) throw new Error(`${name} is already open as the task "${other.title}"`);
      if (other) throw new Error(`${name} already has the task "${other.title}"; reopen it instead`);
    }
    // Lowercased, as slugs are: the Mac's file system and git's loose refs ignore case.
    const taken = new Set(
      [MANAGER_SLUG, ...this.mine().map((t) => t.slug), ...branchSlugs, ...this.worktreeFolders()].map((s) => s.toLowerCase()),
    );
    // The slug names the task's folder, which can't take a name Windows reserves.
    if (this.deps.platform === 'win32') for (const name of WINDOWS_RESERVED_NAMES) taken.add(name);
    const slug = uniqueSlug(slugify(title), taken);

    const task: TaskRecord = {
      id: this.newId(),
      projectDir: this.deps.projectDir,
      title,
      description: req.description,
      slug,
      name: sessionName(this.deps.projectDir, slug),
      claudeSessionId: adapter.newSessionId(this.newId),
      worktreePath: join(this.deps.projectDir, adapter.worktreesDir, slug),
      branch: `worktree-${slug}`,
      createdAt: this.now(),
      closedAt: null,
      open: true,
      noQuestions: req.noQuestions,
      ...(req.card && { card: req.card }),
      agent,
    };

    if (!adapter.mainframeAddsWorktree) {
      // The agent makes the task's worktree as it starts.
      const launch = this.startLaunch(task, bin);
      this.deps.records.all.push(task);
      this.addSession({ taskId: task.id, launch: { ...launch, cwd: this.deps.projectDir }, startedWithPrompt: true, resumePending: false });
    } else {
      // Recorded before git runs, so a start meanwhile takes another slug; shown and saved only once the worktree is there.
      this.deps.records.all.push(task);
      this.starting.add(task.id);
      try {
        await this.addWorktree(task, true);
      } catch (err) {
        this.deps.records.all.splice(this.deps.records.all.indexOf(task), 1);
        // Another project may have saved it meanwhile.
        this.commit();
        throw err;
      } finally {
        this.starting.delete(task.id);
      }
      // The project closed, or the app began to quit, while git ran: the task is kept, open, and begins at the next open.
      if (!this.quitting) {
        const launch = this.startLaunch(task, bin);
        this.addSession({ taskId: task.id, launch: { ...launch, cwd: task.worktreePath }, startedWithPrompt: true, resumePending: false });
      }
    }
    this.commit();
    return this.view(task);
  }

  async reopen(taskId: string): Promise<TaskView> {
    const task = this.find(taskId);
    const branchExists = await this.deps.git.branchExists(this.deps.projectDir, task.branch);

    // Another reopen may have finished while git answered, or the project closed or the app began
    // to quit: then the task stays as recorded, to carry on when the project next opens.
    if (this.sessionOf(task.id) || this.launching.has(task.id) || this.quitting) return this.view(task);
    const agent = agentOf(task);
    const adapter = ADAPTERS[agent];
    if (adapter.mainframeAddsWorktree) return this.reopenInWorktree(task, branchExists);

    const bin = this.binOf(agent);
    const recorded = adapter.recordedSession(this.taskDir(task.id));
    const prompt = recorded === null ? undefined : resumePromptFor(task);
    const carryOn = prompt !== undefined;
    let launch: LaunchArgs;
    if (recorded) {
      task.claudeSessionId = recorded;
      launch = this.reopenLaunch(task, bin, branchExists, prompt);
    } else {
      // The agent never recorded the conversation: it was missing, or quit before the conversation began, so
      // there is none to resume. This starts it as the first launch would have.
      task.claudeSessionId = adapter.newSessionId(this.newId);
      launch = this.startLaunch(task, bin);
    }
    return this.relaunch(task, { ...launch, cwd: this.deps.projectDir }, { startedWithPrompt: !recorded || carryOn, resumePending: carryOn });
  }

  /** Adds the task's worktree, marking the task as launching while git runs. */
  private async addWorktree(task: TaskRecord, create: boolean): Promise<void> {
    this.launching.add(task.id);
    try {
      await this.hideWorktreesFolder(task);
      await this.deps.git.addWorktree(this.deps.projectDir, task.worktreePath, task.branch, { create });
    } finally {
      this.launching.delete(task.id);
    }
  }

  /** Keeps the agent's worktrees folder out of git status through the repo's local exclude file; a failure only warns. */
  private async hideWorktreesFolder(task: TaskRecord): Promise<void> {
    const [top] = ADAPTERS[agentOf(task)].worktreesDir.split('/');
    try {
      await this.deps.git.excludeLocally(this.deps.projectDir, `/${top}/`);
    } catch (err) {
      this.deps.warn?.(`Could not add /${top}/ to the repo's local exclude file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Resumes the session Mainframe started, in the task's worktree, or starts it again with the opening prompt when
   * its conversation never began. A worktree folder deleted by hand is added back from its branch; with the branch
   * gone too, the session runs in the project folder.
   */
  private async reopenInWorktree(task: TaskRecord, branchExists: boolean): Promise<TaskView> {
    const agent = agentOf(task);
    const bin = this.binOf(agent);
    let cwd = this.deps.projectDir;
    if (existsSync(task.worktreePath)) {
      cwd = task.worktreePath;
    } else if (branchExists) {
      await this.addWorktree(task, false);
      // As in reopen: the project may have closed, or the app begun to quit, while git ran.
      if (this.quitting) return this.view(task);
      cwd = task.worktreePath;
    }
    if (!task.began) {
      // OpenCode never took the brief: it failed to start, was quit at its login screen, or Mainframe quit first.
      return this.relaunch(task, { ...this.startLaunch(task, bin), cwd }, { startedWithPrompt: true, resumePending: false });
    }
    const prompt = resumePromptFor(task);
    const carryOn = prompt !== undefined;
    const launch = this.reopenLaunch(task, bin, branchExists, prompt);
    return this.relaunch(task, { ...launch, cwd }, { startedWithPrompt: carryOn, resumePending: carryOn });
  }

  private relaunch(task: TaskRecord, launch: LaunchSpec, o: { startedWithPrompt: boolean; resumePending: boolean }): TaskView {
    task.open = true;
    task.closedAt = null;
    // Cleared here; a session whose resume prompt never takes sets it again as it ends. askAgain is
    // kept, so the prompt owed again is the same one.
    task.midTurn = false;
    this.addSession({ taskId: task.id, launch, ...o });
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

  launchSpec(sessionId: string): LaunchSpec {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return session.launch;
  }

  /** What the session's OSC 7501 reports say now, as they arrive; null once they are cleared. */
  noteStatus(sessionId: string, state: ProgramState | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.turn.note(state);
    const task = this.find(session.taskId);
    if (agentOf(task) === 'opencode' && !task.began && inTurn(state)) {
      task.began = true;
      // Saved, not sent: nothing the window shows has changed.
      this.deps.records.save();
    }
  }

  onSessionExit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (!session.turn.ending) this.markEnding(session);
    const task = this.find(session.taskId);

    // An agent that records no conversation keeps the session Mainframe started.
    task.claudeSessionId = ADAPTERS[agentOf(task)].recordedSession(this.taskDir(task.id)) ?? task.claudeSessionId;
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

  async diff(taskId: string, focus: string): Promise<{ taskTitle: string; result: DiffResult }> {
    const task = this.find(taskId);
    let result: DiffResult;
    try {
      const files = await this.deps.git.taskDiff(task.worktreePath, focus);
      result = files ? { kind: 'files', files } : { kind: 'noWorktree' };
    } catch (err) {
      result = { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
    }
    return { taskTitle: task.title, result };
  }

  private mine(): TaskRecord[] {
    return this.deps.records.all.filter((t) => t.projectDir === this.deps.projectDir);
  }

  /** The tasks the board and the manager see: those a start is still adding the worktree of are left out. */
  private shown(): TaskRecord[] {
    return this.mine().filter((t) => !this.starting.has(t.id));
  }

  private find(taskId: string): TaskRecord {
    const task = this.mine().find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }

  private addSession({ resumePending, ...session }: Pick<Session, 'taskId' | 'launch' | 'startedWithPrompt'> & { resumePending: boolean }): void {
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
    return Object.values(ADAPTERS).flatMap((adapter) => {
      try {
        return readdirSync(join(this.deps.projectDir, adapter.worktreesDir));
      } catch {
        return [];
      }
    });
  }

  /** The program the agent's sessions run. A reopen needs only this: an agent unticked since keeps its tasks. */
  private binOf(agent: AgentName): string {
    const bin = this.deps.agents.bin(agent);
    if (bin === null) throw new Error(`${AGENT_NAMES[agent]} ${MIN_AGENT_VERSION[agent]} or later is not installed`);
    return bin;
  }

  /** The launch that resumes the task's conversation, `claudeSessionId`. */
  private reopenLaunch(task: TaskRecord, bin: string, branchExists: boolean, prompt: string | undefined): LaunchArgs {
    return ADAPTERS[agentOf(task)].taskReopen({
      bin,
      nodeBin: this.deps.nodeBin,
      taskDir: this.taskDir(task.id),
      slug: task.slug,
      sessionId: task.claudeSessionId,
      branchExists,
      prompt,
    });
  }

  /**
   * The launch that begins the task's conversation, under its `claudeSessionId`, with its opening prompt. On Windows,
   * when it would overflow the command line, the description goes to a file in a folder the session may read (`addDir`),
   * and the prompt points at it.
   */
  private startLaunch(task: TaskRecord, bin: string): LaunchArgs {
    const agent = agentOf(task);
    const build = (brief?: { dir: string; file: string }) =>
      ADAPTERS[agent].taskStart({
        bin,
        nodeBin: this.deps.nodeBin,
        taskDir: this.taskDir(task.id),
        slug: task.slug,
        name: task.name,
        sessionId: task.claudeSessionId,
        prompt: openingPrompt({
          title: task.title,
          description: task.description,
          branch: task.branch,
          noQuestions: task.noQuestions ?? false,
          card: task.card,
          descriptionFile: brief?.file,
          ...(agent === 'opencode'
            ? { agent: 'opencode' as const, projectDir: this.deps.projectDir, worktreePath: task.worktreePath }
            : { agent: 'claude' as const }),
        }),
        ...(brief && { addDir: brief.dir }),
      });

    const launch = build();
    if (this.deps.platform !== 'win32' || fitsWindowsCommandLine(launch.argv)) return launch;
    const dir = join(this.taskDir(task.id), 'brief');
    const file = join(dir, 'description.md');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, task.description, 'utf8');
    return build({ dir, file });
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
      agent: agentOf(task),
      session: running ? { id: running.id, startedWithPrompt: running.startedWithPrompt } : null,
    };
  }

  private commit(): void {
    this.deps.records.save();
    this.deps.onChange(this.list());
  }
}

/** A task kept before tasks named their agent runs on Claude Code. */
const agentOf = (task: TaskRecord): AgentName => task.agent ?? 'claude';
