import type { McpServer } from '@modelcontextprotocol/server';
import { expect, it } from 'vitest';
import type { StartCheck, TaskView, TodoView } from '../../shared/types';
import type { SessionReport } from '../tasks/taskService';
import type { SyncOutcome } from '../todo/todoService';
import { registerManagerTools } from './managerTools';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
interface Registered {
  config: { description?: string; inputSchema?: { safeParse(value: unknown): { success: boolean; data?: unknown } } };
  handler: (...args: unknown[]) => Promise<ToolResult>;
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
  place: null,
  endedAt: null,
  running: true,
  state: 'working',
  msg: null,
  merged: false,
  card: { number: '#128', url: 'https://tracker.example/c/128' },
  agent: 'claude',
};

/** The tools, registered through a fake server that records `registerTool`, and what they were given. */
function setup(
  overrides: {
    start?: (req: unknown) => Promise<TaskView>;
    check?: StartCheck | null;
    sync?: () => Promise<SyncOutcome>;
    startItem?: (item: unknown, opts: { ownersCard?: boolean }) => Promise<TaskView>;
    ask?: TodoView['ask'];
    close?: (taskId: string) => { title: string; msg: string | null; merged: boolean };
  } = {},
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
  const closed: string[] = [];
  const noted: string[] = [];
  registerManagerTools(
    server,
    {
      reports: () => [REPORT],
      startCheck: async () => (calls.push('startCheck'), overrides.check ?? null),
      start: async (req) => {
        calls.push('start');
        started.push(req);
        return overrides.start ? overrides.start(req) : VIEW;
      },
      closeWhenTurnOver: (taskId) => {
        calls.push('close');
        closed.push(taskId);
        return overrides.close ? overrides.close(taskId) : { title: 'Fix login', msg: null, merged: false };
      },
    },
    {
      view: () => ({ source: null, syncedAt: null, cards: [], notes: [], syncing: false, longSync: false, error: null, ask: overrides.ask ?? null, setUp: false }),
      sync: async () => (calls.push('sync'), overrides.sync ? overrides.sync() : { cards: 0 }),
      startItem: async (item, opts) => {
        calls.push('startItem');
        startedItems.push({ item, opts });
        return overrides.startItem ? overrides.startItem(item, opts) : VIEW;
      },
    },
    (sessionId) => noted.push(sessionId),
  );
  const call = (name: string, args?: unknown) => tools.get(name)!.handler(args);
  return { tools, calls, started, startedItems, closed, noted, call };
}

const json = (result: ToolResult) => {
  expect(result.content).toHaveLength(1);
  return JSON.parse(result.content[0].text);
};

it('registers list_sessions, start_task, sync_todo and close_session, and nothing else, each with a description', () => {
  const { tools } = setup();
  expect([...tools.keys()]).toEqual(['list_sessions', 'start_task', 'sync_todo', 'close_session']);
  for (const tool of tools.values()) expect(tool.config.description).toMatch(/\w/);
});

it('list_sessions says what merged means', () => {
  const { tools } = setup();
  expect(tools.get('list_sessions')!.config.description).toContain('merged: true once Mainframe found its branch merged with nothing uncommitted');
});

it('close_session takes a task id, closes that task and returns what was closed', async () => {
  const { tools, call, calls, closed } = setup({ close: () => ({ title: 'Fix login', msg: 'All merged', merged: true }) });
  const schema = tools.get('close_session')!.config.inputSchema!;
  expect(schema.safeParse({ taskId: 'task-1' }).success).toBe(true);
  expect(schema.safeParse({}).success).toBe(false);
  expect(json(await call('close_session', { taskId: 'task-1' }))).toEqual({ taskId: 'task-1', title: 'Fix login', msg: 'All merged', merged: true });
  expect(calls).toEqual(['close']);
  expect(closed).toEqual(['task-1']);
});

it("close_session passes a refusal on as an error, in the service's words", async () => {
  const refusal = "Fix login's session is working; it can be closed once its turn is over.";
  const { call } = setup({
    close: () => {
      throw new Error(refusal);
    },
  });
  const result = await call('close_session', { taskId: 'task-1' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe(refusal);
});

it('close_session is for when the owner asks, and says what a close of merged work removes', () => {
  const { tools } = setup();
  const description = tools.get('close_session')!.config.description;
  expect(description).toContain('Only when the owner asks for it');
  expect(description).not.toContain('nothing is deleted');
  expect(description).toContain('its worktree and branch are removed');
});

it("list_sessions takes no input and returns the reports as JSON, each with its task's card", async () => {
  const { tools, call } = setup();
  expect(tools.get('list_sessions')!.config.inputSchema).toBeUndefined();
  const result = json(await call('list_sessions'));
  expect(result).toEqual({ sessions: [REPORT] });
  expect(result.sessions[0].card).toEqual({ number: '#128', url: 'https://tracker.example/c/128' });
});

it("list_sessions reports each task's place and endedAt", async () => {
  const { tools, call } = setup();
  expect(tools.get('list_sessions')!.config.description).toContain('where it is: null on the board, putBack, finished or discarded, with endedAt');
  const sessions = json(await call('list_sessions')).sessions;
  expect(sessions[0]).toMatchObject({ place: null, endedAt: null });
});

it('start_task takes a title of 1 to 200 characters, an optional brief of up to 20000 and an optional noQuestions', () => {
  const schema = setup().tools.get('start_task')!.config.inputSchema!;
  expect(schema.safeParse({ title: 'Fix login', brief: '' }).success).toBe(true);
  expect(schema.safeParse({ title: 'x'.repeat(200), brief: 'y'.repeat(20000), noQuestions: true }).success).toBe(true);
  expect(schema.safeParse({ title: '', brief: 'b' }).success).toBe(false);
  expect(schema.safeParse({ title: 'x'.repeat(201), brief: 'b' }).success).toBe(false);
  expect(schema.safeParse({ title: 't', brief: 'y'.repeat(20001) }).success).toBe(false);
  // As the new task dialog, whose description may stay empty.
  expect(schema.safeParse({ title: 't' }).success).toBe(true);
  expect(schema.safeParse({ title: 't', brief: 'b', noQuestions: 'yes' }).success).toBe(false);
});

it('start_task takes an optional cardId, and with one no title', () => {
  const { tools } = setup();
  const { config } = tools.get('start_task')!;
  expect(config.inputSchema!.safeParse({ title: 'Fix login', brief: '', cardId: 'card-1' }).success).toBe(true);
  expect(config.inputSchema!.safeParse({ title: 'Fix login', brief: '', cardId: 7 }).success).toBe(false);
  // A card start takes the card's title, so the manager isn't made to invent one it can't use.
  expect(config.inputSchema!.safeParse({ brief: '', cardId: 'card-1' }).success).toBe(true);
  expect(config.description).toContain('The title names the task (not needed with cardId)');
});

it('start_task refuses a start with neither a title nor a cardId', async () => {
  const { call, calls } = setup();
  const result = await call('start_task', { brief: 'Users get logged out' });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: 'A task needs a title, or a cardId to start from' }]);
  expect(calls).toEqual(['startCheck']);
});

it('start_task with only a cardId starts from that card, with no brief', async () => {
  const { call, startedItems } = setup();
  const result = await call('start_task', { cardId: '#131' });
  expect(result.isError).toBeUndefined();
  expect(startedItems).toEqual([{ item: { kind: 'card', id: '#131' }, opts: { noQuestions: false, brief: '' } }]);
});

it("start_task's description says a card marked as the owner's never starts from here, and it takes no parameter to say otherwise", () => {
  const { config } = setup().tools.get('start_task')!;
  expect(config.description).toContain("A card marked as the owner's never starts from here: the owner starts it from its ticket.");
  expect(config.description).not.toContain('names it');
  // An ownerNamedIt is no part of the input: the schema strips it.
  const parsed = config.inputSchema!.safeParse({ title: 'Decide', brief: '', cardId: 'c1', ownerNamedIt: true });
  expect(parsed.success).toBe(true);
  expect(parsed.data).toStrictEqual({ title: 'Decide', brief: '', cardId: 'c1' });
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

it("start_task never starts a card marked as the owner's, not even when it is told the owner named it", async () => {
  const refusal = "#119 is marked as the owner's; the owner starts it from its ticket with Start anyway";
  const { call, startedItems } = setup({
    startItem: (_item, opts) => (opts.ownersCard ? Promise.resolve(VIEW) : Promise.reject(new Error(refusal))),
  });

  const refused = await call('start_task', { title: 'Decide', brief: '', cardId: '#119' });
  expect(refused.isError).toBe(true);
  expect(refused.content).toEqual([{ type: 'text', text: refusal }]);

  const insisted = await call('start_task', { title: 'Decide', brief: 'The owner named it', cardId: '#119', ownerNamedIt: true });
  expect(insisted.isError).toBe(true);
  expect(insisted.content).toEqual([{ type: 'text', text: refusal }]);

  // What reaches the Todo service never carries the owner's choice: only the ticket's Start anyway sets it.
  expect(startedItems).toStrictEqual([
    { item: { kind: 'card', id: '#119' }, opts: { noQuestions: false, brief: '' } },
    { item: { kind: 'card', id: '#119' }, opts: { noQuestions: false, brief: 'The owner named it' } },
  ]);
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

it("sync_todo does not sync while the Todo panel waits for the owner's answer, and says which question it asks", async () => {
  const tools = setup({ ask: { kind: 'tools', connector: 'Tracker', tools: ['mcp__tracker__get_list'] } });
  const waiting = await tools.call('sync_todo');
  expect(waiting.isError).toBeUndefined();
  expect(waiting.content).toEqual([
    {
      type: 'text',
      text: 'The Todo panel is waiting for the owner: they must answer its question about tools before the list can sync.',
    },
  ]);
  expect(tools.calls).toEqual([]);

  const lists = setup({ ask: { kind: 'lists', lists: [{ name: 'Doing', board: 'Sprint', url: null }] } });
  const picking = await lists.call('sync_todo');
  expect(picking.content[0].text).toBe(
    'The Todo panel is waiting for the owner: they must answer its question about a list before the list can sync.',
  );
  expect(lists.calls).toEqual([]);
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

it('start_task on a put-back card continues its task', async () => {
  const continued = { id: 'task-7', title: 'Fix the gate', branch: 'worktree-fix-the-gate' } as TaskView;
  const { tools, call, startedItems } = setup({ startItem: async () => continued });
  expect(tools.get('start_task')!.config.description).toContain('A card whose task was put back or finished continues that task.');

  const result = await call('start_task', { cardId: '#7' });
  expect(startedItems).toEqual([{ item: { kind: 'card', id: '#7' }, opts: { noQuestions: false, brief: '' } }]);
  expect(json(result)).toStrictEqual({ taskId: 'task-7', title: 'Fix the gate', branch: 'worktree-fix-the-gate' });
});

const withSession = (sessionId: unknown) => ({ mcpReq: { _meta: { sessionId } } });

it('passes on the session id the context carries, whether it is the first argument or the second', async () => {
  const { tools, noted } = setup();
  await tools.get('list_sessions')!.handler(withSession('S1'));
  await tools.get('close_session')!.handler({ taskId: 'task-1' }, withSession('S2'));
  expect(noted).toEqual(['S1', 'S2']);
});

it('passes on nothing when there is no context, or its session id is not a string', async () => {
  const { tools, noted, call } = setup();
  await call('list_sessions');
  await call('close_session', { taskId: 'task-1' });
  await tools.get('list_sessions')!.handler(withSession(7));
  await tools.get('close_session')!.handler({ taskId: 'task-1' }, { mcpReq: {} });
  expect(noted).toEqual([]);
});
