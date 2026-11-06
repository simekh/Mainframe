import type { McpServer } from '@modelcontextprotocol/server';
import { expect, it } from 'vitest';
import type { StartCheck, TaskView } from '../../shared/types';
import type { SessionReport } from '../tasks/taskService';
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
function setup(overrides: { start?: (req: unknown) => Promise<TaskView>; check?: StartCheck | null } = {}) {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
      tools.set(name, { config, handler });
    },
  } as unknown as McpServer;
  const calls: string[] = [];
  const started: unknown[] = [];
  registerManagerTools(server, {
    reports: () => [REPORT],
    startCheck: async () => (calls.push('startCheck'), overrides.check ?? null),
    start: async (req) => {
      calls.push('start');
      started.push(req);
      return overrides.start ? overrides.start(req) : VIEW;
    },
  });
  const call = (name: string, args?: unknown) => tools.get(name)!.handler(args);
  return { tools, calls, started, call };
}

const json = (result: ToolResult) => {
  expect(result.content).toHaveLength(1);
  return JSON.parse(result.content[0].text);
};

it('registers list_sessions and start_task, and nothing else, with their descriptions', () => {
  const { tools } = setup();
  expect([...tools.keys()]).toEqual(['list_sessions', 'start_task']);
  expect(tools.get('list_sessions')!.config.description).toBe(
    'Every task session Mainframe runs for this project, with its title, branch, worktree, Claude session id, whether it runs, and its last reported state (working, idle, blocked, done, error; null before the first report) and message. Read a task\'s worktree and its git history to say what it is doing.',
  );
  expect(tools.get('start_task')!.config.description).toBe(
    'Starts a task session in a worktree of its own; it shows on the board under Working. Only when the owner asks for it. The title names the task; the brief is what the session starts from. noQuestions: the owner said not to ask them questions.',
  );
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

it('start_task gives no warning when nothing is ahead or the check has no answer', async () => {
  for (const check of [{ ahead: 0, branch: 'stage', base: 'origin/stage' }, null]) {
    const { call } = setup({ check });
    expect(json(await call('start_task', { title: 'Fix login', brief: '' }))).not.toHaveProperty('warning');
  }
});

it('start_task turns a start that fails into an error result with its message', async () => {
  const { call } = setup({ start: () => Promise.reject(new Error('A task needs a title')) });
  const result = await call('start_task', { title: ' ', brief: '' });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: 'A task needs a title' }]);
});
