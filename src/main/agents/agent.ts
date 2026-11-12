import type { AgentName, ProgramCheck, SyncModel } from '../../shared/types';
import type { ExecutableFiles } from '../pty/findExecutable';
import type { FindOptions, VersionRunner } from '../setup/programChecks';
import type { SyncStep } from '../todo/syncRun';
import type { SyncAnswer } from '../todo/todoSchema';

/** How a prompt names the repo's instructions: the first mention in full, later ones short. */
export interface Instructions { first: string; again: string; requires: string; integrates: string }

/** What a launch adds to the session host's own environment. */
export interface LaunchArgs { argv: string[]; env?: Record<string, string> }

/** `nodeBin` is null when no node was found: Claude Code's adapter then throws, and OpenCode's needs none. */
export interface TaskStart { bin: string; nodeBin: string | null; taskDir: string; slug: string; name: string; sessionId: string; prompt: string; addDir?: string }

export interface TaskReopen { bin: string; nodeBin: string | null; taskDir: string; slug: string; sessionId: string; branchExists: boolean; prompt?: string }

/** What settings.json keeps of one agent. */
export interface AgentSetting { enabled?: boolean; bin?: string; managerAgent?: string; syncModel?: string }

/** The agent a service runs now, where it is, and its settings. */
export interface AgentInUse { adapter: AgentAdapter; bin: string; setting: AgentSetting }

export interface ManagerLaunch {
  bin: string;
  nodeBin: string | null;
  env: Record<string, string>;
  /** The manager's folder in the data folder: the adapter writes what the launch reads there. */
  dir: string;
  projectDir: string;
  name: string;
  mcp: { url: string; token: string };
  rolePrompt: string;
  chat: string;
  resume: boolean;
  prompt?: string;
  setting: AgentSetting;
}

/** The words the sync prompts use for this agent. */
export interface SyncWords {
  /** "Claude Code sessions" or "coding agent sessions". */ sessions: string;
  instructions: Instructions;
  /** How discover asks for tool names: "(mcp__…)" for Claude Code. */ toolNames: string;
  /** Added to discover's "none": where to set the tracker up; '' adds nothing. */ noConnector: string;
}

export interface SyncRunSpec { argv: string[]; cwd: string; env: Record<string, string> }

/** How one agent runs the Todo sync: the headless run that reads the owner's tracker. */
export interface SyncAdapter {
  readonly words: SyncWords;
  /** Writes what the run reads into `dir` (the project's Todo folder) and returns the run. Throws when it can't. */
  prepare(o: { bin: string; nodeBin: string | null; dir: string; projectDir: string; env: Record<string, string>; step: SyncStep; tools: string[]; setting: AgentSetting }): SyncRunSpec;
  prompt(step: SyncStep): string;
  /** The run's answer from what it printed; throws an Error whose message is for the panel. */
  readAnswer(stdout: string, tools: string[]): SyncAnswer;
  isToolName(name: string): boolean;
  /** Tidies up after a run, from what it printed. Never throws. */
  afterRun(o: { bin: string; dir: string; env: Record<string, string>; stdout: string }): void;
  /** The models the sync may run on, cheapest first; only an agent whose sync needs one picked has it. */
  models?(o: { bin: string; dir: string; env: Record<string, string> }): Promise<SyncModel[]>;
}

/** The first model with a price: the cheapest known, as `models` sorts them. */
export const cheapestKnown = (models: SyncModel[]): string | null => models.find((m) => m.price !== null)?.id ?? null;

/** Everything Mainframe knows about one agent CLI. */
export interface AgentAdapter {
  readonly name: AgentName;
  /** MAINFRAME_CLAUDE_BIN or MAINFRAME_OPENCODE_BIN. */
  readonly envVar: string;
  find(o: FindOptions): Promise<ProgramCheck>;
  check(path: string, run: VersionRunner, files: ExecutableFiles): Promise<ProgramCheck>;
  /** Keys this agent sets in the shells it runs, which a session must not inherit. */
  readonly droppedEnv: readonly string[];
  readonly instructions: Instructions;
  /** The opening prompt's note on where the session runs. */
  worktreeNote(o: { branch: string; worktreePath: string; projectDir: string }): string;
  /** True: Mainframe adds the task's worktree and runs the agent in it. False: the agent's own flag makes it, from the project folder. */
  readonly mainframeAddsWorktree: boolean;
  /** Where this agent's task worktrees live, relative to the project folder, with `/` between the names. */
  readonly worktreesDir: string;
  /** Its launches run node (Claude Code's hooks), so it can't be used while no node was found. */
  readonly needsNode: boolean;
  /** A new conversation id; Claude Code's comes from `uuid`, so tests can name it. */
  newSessionId(uuid: () => string): string;
  taskStart(o: TaskStart): LaunchArgs;
  taskReopen(o: TaskReopen): LaunchArgs;
  /** The conversation the agent last recorded in the task's folder (Claude Code's SessionStart hook); null when there is none, and always for OpenCode. */
  recordedSession(taskDir: string): string | null;
  /** The chat to carry on: Claude Code's from its SessionStart record, OpenCode's the id manager.json saved. Null starts a new one. */
  managerChat(dir: string, saved: string | undefined): string | null;
  managerLaunch(o: ManagerLaunch): Promise<LaunchArgs>;
  readonly sync: SyncAdapter;
}
