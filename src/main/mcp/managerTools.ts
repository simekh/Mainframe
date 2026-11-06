import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { commitsThatArent } from '../../shared/commitsThatArent';
import type { StartCheck } from '../../shared/types';
import type { TaskService } from '../tasks/taskService';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** What the new-task dialog warns of, as a sentence; the dialog's own "Push … first" is for the owner to act on. */
const aheadWarning = ({ ahead, branch, base }: StartCheck) =>
  `${branch} has ${commitsThatArent(ahead)} on ${base}. New worktrees start from ${base}, so this task won't have ${ahead === 1 ? 'it' : 'them'}.`;

/** The tools the manager session has: to read the task sessions, and to start one. */
export function registerManagerTools(server: McpServer, deps: Pick<TaskService, 'reports' | 'start' | 'startCheck'>): void {
  server.registerTool(
    'list_sessions',
    {
      description:
        "Every task session Mainframe runs for this project, with its title, branch, worktree, Claude session id, whether it runs, and its last reported state (working, idle, blocked, done, error; null before the first report) and message. Read a task's worktree and its git history to say what it is doing.",
    },
    async () => text({ sessions: deps.reports() }),
  );

  server.registerTool(
    'start_task',
    {
      description:
        'Starts a task session in a worktree of its own; it shows on the board under Working. Only when the owner asks for it. The title names the task; the brief is what the session starts from. noQuestions: the owner said not to ask them questions.',
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        brief: z.string().max(20000),
        noQuestions: z.boolean().optional(),
      }),
    },
    async ({ title, brief, noQuestions }) => {
      try {
        const check = await deps.startCheck();
        const task = await deps.start({ title, description: brief, noQuestions: noQuestions ?? false });
        const warning = check && check.ahead > 0 ? { warning: aheadWarning(check) } : {};
        return text({ taskId: task.id, title: task.title, branch: task.branch, ...warning });
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );
}
