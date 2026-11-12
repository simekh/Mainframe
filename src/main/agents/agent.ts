import type { AgentName, ProgramCheck } from '../../shared/types';
import type { ExecutableFiles, ExecutableLookup } from '../pty/findExecutable';
import type { VersionRunner } from '../setup/programChecks';

/** How a prompt names the repo's instructions: the first mention in full, later ones short. */
export interface Instructions { first: string; again: string; requires: string; integrates: string }

/** What a launch adds to the session host's own environment. */
export interface LaunchArgs { argv: string[]; env?: Record<string, string> }

export interface TaskStart { bin: string; nodeBin: string; taskDir: string; slug: string; name: string; sessionId: string; prompt: string; addDir?: string }

export interface TaskReopen { bin: string; nodeBin: string; taskDir: string; slug: string; sessionId: string; branchExists: boolean; prompt?: string }

/** Everything Mainframe knows about one agent CLI. */
export interface AgentAdapter {
  readonly name: AgentName;
  /** MAINFRAME_CLAUDE_BIN or MAINFRAME_OPENCODE_BIN. */
  readonly envVar: string;
  find(o: { fromEnv?: string; saved?: string[]; lookup: ExecutableLookup; run: VersionRunner }): Promise<ProgramCheck>;
  check(path: string, run: VersionRunner, files: ExecutableFiles): Promise<ProgramCheck>;
  /** Keys this agent sets in the shells it runs, which a session must not inherit. */
  readonly droppedEnv: readonly string[];
  readonly instructions: Instructions;
  /** The opening prompt's note on where the session runs. */
  worktreeNote(o: { branch: string; worktreePath: string; projectDir: string }): string;
  /** True: Mainframe adds the task's worktree and runs the agent in it. False: the agent's own flag makes it, from the project folder. */
  readonly makesWorktree: boolean;
  /** A new conversation id; Claude Code's comes from `uuid`, so tests can name it. */
  newSessionId(uuid: () => string): string;
  taskStart(o: TaskStart): LaunchArgs;
  taskReopen(o: TaskReopen): LaunchArgs;
  /** The conversation the agent last recorded in the task's folder (Claude Code's SessionStart hook); null when there is none, and always for OpenCode. */
  recordedSession(taskDir: string): string | null;
}
