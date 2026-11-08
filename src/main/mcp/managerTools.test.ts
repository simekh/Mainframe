import type { McpServer } from '@modelcontextprotocol/server';
import { expect, it } from 'vitest';
import type { StartCheck, TaskView } from '../../shared/types';
import type { SessionReport } from '../tasks/taskService';
import type { SyncOutcome } from '../todo/todoService';
import { registerManagerTools } from './managerTools';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
interface Registered {
  config: { description?: string; inputSchema?: { safeParse(value: unknown): { success: boolean } } };
  handler: (args?: unknown) => Promise<ToolResult>;
}

const VIEW = { id: 'task-1', title: 'Fix login', branch: 'worktree-fix-login' } as TaskView;
const REPORT: SessionReport = {
  taskId: 'task-1',
  title: 'Fix login',
  branch: 'worktree-fix-login',
  worktreePath: '/p/.claude/worktrees/fix-login',
  claudeSessionId: 'claude-1',
  createdAt: 1000,
  closedAt: null,
  running: true,
  state: 'working',
  msg: null,
};

/** The tools, registered through a fake server that records `registerTool`, and what they were given. */
function setup(
  overrides: { start?: (req: unknown) => Promise<TaskView>; check?: StartCheck | null; sync?: () => Promise<SyncOutcome>; startItem?: () => Promise<TaskView> } = {},
) {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
      tools.set(name, { config, handler });
    },
  } as unknown as McpServer;
  const calls: string[] = [];
  const started: unknown[] = [];
  const startedItems: unknown[] = [];
  registerManagerTools(server, {
    reports: () => [REPORT],
    startCheck: async () => (calls.push('startCheck'), overrides.check ?? null),
    start: async (req) => {
      calls.push('start');
      started.push(req);
      return overrides.start ? overrides.start(req) : VIEW;
    },
    todo: {
      sync: async () => (calls.push('sync'), overrides.sync ? overrides.sync() : { cards: 0 }),
      startItem: async (item, opts) => {
        calls.push('startItem');
        startedItems.push({ item, opts });
        return overrides.startItem ? overrides.startItem() : VIEW;
      },
    },
  });
  const call = (name: string, args?: unknown) => tools.get(name)!.handler(args);
  return { tools, calls, started, startedItems, call };
}

const json = (result: ToolResult) => {
  expect(result.content).toHaveLength(1);
  return JSON.parse(result.content[0].text);
};

it('registers list_sessions, start_task and sync_todo, and nothing else, each with a description', () => {
  const { tools } = setup();
  expect([...tools.keys()]).toEqual(['list_sessions', 'start_task', 'sync_todo']);
  for (const tool of tools.values()) expect(tool.config.description).toMatch(/\w/);
});

it('list_sessions takes no input and returns the reports as JSON', async () => {
  const { tools, call } = setup();
  expect(tools.get('list_sessions')!.config.inputSchema).toBeUndefined();
  expect(json(await call('list_sessions'))).toEqual({ sessions: [REPORT] });
});

it('start_task takes a title of 1 to 200 characters, a brief of up to 20000 and an optional noQuestions', () => {
  const schema = setup().tools.get('start_task')!.config.inputSchema!;
  expect(schema.safeParse({ title: 'Fix login', brief: '' }).success).toBe(true);
  expect(schema.safeParse({ title: 'x'.repeat(200), brief: 'y'.repeat(20000), noQuestions: true }).success).toBe(true);
  expect(schema.safeParse({ title: '', brief: 'b' }).success).toBe(false);
  expect(schema.safeParse({ title: 'x'.repeat(201), brief: 'b' }).success).toBe(false);
  expect(schema.safeParse({ title: 't', brief: 'y'.repeat(20001) }).success).toBe(false);
  expect(schema.safeParse({ title: 't' }).success).toBe(false);
  expect(schema.safeParse({ title: 't', brief: 'b', noQuestions: 'yes' }).success).toBe(false);
});

it('start_task takes an optional cardId', () => {
  const schema = setup().tools.get('start_task')!.config.inputSchema!;
  expect(schema.safeParse({ title: 'Fix login', brief: '', cardId: 'card-1' }).success).toBe(true);
  expect(schema.safeParse({ title: 'Fix login', brief: '', cardId: 7 }).success).toBe(false);
});

it('start_task checks the start, then starts the task with the brief as its description and questions allowed', async () => {
  const { call, calls, started } = setup();
  const result = await call('start_task', { title: 'Fix login', brief: 'Users get logged out' });

  expect(calls).toEqual(['startCheck', 'start']);
  expect(started).toEqual([{ title: 'Fix login', description: 'Users get logged out', noQuestions: false }]);
  expect(result.isError).toBeUndefined();
  // Exactly these keys: `warning` is absent, not undefined or null.
  expect(json(result)).toStrictEqual({ taskId: 'task-1', title: 'Fix login', branch: 'worktree-fix-login' });
});

it('start_task passes noQuestions on', async () => {
  const { call, started } = setup();
  await call('start_task', { title: 'Fix login', brief: '', noQuestions: true });
  expect(started).toEqual([{ title: 'Fix login', description: '', noQuestions: true }]);
});

it('start_task warns, as the new task dialog does, when the branch is ahead of its base', async () => {
  const plural = setup({ check: { ahead: 2, branch: 'stage', base: 'origin/stage' } });
  expect(json(await plural.call('start_task', { title: 'Fix login', brief: '' })).warning).toBe(
    "stage has 2 commits that aren't on origin/stage. New worktrees start from origin/stage, so this task won't have them.",
  );

  const singular = setup({ check: { ahead: 1, branch: 'stage', base: 'origin/stage' } });
  expect(json(await singular.call('start_task', { title: 'Fix login', brief: '' })).warning).toBe(
    "stage has 1 commit that isn't on origin/stage. New worktrees start from origin/stage, so this task won't have it.",
  );
});

it('start_task gives no warning when nothing is ahead', async () => {
  const { call } = setup({ check: { ahead: 0, branch: 'stage', base: 'origin/stage' } });
  expect(json(await call('start_task', { title: 'Fix login', brief: '' }))).not.toHaveProperty('warning');
});

it('start_task with a cardId starts from that card with the brief', async () => {
  const { call, calls, started, startedItems } = setup({ check: { ahead: 1, branch: 'stage', base: 'origin/stage' } });
  const result = await call('start_task', { title: 'Fix login', brief: 'Only the login page', cardId: 'card-1', noQuestions: true });

  // The start check and its warning are the same as without a card; the task comes from the Todo service, not from `start`.
  expect(calls).toEqual(['startCheck', 'startItem']);
  expect(started).toEqual([]);
  expect(startedItems).toEqual([{ item: { kind: 'card', id: 'card-1' }, opts: { noQuestions: true, brief: 'Only the login page' } }]);
  expect(result.isError).toBeUndefined();
  expect(json(result)).toStrictEqual({
    taskId: 'task-1',
    title: 'Fix login',
    branch: 'worktree-fix-login',
    warning: "stage has 1 commit that isn't on origin/stage. New worktrees start from origin/stage, so this task won't have it.",
  });

  await call('start_task', { title: 'Fix login', brief: '', cardId: 'card-2' });
  expect(startedItems[1]).toEqual({ item: { kind: 'card', id: 'card-2' }, opts: { noQuestions: false, brief: '' } });
});

it('start_task turns a start that fails into an error result with its message', async () => {
  const { call } = setup({ start: () => Promise.reject(new Error('A task needs a title')) });
  const result = await call('start_task', { title: ' ', brief: '' });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: 'A task needs a title' }]);
});

it('start_task turns a card that cannot start into an error result with its message', async () => {
  const { call } = setup({ startItem: () => Promise.reject(new Error('No card card-9 in the synced list; sync it again')) });
  const result = await call('start_task', { title: 'Fix login', brief: '', cardId: 'card-9' });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: 'No card card-9 in the synced list; sync it again' }]);
});

it('sync_todo takes no input and returns the card count, what the owner must do first, or the error', async () => {
  expect(setup().tools.get('sync_todo')!.config.inputSchema).toBeUndefined();

  const synced = setup({ sync: async () => ({ cards: 7 }) });
  expect(json(await synced.call('sync_todo'))).toStrictEqual({ cards: 7 });
  expect(synced.calls).toEqual(['sync']);

  const tools = setup({ sync: async () => ({ ask: 'tools' }) });
  expect(json(await tools.call('sync_todo'))).toStrictEqual({ needsOwner: 'Allow the tools that read the to-do list, in the Todo panel' });

  const lists = setup({ sync: async () => ({ ask: 'lists' }) });
  expect(json(await lists.call('sync_todo'))).toStrictEqual({ needsOwner: 'Pick the to-do list, in the Todo panel' });

  const failed = await setup({ sync: async () => ({ error: "The connector isn't signed in" }) }).call('sync_todo');
  expect(failed.isError).toBe(true);
  expect(failed.content).toEqual([{ type: 'text', text: "The connector isn't signed in" }]);

  // A sync that refuses to start, as with a list file a newer Mainframe wrote, is an error result too.
  const refused = await setup({ sync: () => Promise.reject(new Error('A newer Mainframe wrote the list')) }).call('sync_todo');
  expect(refused.isError).toBe(true);
  expect(refused.content).toEqual([{ type: 'text', text: 'A newer Mainframe wrote the list' }]);
});
