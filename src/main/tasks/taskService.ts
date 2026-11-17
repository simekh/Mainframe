import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AGENT_NAMES, isEnded, MIN_AGENT_VERSION, type AgentName, type ChangedFile, type DiffResult, type DiscardPreview, type ProgramState, type ProgramStatus, type StartCheck, type TaskCardRef, type TaskGitState, type TaskPlace, type TaskView } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import type { LaunchArgs } from '../agents/agent';
import { FolderLeftError, type GitQueries } from '../git';
import type { AgentsInUse } from '../setup/agentsInUse';
import { fitsWindowsCommandLine } from '../pty/windowsCommandLine';
import { continuePrompt, inTurn, putBackPrompt, resumePromptFor, TurnTracker } from './carryOn';
import { MANAGER_SLUG, sessionName, slugify, uniqueSlug, WINDOWS_RESERVED_NAMES } from './naming';
import { openingPrompt } from './openingPrompt';
import type { TaskRecord, TaskRecords } from './taskStore';

/** How a card's problem line starts when git left a worktree's folder half removed. */
const FOLDER_LEFT = 'Delete the folder git left behind, then Discard:';

/** How often each open project checks its tasks for ones with nothing to lose, besides at each session's end. */
export const FINISH_CHECK_MS = 3 * 60_000;

/** Where a task with no session is, as the manager is told it. */
const WHERE: Record<TaskPlace | 'board', string> = { board: 'paused', putBack: 'put back', finished: 'finished', discarded: 'discarded' };

/** What a session in a turn is doing, as the manager is told it; any other session whose turn is not over is starting. */
const IN_TURN: Partial<Record<ProgramState, string>> = { working: 'working', blocked: "waiting for the owner's answer" };

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
  /** Where the task is; null on the board. */
  place: TaskPlace | null;
  /** When it went to its place; null on the board. */
  endedAt: number | null;
  running: boolean;
  /** What its running session last reported; null before the first report, after a clear, and when none runs. */
  state: ProgramState | null;
  /** The `msg` of that report; null when it had none. */
  msg: string | null;
  /** A running task the last round found had nothing to lose: its card is in the board's Done lane. */
  merged: boolean;
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
  /** A Continue's, whose agent makes the fresh worktree as it starts. */
  continued?: boolean;
  /** Its task's worktree folder was there at one of its reports or at its end: the session got as far as making it. */
  worktreeSeen?: boolean;
  /**
   * Put back's session: closed once its turn ends, on done, or on idle once it has worked. A question or a permission
   * prompt waits for the owner's answer; an error gives Put back up, and it goes on as any task's session.
   */
  putBack?: {
    /** It has reported working: an idle from before its turn began does not end it. */
    worked: boolean;
    /** Settles Put back's wait: true once the session exits, false when an error gave it up. */
    settle(done: boolean): void;
  };
}

export class TaskService {
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private readonly sessions = new Map<string, Session>();
  /** Tasks a reopen or Continue is adding the worktree of: a reopen meanwhile would start a second session. */
  private readonly launching = new Set<string>();
  /** Tasks start has recorded but not yet given a session: off the board and the manager's list until then. */
  private readonly starting = new Set<string>();
  /** Running tasks the last round found had nothing to lose. */
  private readonly merged = new Set<string>();
  /** Why Put back, or a removal of the worktree, failed for a task, until a reopen or a move clears it. */
  private readonly problems = new Map<string, string>();
  /** Tasks whose worktree and branch a round is removing: a reopen meanwhile would start a session in what goes. */
  private readonly removing = new Set<string>();
  /** Tasks a Put back is under way for, from its session to the sync after it. */
  private readonly puttingBack = new Set<string>();
  /**
   * Continued tasks whose session ended before their worktree was made: the old record says the conversation began and
   * branch and folder are missing, which is not finished work. The round leaves them until a session's end finds the
   * worktree.
   */
  private readonly unmade = new Set<string>();
  /** The check round running, and the one queued after it. */
  private round: Promise<void> | null = null;
  private nextRound: Promise<void> | null = null;
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
        place: task.place ?? null,
        endedAt: task.endedAt ?? null,
        running: running !== undefined,
        state: status?.state ?? null,
        msg: status?.msg ?? null,
        merged: this.merged.has(task.id),
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
      // A card has one task for good, a discarded one aside: a closed one is reopened, never started again.
      const other = this.taskOfCard(id);
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
    this.refuseWhilePuttingBack(task);
    // A finished or discarded task has no worktree or branch: Continue brings it back.
    if (isEnded(task.place) || this.busy(task)) return this.view(task);
    const agent = agentOf(task);
    const adapter = ADAPTERS[agent];
    if (adapter.mainframeAddsWorktree) return this.reopenInWorktree(task);

    const bin = this.binOf(agent);
    const recorded = adapter.recordedSession(this.taskDir(task.id));
    const prompt = recorded === null ? undefined : resumePromptFor(task);
    const carryOn = prompt !== undefined;
    let launch: LaunchArgs;
    if (recorded) {
      task.claudeSessionId = recorded;
      launch = this.reopenLaunch(task, bin, prompt);
    } else {
      // The agent never recorded the conversation: it was missing, or quit before the conversation began, so
      // there is none to resume. This starts it as the first launch would have.
      task.claudeSessionId = adapter.newSessionId(this.newId);
      launch = this.startLaunch(task, bin);
    }
    return this.relaunch(task, { ...launch, cwd: this.deps.projectDir }, { startedWithPrompt: !recorded || carryOn, resumePending: carryOn });
  }

  /**
   * Brings a finished or discarded task back to the board, in a fresh worktree on its branch name made from the base,
   * which has any of its work that was merged. Its chat is resumed with a word on where it now runs; one the agent
   * no longer has is started again with the opening prompt. A put-back task is reopened.
   */
  async continueTask(taskId: string): Promise<TaskView> {
    const task = this.find(taskId);
    if (task.place === undefined) throw new Error(`Task ${task.title} is on the board; reopen it instead`);
    if (task.place === 'putBack') return this.reopen(taskId);
    // A card has at most one task that isn't discarded: one started afresh since keeps the card.
    const card = task.card;
    const other = task.place === 'discarded' && card ? this.taskOfCard(card.id) : undefined;
    if (other) throw new Error(`${card!.number ?? task.title} already has the task "${other.title}"; continue that one instead`);
    // It stays finished until its session starts, so no round checks it while git adds its worktree.
    if (this.busy(task)) return this.view(task);
    const agent = agentOf(task);
    const adapter = ADAPTERS[agent];
    const prompt = continuePrompt(task.branch);
    if (adapter.mainframeAddsWorktree) return this.reopenInWorktree(task, prompt);

    const bin = this.binOf(agent);
    const dir = this.taskDir(task.id);
    if (adapter.chatKept(dir)) {
      // A kept chat is a recorded one.
      task.claudeSessionId = adapter.recordedSession(dir)!;
      return this.relaunch(task, { ...this.reopenLaunch(task, bin, prompt), cwd: this.deps.projectDir }, { startedWithPrompt: true, resumePending: true, continued: true });
    }
    // The agent deleted the chat: a new one, which the agent's own flag starts in the fresh worktree. The old record
    // goes, or an exit before the new one is recorded would bring back the id of the chat that is gone.
    adapter.forgetChat(dir);
    task.claudeSessionId = adapter.newSessionId(this.newId);
    const launch = this.startLaunch(task, bin, { continuing: true });
    return this.relaunch(task, { ...launch, cwd: this.deps.projectDir }, { startedWithPrompt: true, resumePending: false, continued: true });
  }

  /**
   * Has a paused task's own agent move its card back to the to-do list: its chat is resumed with the put-back prompt,
   * and closed once that turn is over; a question or a permission prompt on the way waits for the owner's answer.
   * Resolves true when the session exits, and at once when no session starts, as for a task whose conversation never
   * began, which never took its card. Resolves false when the session errs: it then stays on the board as any task
   * does, and Put back is given up.
   */
  async putBackCard(taskId: string): Promise<boolean> {
    const task = this.find(taskId);
    if (task.place !== undefined) throw new Error(`Task ${task.title} is not paused on the board, so it cannot be put back`);
    if (!this.pausedOnBoard(task)) throw new Error(`Close ${task.title} before putting it back`);
    if (!this.began(task)) return true;
    const agent = agentOf(task);
    const adapter = ADAPTERS[agent];
    const prompt = putBackPrompt(adapter.instructions);
    let view: TaskView;
    if (adapter.mainframeAddsWorktree) {
      view = await this.reopenInWorktree(task, prompt, { owed: false });
    } else {
      // A conversation that began is a recorded one.
      task.claudeSessionId = adapter.recordedSession(this.taskDir(task.id))!;
      const launch = this.reopenLaunch(task, this.binOf(agent), prompt);
      // The put-back prompt is not owed: a launch that dies before it works leaves no carry-on prompt for a Reopen.
      view = this.relaunch(task, { ...launch, cwd: this.deps.projectDir }, { startedWithPrompt: true, resumePending: false });
    }
    const session = view.session && this.sessions.get(view.session.id);
    if (!session) return true;
    return new Promise((resolve) => (session.putBack = { worked: false, settle: resolve }));
  }

  /**
   * Runs Put back's `run` with the task marked as being put back: the view shows it, and Reopen, Discard, a second Put
   * back and the round leave the task alone until the run ends, however it ends.
   */
  async whilePuttingBack<T>(taskId: string, run: () => Promise<T>): Promise<T> {
    const task = this.find(taskId);
    this.refuseWhilePuttingBack(task);
    this.puttingBack.add(task.id);
    this.deps.onChange(this.list());
    try {
      return await run();
    } finally {
      this.puttingBack.delete(task.id);
      this.deps.onChange(this.list());
    }
  }

  private refuseWhilePuttingBack(task: TaskRecord): void {
    if (this.puttingBack.has(task.id)) throw new Error(`${task.title} is being put back`);
  }

  /**
   * Takes a paused task off the board, onto the to-do list; true when it moved. One that moved meanwhile, or runs again,
   * stays where it is.
   */
  markPutBack(taskId: string): boolean {
    const task = this.find(taskId);
    if (!this.pausedOnBoard(task)) return false;
    task.place = 'putBack';
    this.problems.delete(task.id);
    this.commit();
    return true;
  }

  /**
   * Brings a put-back task back to Paused on the board, or keeps one there, with Put back's failure line or none. A
   * finished or discarded task, or one a round is removing (it is about to finish), stays where it is.
   */
  returnToBoard(taskId: string, problem?: string): void {
    const task = this.mine().find((t) => t.id === taskId);
    if (!task || isEnded(task.place) || this.removing.has(task.id)) return;
    delete task.place;
    if (problem === undefined) this.problems.delete(task.id);
    else this.problems.set(task.id, problem);
    this.commit();
  }

  /**
   * A session runs, or is on its way, for the task, or a round is removing its worktree, or the project is closing or
   * the app quitting: a reopen then leaves the task as recorded, to carry on when the project next opens.
   */
  private busy(task: TaskRecord): boolean {
    return this.sessionOf(task.id) !== undefined || this.worktreeChanging(task) || this.quitting;
  }

  /** Git is adding the task's worktree for a start, a reopen or a Continue, or a round or a Discard is removing it. */
  private worktreeChanging(task: TaskRecord): boolean {
    return this.starting.has(task.id) || this.launching.has(task.id) || this.removing.has(task.id);
  }

  /**
   * On the board and closed, with nothing under way for it. An open task with no session is one restore has yet to bring
   * back: still running, as far as the owner is concerned.
   */
  private pausedOnBoard(task: TaskRecord): boolean {
    return task.place === undefined && !task.open && !this.busy(task);
  }

  /** The project's task for the card: a card has at most one that isn't discarded. */
  private taskOfCard(cardId: string): TaskRecord | undefined {
    return this.mine().find((t) => t.card?.id === cardId && t.place !== 'discarded');
  }

  /** Its conversation began, as its agent knows it. */
  private began(task: TaskRecord): boolean {
    return ADAPTERS[agentOf(task)].began(this.taskDir(task.id), task);
  }

  /** Moves a task that ended off the board, to `place`. */
  private moveOff(task: TaskRecord, place: 'finished' | 'discarded'): void {
    task.place = place;
    task.endedAt = this.now();
    this.problems.delete(task.id);
    this.commit();
  }

  private async addWorktree(task: TaskRecord, create: boolean): Promise<void> {
    this.hideWorktreesFolder(task);
    await this.deps.git.addWorktree(this.deps.projectDir, task.worktreePath, task.branch, { create });
  }

  /** Removes the worktree a reopen just added, unforced, and its branch when the reopen made it; a failure only warns. */
  private async removeAdded(task: TaskRecord, branchMade: boolean): Promise<void> {
    try {
      await this.deps.git.removeWorktree(this.deps.projectDir, task.worktreePath, { force: false });
      if (branchMade) await this.deps.git.deleteBranch(this.deps.projectDir, task.branch);
    } catch (err) {
      this.warn(`Could not remove the worktree just added for task ${task.id} (${task.slug}): ${message(err)}`);
    }
  }

  /**
   * Gives the folder that holds the task's worktree a `.gitignore` of `*`, so git ignores everything in it, the
   * file too, and the folder never shows in git status. One that is there is left as it is; a failure only warns.
   */
  private hideWorktreesFolder(task: TaskRecord): void {
    const folder = dirname(task.worktreePath);
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, '.gitignore'), '*\n', { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
      this.warn(`Could not hide ${folder} from git status: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Resumes the session Mainframe started, in the task's worktree, with `prompt`, or starts it again with the opening
   * prompt when its conversation never began. A missing worktree folder is added back from its branch, or on a new
   * branch from the base when the branch is gone too. Marked as launching while git runs, so no round removes the task
   * and no second reopen starts it meanwhile.
   */
  private async reopenInWorktree(task: TaskRecord, prompt = resumePromptFor(task), { owed = true } = {}): Promise<TaskView> {
    const bin = this.binOf(agentOf(task));
    if (!existsSync(task.worktreePath)) {
      const place = task.place;
      this.launching.add(task.id);
      try {
        const create = !(await this.deps.git.branchExists(this.deps.projectDir, task.branch));
        // The task may have moved, or the project closed or the app begun to quit, while git ran.
        if (task.place !== place || this.quitting) return this.view(task);
        await this.addWorktree(task, create);
        if (task.place !== place || this.quitting) {
          // A task that moved, or a Continue's that stays finished, has no session to use it: what was made goes.
          await this.removeAdded(task, create);
          return this.view(task);
        }
      } finally {
        this.launching.delete(task.id);
      }
    }
    const cwd = task.worktreePath;
    if (!task.began) {
      // OpenCode never took the brief: it failed to start, was quit at its login screen, or Mainframe quit first.
      return this.relaunch(task, { ...this.startLaunch(task, bin), cwd }, { startedWithPrompt: true, resumePending: false });
    }
    const carryOn = prompt !== undefined;
    const launch = this.reopenLaunch(task, bin, prompt);
    return this.relaunch(task, { ...launch, cwd }, { startedWithPrompt: carryOn, resumePending: carryOn && owed });
  }

  /** Runs the task's session, which puts it on the board. */
  private relaunch(task: TaskRecord, launch: LaunchSpec, o: { startedWithPrompt: boolean; resumePending: boolean; continued?: boolean }): TaskView {
    delete task.place;
    delete task.endedAt;
    this.problems.delete(task.id);
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
    await this.checkRound();
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

  /**
   * Closes the task's session as `close` does, for the manager: only once its turn is over, as Mainframe finds it now
   * and not as a list read a moment ago said. Says what it closed; throws, with a sentence the manager passes on, when
   * the task has no session, is being put back, or its session is ending, in a turn or still starting.
   */
  closeWhenTurnOver(taskId: string): { title: string; msg: string | null; merged: boolean } {
    const task = this.find(taskId);
    this.refuseWhilePuttingBack(task);
    const running = this.sessionOf(taskId);
    if (!running) throw new Error(`${task.title} has no session running: it is ${WHERE[task.place ?? 'board']}.`);
    if (running.turn.ending) throw new Error(`${task.title}'s session is already closing.`);
    const status = this.deps.status(running.id);
    if (!running.turn.over(running.startedWithPrompt)) {
      const what = (status && IN_TURN[status.state]) ?? 'still starting';
      throw new Error(`${task.title}'s session is ${what}; it can be closed once its turn is over.`);
    }
    const closed = { title: task.title, msg: status?.msg ?? null, merged: this.merged.has(task.id) };
    this.close(taskId);
    return closed;
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
    const wasOver = session.turn.over(session.startedWithPrompt);
    session.turn.note(state);
    const task = this.find(session.taskId);
    this.lookForWorktree(session, task);
    // New work may land on a merged branch: the card leaves Done until a round proves it again.
    if (inTurn(state) && this.merged.delete(task.id)) this.deps.onChange(this.list());
    if (agentOf(task) === 'opencode' && !task.began && inTurn(state)) {
      task.began = true;
      // Saved, not sent: nothing the window shows has changed.
      this.deps.records.save();
    }
    if (session.putBack && !session.turn.ending) {
      if (state === 'working') session.putBack.worked = true;
      if (state === 'error') {
        session.putBack.settle(false);
        delete session.putBack;
      } else if (state === 'done' || (state === 'idle' && session.putBack.worked)) {
        this.close(task.id);
      }
    } else if (!wasOver && session.turn.over(session.startedWithPrompt)) {
      // A turn's end is when a running task may have been merged: its card goes to Done without waiting for the timer.
      void this.checkRound();
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
    // The mark is for a running task; once closed, the round decides.
    this.merged.delete(task.id);
    this.lookForWorktree(session, task);
    if (session.worktreeSeen) {
      this.unmade.delete(task.id);
    } else if (session.continued || this.unmade.has(task.id)) {
      this.unmade.add(task.id);
      this.problems.set(task.id, 'The session ended before its worktree was made');
    }
    this.commit();
    session.putBack?.settle(true);
    // A task's exit is when it may have finished: Finish is Close.
    void this.checkRound();
  }

  /**
   * Checks the project's tasks on the board or put back: a running one with nothing to lose is marked merged, a
   * paused one has its worktree and branch removed and moves to Finished. One round at a time; a call while one runs
   * queues one more after it, so a task that ended after the running round passed it is checked. Never rejects.
   */
  checkRound(): Promise<void> {
    if (this.nextRound) return this.nextRound;
    if (this.round) {
      this.nextRound = this.round.then(() => {
        this.nextRound = null;
        return this.runRound();
      });
      return this.nextRound;
    }
    return this.runRound();
  }

  private runRound(): Promise<void> {
    const round = this.roundOnce()
      .catch((err: unknown) => this.warn(`The check round failed: ${message(err)}`))
      .finally(() => {
        if (this.round === round) this.round = null;
      });
    this.round = round;
    return round;
  }

  private async roundOnce(): Promise<void> {
    if (this.quitting) return;
    await this.deps.git.fetchBase(this.deps.projectDir);
    for (const task of this.mine().filter((t) => t.place === undefined || t.place === 'putBack')) {
      if (this.quitting) return;
      if (this.worktreeChanging(task) || this.puttingBack.has(task.id) || this.unmade.has(task.id)) continue;
      try {
        await this.checkTask(task);
      } catch (err) {
        this.warn(`Could not check task ${task.id} (${task.slug}): ${message(err)}`);
      }
    }
  }

  private async checkTask(task: TaskRecord): Promise<void> {
    // Where the round found it: a move meanwhile (Discard, Put back) is not overwritten.
    const place = task.place;
    const passed = (await this.nothingToLose(task)) !== null;
    const running = this.sessionOf(task.id);
    if (running) {
      // A session that went back to work while git was read may be adding to the branch: the next turn's end proves it.
      const mark = passed && !inTurn(this.deps.status(running.id)?.state ?? null);
      if (mark === this.merged.has(task.id)) return;
      if (mark) this.merged.add(task.id);
      else this.merged.delete(task.id);
      this.deps.onChange(this.list());
      return;
    }
    if (!passed) return;
    // The proof, again, just before anything is deleted.
    const proof = await this.nothingToLose(task);
    if (!proof) return;
    // An open task with no session is one restore, or a quit, has yet to bring back.
    if (this.busy(task) || task.open || task.place !== place || this.puttingBack.has(task.id)) return;
    this.removing.add(task.id);
    try {
      await this.removeWorktreeOf(task, { force: false });
      if (this.quitting) return;
      // Only the commit the proof was made on: a branch that moved since, or was made again, stays.
      if (proof.tip !== null) await this.deps.git.deleteBranch(this.deps.projectDir, task.branch, proof.tip);
    } catch (err) {
      this.warn(`Could not remove the worktree or branch of task ${task.id} (${task.slug}), so it stays: ${message(err)}`);
      return;
    } finally {
      this.removing.delete(task.id);
    }
    if (task.place !== place) return;
    this.moveOff(task, 'finished');
  }

  /**
   * What git found, when the task has nothing to lose: its conversation began, its worktree holds nothing uncommitted
   * and is on its branch, and its branch is merged or gone. Null otherwise.
   */
  private async nothingToLose(task: TaskRecord): Promise<TaskGitState | null> {
    if (!this.began(task)) return null;
    const state = await this.deps.git.taskGitState(this.deps.projectDir, task.branch, task.worktreePath);
    const passed = state.uncommitted.length === 0 && !state.elsewhere && (state.branch === 'gone' || state.branch === 'merged');
    return passed ? state : null;
  }

  /**
   * Removes the task's worktree; a failure says why on its card, where a folder left behind says what to do. Git's later
   * tries at that folder only find it is no worktree, so the advice stays until the folder is gone.
   */
  private async removeWorktreeOf(task: TaskRecord, o: { force: boolean }): Promise<void> {
    try {
      await this.deps.git.removeWorktree(this.deps.projectDir, task.worktreePath, o);
    } catch (err) {
      if (err instanceof FolderLeftError) {
        this.problems.set(task.id, `${FOLDER_LEFT} ${task.worktreePath} (${message(err)})`);
      } else if (!this.problems.get(task.id)?.startsWith(FOLDER_LEFT)) {
        this.problems.set(task.id, `Could not remove the worktree: ${message(err)}`);
      }
      this.commit();
      throw err;
    }
  }

  /** What a Discard would lose: the uncommitted and untracked files, and the commits on neither the base nor a remote branch. */
  async discardPreview(taskId: string): Promise<DiscardPreview> {
    const task = this.find(taskId);
    const { uncommitted, unsaved } = await this.deps.git.taskGitState(this.deps.projectDir, task.branch, task.worktreePath);
    return { uncommitted, unsaved };
  }

  /**
   * Throws away a paused task's worktree and branch, forced: the owner has seen the preview. A task a round is removing
   * is refused rather than waited for. Marked as removing meanwhile, so a reopen starts no session in what goes.
   */
  async discard(taskId: string): Promise<void> {
    const task = this.find(taskId);
    if (task.place !== undefined) throw new Error(`Task ${task.title} is not paused on the board, so it cannot be discarded`);
    if (!this.pausedOnBoard(task)) throw new Error(`Close ${task.title} before discarding it`);
    this.refuseWhilePuttingBack(task);
    this.removing.add(task.id);
    try {
      await this.removeWorktreeOf(task, { force: true });
      await this.deps.git.deleteBranch(this.deps.projectDir, task.branch);
    } finally {
      this.removing.delete(task.id);
    }
    this.moveOff(task, 'discarded');
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

  private addSession({ resumePending, ...session }: Pick<Session, 'taskId' | 'launch' | 'startedWithPrompt' | 'continued'> & { resumePending: boolean }): void {
    const id = this.newId();
    this.sessions.set(id, { id, ...session, turn: new TurnTracker(resumePending) });
  }

  /**
   * Notes that a Continue's session, or one of a task whose earlier session ended before its worktree was made, has
   * seen the worktree folder. The agent makes it before the session's first report, so a worktree removed later (merged
   * and tidied away) still counts as made.
   */
  private lookForWorktree(session: Session, task: TaskRecord): void {
    if (session.worktreeSeen || !(session.continued || this.unmade.has(task.id))) return;
    if (existsSync(task.worktreePath)) session.worktreeSeen = true;
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
  private reopenLaunch(task: TaskRecord, bin: string, prompt: string | undefined): LaunchArgs {
    return ADAPTERS[agentOf(task)].taskReopen({
      bin,
      nodeBin: this.deps.nodeBin,
      taskDir: this.taskDir(task.id),
      slug: task.slug,
      sessionId: task.claudeSessionId,
      prompt,
    });
  }

  /**
   * The launch that begins the task's conversation, under its `claudeSessionId`, with its opening prompt. On Windows,
   * when it would overflow the command line, the description goes to a file in a folder the session may read (`addDir`),
   * and the prompt points at it. `continuing`: Continue starts it again, as its earlier conversation is gone.
   */
  private startLaunch(task: TaskRecord, bin: string, { continuing = false } = {}): LaunchArgs {
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
          continuing,
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
      place: task.place ?? null,
      endedAt: task.endedAt ?? null,
      merged: this.merged.has(task.id),
      puttingBack: this.puttingBack.has(task.id),
      problem: this.problems.get(task.id) ?? null,
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

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A task kept before tasks named their agent runs on Claude Code. */
const agentOf = (task: TaskRecord): AgentName => task.agent ?? 'claude';
