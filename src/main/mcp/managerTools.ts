import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { commitsThatArent } from '../../shared/commitsThatArent';
import type { StartCheck } from '../../shared/types';
import type { TaskService } from '../tasks/taskService';
import type { TodoService } from '../todo/todoService';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const failure = (err: unknown) => ({ content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true });

/** What the owner must do in the Todo panel before a sync can read the list, for each thing it asks. */
const NEEDS_OWNER = {
  tools: 'Allow the tools that read the to-do list, in the Todo panel',
  lists: 'Pick the to-do list, in the Todo panel',
};

/** What the new-task dialog warns of, as a sentence; the dialog's own "Push … first" is for the owner to act on. */
const aheadWarning = ({ ahead, branch, base }: StartCheck) =>
  `${branch} has ${commitsThatArent(ahead)} on ${base}. New worktrees start from ${base}, so this task won't have ${ahead === 1 ? 'it' : 'them'}.`;

/** The tools the manager session has: to read the task sessions, to start one, and to sync the Todo panel. */
export function registerManagerTools(
  server: McpServer,
  tasks: Pick<TaskService, 'reports' | 'start' | 'startCheck'>,
  todo: Pick<TodoService, 'sync' | 'startItem'>,
): void {
  server.registerTool(
    'list_sessions',
    {
      description:
        "Every task session Mainframe runs for this project, with its title, branch, worktree, Claude session id, whether it runs, its last reported state (working, idle, blocked, done, error; null before the first report) and message, and the card it was started from (number and URL; null for none). Read a task's worktree and its git history to say what it is doing.",
    },
    async () => text({ sessions: tasks.reports() }),
  );

  server.registerTool(
    'start_task',
    {
      description:
        "Starts a task session in a worktree of its own; it shows on the board under Working. Only when the owner asks for it. The title names the task; the brief is what the session starts from. noQuestions: the owner said not to ask them questions. With cardId (a synced card's id, or its number as the Todo list shows it, such as #131), the task starts from that card: it takes the card's title, and the brief is what the owner added.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        brief: z.string().max(20000),
        noQuestions: z.boolean().optional(),
        cardId: z.string().optional(),
      }),
    },
    async ({ title, brief, noQuestions, cardId }) => {
      try {
        const check = await tasks.startCheck();
        const quiet = noQuestions ?? false;
        const task = await (cardId === undefined
          ? tasks.start({ title, description: brief, noQuestions: quiet })
          : todo.startItem({ kind: 'card', id: cardId }, { noQuestions: quiet, brief }));
        const warning = check && check.ahead > 0 ? { warning: aheadWarning(check) } : {};
        return text({ taskId: task.id, title: task.title, branch: task.branch, ...warning });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'sync_todo',
    {
      description:
        "Syncs the Todo panel: a background run reads the owner's to-do list through their connector, and Mainframe shows it. Returns the number of cards, what the owner must do in the Todo panel first (allow the tools that read the list, or pick the list), or why it couldn't. Only when the owner asks.",
    },
    async () => {
      try {
        const outcome = await todo.sync();
        if ('error' in outcome) return failure(outcome.error);
        if ('ask' in outcome) return text({ needsOwner: NEEDS_OWNER[outcome.ask] });
        return text({ cards: outcome.cards });
      } catch (err) {
        return failure(err);
      }
    },
  );
}
