import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentName, SyncModel, TaskCardRef, TaskView, TodoCard, TodoListRef, TodoSource } from '../../shared/types';
import type { AgentInUse, AgentSetting } from '../agents/agent';
import { ADAPTERS } from '../agents/adapters';
import { syncArgv, syncSettings } from '../agents/claudeSync';
import { projectKey } from '../tasks/naming';
import type { TaskService } from '../tasks/taskService';
import { NODE } from '../testing/lookups';
import { LONG_SYNC_MS, SYNC_STOPPED, SYNC_TIMEOUT_MS, syncPrompt, type runSync, type SyncStep } from './syncRun';
import { TodoService, type TodoServiceDeps } from './todoService';

const prompt = (step: SyncStep) => syncPrompt(step, ADAPTERS.claude.sync.words);
const CLAUDE: AgentInUse = { adapter: ADAPTERS.claude, bin: 'claude', setting: {} };

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENV = { PATH: '/usr/bin', HOME: '/home/owner' };
const NOW = 1_700_000_000_000;

const SOURCE: TodoSource = { kind: 'Tracker', board: 'Sprint', list: 'To do', url: 'https://tracker.example/b/sprint' };
const card = (id: string, over: Partial<TodoCard> = {}): TodoCard => ({
  id,
  number: `#${id}`,
  title: `Card ${id}`,
  description: `About ${id}`,
  labels: [],
  checklists: [],
  url: `https://tracker.example/c/${id}`,
  forOwner: false,
  urgent: false,
  ...over,
});
const CARDS = [card('c1', { labels: ['bug'], urgent: true }), card('c2')];

const TOOLS = ['mcp__tracker__get_list', 'mcp__tracker__get_card'];
const TOOLS_ANSWER = { kind: 'tools', connector: 'Tracker', readTools: TOOLS };
const CARDS_ANSWER = { kind: 'cards', source: SOURCE, cards: CARDS };
const DOING: TodoListRef = { name: 'Doing', board: 'Sprint', url: 'https://tracker.example/l/doing' };
const BACKLOG: TodoListRef = { name: 'Backlog', board: 'Sprint', url: null };
const LISTS_ANSWER = { kind: 'lists', lists: [BACKLOG, DOING] };

const TASK = { id: 'task-1', title: 'Card c1' } as TaskView;

/** The `-p` JSON that `claude` prints for a run that answered. */
const printed = (structured: unknown) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured });

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A call of the fake `run`: the test settles it when it wants the run to end. */
interface Call {
  options: Parameters<typeof runSync>[0];
  cancelled: boolean;
  answer(structured: unknown): void;
  print(stdout: string): void;
  /** Rejects as runSync does; a run that was stopped carries what it had printed as `stdout`. */
  fail(message: string, stdout?: string): void;
}

function setup(todoFile?: string, agent: AgentInUse = CLAUDE) {
  const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-todo-data-'));
  cleanup.push(dataDir);
  const projectDir = join(mkdtempSync(join(tmpdir(), 'mainframe-todo-project-')), 'Acme');
  cleanup.push(join(projectDir, '..'));
  mkdirSync(projectDir);

  const dir = join(dataDir, 'todo', projectKey(projectDir));
  const file = join(dir, 'todo.json');
  const settingsFile = join(dir, 'sync-settings.json');
  if (todoFile !== undefined) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, todoFile);
  }

  const calls: Call[] = [];
  const run: typeof runSync = (options) => {
    let resolve!: (stdout: string) => void;
    let reject!: (err: Error) => void;
    const done = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const call: Call = {
      options,
      cancelled: false,
      answer: (structured) => resolve(printed(structured)),
      print: resolve,
      fail: (message, stdout) => reject(Object.assign(new Error(message), stdout === undefined ? {} : { stdout })),
    };
    calls.push(call);
    return { done, cancel: () => (call.cancelled = true) };
  };

  const starts: Parameters<TaskService['start']>[0][] = [];
  const control = { startFails: null as Error | null };
  /** What the fake task service was asked, other than start, in order. */
  const taskCalls: unknown[][] = [];
  /** The tasks `list` returns; a test sets them. */
  const taskViews: TaskView[] = [];
  /** Settles the put-back session `putBackCard` waits on; a test may hold it. */
  const putBackHooks = {
    /** What `putBackCard` settles with: false when its session ended in a question or an error. */
    card: async (_taskId: string): Promise<boolean> => true,
    /** What `continueTask` does to the task's view: by default it is back on the board. */
    continued: (view: TaskView): TaskView => ({ ...view, place: null }),
  };
  const tasks: TodoServiceDeps['tasks'] = {
    start: async (req) => {
      starts.push(req);
      if (control.startFails) throw control.startFails;
      return TASK;
    },
    list: () => taskViews,
    continueTask: async (taskId) => {
      taskCalls.push(['continueTask', taskId]);
      return putBackHooks.continued(taskViews.find((v) => v.id === taskId)!);
    },
    putBackCard: async (taskId) => {
      taskCalls.push(['putBackCard', taskId]);
      return putBackHooks.card(taskId);
    },
    markPutBack: (taskId) => {
      taskCalls.push(['markPutBack', taskId]);
      const view = taskViews.find((v) => v.id === taskId)!;
      if (view.place !== null) return false;
      view.place = 'putBack';
      return true;
    },
    returnToBoard: (taskId, problem) => {
      taskCalls.push(problem === undefined ? ['returnToBoard', taskId] : ['returnToBoard', taskId, problem]);
    },
    // As the task service does: one Put back at a time, the mark shown on the task's view meanwhile.
    whilePuttingBack: async (taskId, run) => {
      const view = taskViews.find((v) => v.id === taskId)!;
      if (view.puttingBack) throw new Error(`${view.title} is being put back`);
      view.puttingBack = true;
      try {
        return await run();
      } finally {
        view.puttingBack = false;
      }
    },
  };

  const changes: ReturnType<TodoService['view']>[] = [];
  const warnings: string[] = [];
  // As AgentsInUse does: a saved setting is what the next `agent()` gives.
  const saves: [AgentName, Partial<AgentSetting>][] = [];
  let current = agent;
  let counter = 0;
  // The long-sync timers: a test fires one by hand.
  const timers: { ms: number; cleared: boolean; fire(): void }[] = [];
  const setTimer = (fn: () => void, ms: number) => {
    const timer = { ms, cleared: false, fire: fn };
    timers.push(timer);
    return () => (timer.cleared = true);
  };
  const make = () =>
    new TodoService({
      projectDir,
      dataDir,
      nodeBin: NODE,
      env: ENV,
      agent: () => current,
      saveAgentSetting: (name, patch) => {
        saves.push([name, patch]);
        current = { ...current, setting: { ...current.setting, ...patch } };
      },
      tasks,
      onChange: (view) => changes.push(view),
      run,
      newId: () => `id-${++counter}`,
      now: () => NOW,
      warn: (msg) => warnings.push(msg),
      setTimer,
    });

  const service = make();
  return {
    service,
    make,
    projectDir,
    calls,
    last: () => calls[calls.length - 1],
    starts,
    control,
    taskCalls,
    taskViews,
    putBackHooks,
    saves,
    changes,
    warnings,
    timers,
    file,
    settingsFile,
    todo: () => JSON.parse(readFileSync(file, 'utf8')),
    settings: () => JSON.parse(readFileSync(settingsFile, 'utf8')),
  };
}

type Setup = ReturnType<typeof setup>;

/** The first sync, the owner's confirmation, and the run that reads: ends with the list synced. */
async function synced(t: Setup, answer: unknown = CARDS_ANSWER) {
  const first = t.service.sync();
  t.last().answer(TOOLS_ANSWER);
  await first;
  const second = t.service.confirmTools();
  t.last().answer(answer);
  return second;
}

it("a first sync runs with no tools allowed, then asks the owner to confirm the connector's read tools", async () => {
  const t = setup();

  const pending = t.service.sync();

  expect(t.calls).toHaveLength(1);
  expect(t.last().options).toEqual({
    argv: syncArgv('claude', t.settingsFile),
    cwd: t.projectDir,
    env: ENV,
    input: prompt({ kind: 'discover' }),
    timeoutMs: SYNC_TIMEOUT_MS,
  });
  expect(t.settings().permissions).toBeUndefined();
  expect(readFileSync(t.settingsFile, 'utf8')).toBe(syncSettings(NODE, []));
  expect(t.service.view().syncing).toBe(true);

  t.last().answer(TOOLS_ANSWER);

  expect(await pending).toEqual({ ask: 'tools' });
  expect(t.service.view()).toEqual({
    source: null,
    syncedAt: null,
    cards: [],
    notes: [],
    syncing: false,
    longSync: false,
    error: null,
    ask: { kind: 'tools', connector: 'Tracker', tools: TOOLS },
    setUp: false,
  });
  // Nothing is kept until the owner confirms.
  expect(existsSync(t.file)).toBe(false);
  expect(t.changes.map((view) => view.syncing)).toEqual([true, false]);
});

it.each([
  [['Bash', 'mcp__tracker__get_list'], "The sync named tools that aren't a connector's: Bash"],
  [['mcp__tracker__get_list', 'Read', 'mcp__tracker'], "The sync named tools that aren't a connector's: Read, mcp__tracker"],
  [[], "The sync run answered something Mainframe didn't ask for"],
])("read tools that aren't all connector tools are refused whole (%j)", async (readTools, message) => {
  const t = setup();

  const pending = t.service.sync();
  t.last().answer({ kind: 'tools', connector: 'Tracker', readTools });

  expect(await pending).toEqual({ error: message });
  expect(t.service.view()).toMatchObject({ error: message, ask: null, setUp: false });
  await expect(t.service.confirmTools()).rejects.toThrow('Nothing to allow; sync again');
  expect(existsSync(t.file)).toBe(false);
});

it('confirming keeps the tools and syncs with exactly those allowed; the cards, the source and the time are kept', async () => {
  const t = setup();
  const first = t.service.sync();
  t.last().answer(TOOLS_ANSWER);
  await first;

  const confirming = t.service.confirmTools();

  expect(t.calls).toHaveLength(2);
  expect(t.last().options.input).toBe(prompt({ kind: 'read', list: null }));
  expect(t.settings().permissions).toEqual({ allow: TOOLS });
  expect(readFileSync(t.settingsFile, 'utf8')).toBe(syncSettings(NODE, TOOLS));
  expect(t.todo().readTools).toEqual({ connector: 'Tracker', tools: TOOLS, agent: 'claude' });
  expect(t.service.view()).toMatchObject({ syncing: true, ask: null, setUp: true });

  t.last().answer(CARDS_ANSWER);

  expect(await confirming).toEqual({ cards: 2 });
  const expected = {
    source: SOURCE,
    syncedAt: NOW,
    cards: CARDS,
    notes: [],
    syncing: false,
    longSync: false,
    error: null,
    ask: null,
    setUp: true,
  };
  expect(t.service.view()).toEqual(expected);
  expect(t.todo()).toEqual({
    version: 1,
    readTools: { connector: 'Tracker', tools: TOOLS, agent: 'claude' },
    source: SOURCE,
    syncedAt: NOW,
    cards: CARDS,
    notes: [],
  });

  // Another sync reads with the same tools; a restart finds the list, and no ask.
  void t.service.sync();
  expect(t.last().options.input).toBe(prompt({ kind: 'read', list: null }));
  expect(t.settings().permissions).toEqual({ allow: TOOLS });
  expect(t.make().view()).toEqual(expected);
});

it("confirmed tools saved without an agent are Claude Code's", async () => {
  const t = setup(JSON.stringify({ version: 1, readTools: { connector: 'Tracker', tools: TOOLS }, cards: [], notes: [] }));

  void t.service.sync();

  expect(t.last().options.input).toBe(prompt({ kind: 'read', list: null }));
  expect(readFileSync(t.settingsFile, 'utf8')).toBe(syncSettings(NODE, TOOLS));
});

it('a switch of agent syncs at discover again and keeps the cards and notes', async () => {
  const notes = [{ id: 'n1', title: 'Call the bank', text: '' }];
  const record = {
    version: 1,
    readTools: { connector: 'Tracker', tools: TOOLS, agent: 'claude' },
    pickedList: DOING,
    source: SOURCE,
    syncedAt: NOW,
    cards: CARDS,
    notes,
  };
  const t = setup(JSON.stringify(record), { adapter: { ...ADAPTERS.claude, name: 'opencode' }, bin: 'claude', setting: {} });

  void t.service.sync();

  expect(t.last().options.input).toBe(prompt({ kind: 'discover' }));
  expect(readFileSync(t.settingsFile, 'utf8')).toBe(syncSettings(NODE, []));
  expect(t.service.view().cards).toEqual(CARDS);
  expect(t.service.view().notes).toEqual(notes);
  expect(t.todo()).toEqual(record);
});

it('confirming saves the agent with the tools', async () => {
  const t = setup();
  const first = t.service.sync();
  t.last().answer(TOOLS_ANSWER);
  await first;

  void t.service.confirmTools();

  expect(t.todo().readTools.agent).toBe('claude');
});

it('several candidate lists: the one picked is kept and read', async () => {
  const t = setup();
  await synced(t, LISTS_ANSWER);
  expect(t.service.view().ask).toEqual({ kind: 'lists', lists: [BACKLOG, DOING] });
  expect(t.todo().pickedList).toBeUndefined();
  // A pick that is not on the list is refused, and the choices stay.
  await expect(t.service.pickList(2)).rejects.toThrow('No such list; sync again');
  expect(t.service.view().ask).not.toBeNull();

  const picking = t.service.pickList(1);

  expect(t.last().options.input).toBe(prompt({ kind: 'read', list: DOING }));
  expect(t.last().options.input).toContain('Doing');
  expect(t.settings().permissions).toEqual({ allow: TOOLS });
  expect(t.todo().pickedList).toEqual(DOING);
  expect(t.service.view()).toMatchObject({ ask: null, setUp: true });

  t.last().answer(CARDS_ANSWER);

  expect(await picking).toEqual({ cards: 2 });
  // The answer of cards keeps the tools and the picked list; the next sync reads that list again.
  expect(t.todo()).toMatchObject({ readTools: { connector: 'Tracker', tools: TOOLS }, pickedList: DOING });
  void t.service.sync();
  expect(t.last().options.input).toBe(prompt({ kind: 'read', list: DOING }));
});

const MODELS: SyncModel[] = [
  { id: 'prov/cheap', name: 'Cheap', status: 'active', price: { input: 0.11, output: 0.55 } },
  { id: 'prov/dear', name: 'Dear', status: 'active', price: { input: 2.4, output: 12 } },
  { id: 'prov/unknown', name: 'Unknown', status: 'active', price: null },
];
/** OpenCode, with `models` answering as the test says. */
const opencode = (models: () => Promise<SyncModel[]>, setting: AgentSetting = {}): AgentInUse => ({
  adapter: { ...ADAPTERS.opencode, sync: { ...ADAPTERS.opencode.sync, models } },
  bin: 'opencode',
  setting,
});

it('a first OpenCode sync asks for a model and runs nothing', async () => {
  const t = setup(undefined, opencode(async () => MODELS));

  expect(await t.service.sync()).toEqual({ ask: 'model' });

  expect(t.service.view()).toMatchObject({ syncing: false, error: null, ask: { kind: 'model', models: MODELS, suggested: 'prov/cheap' } });
  expect(t.calls).toHaveLength(0);
});

it('a saved model that is gone asks again', async () => {
  const t = setup(undefined, opencode(async () => MODELS, { syncModel: 'gone/model' }));

  expect(await t.service.sync()).toEqual({ ask: 'model' });

  expect(t.service.view().ask).toEqual({ kind: 'model', models: MODELS, suggested: 'prov/cheap' });
  expect(t.calls).toHaveLength(0);
});

it('picking a model saves it and syncs with it', async () => {
  const t = setup(undefined, opencode(async () => MODELS));
  await t.service.sync();
  await expect(t.service.pickModel('other/model')).rejects.toThrow('No such model; sync again');
  expect(t.saves).toEqual([]);

  const picking = t.service.pickModel('prov/dear');
  await flush();

  expect(t.saves).toEqual([['opencode', { syncModel: 'prov/dear' }]]);
  expect(t.calls).toHaveLength(1);
  expect(t.last().options.argv.slice(-2)).toEqual(['-m', 'prov/dear']);
  expect(t.service.view()).toMatchObject({ syncing: true, ask: null });
  t.last().fail('opencode exited with code 1');
  expect(await picking).toEqual({ error: 'opencode exited with code 1' });
  // Once picked, the next sync asks nothing.
  void t.service.sync();
  await flush();
  expect(t.calls).toHaveLength(2);
});

it('a model list that fails says why', async () => {
  const t = setup(undefined, opencode(() => Promise.reject(new Error('OpenCode could not list its models: no providers'))));

  expect(await t.service.sync()).toEqual({ error: 'OpenCode could not list its models: no providers' });

  expect(t.service.view()).toMatchObject({ syncing: false, ask: null, error: 'OpenCode could not list its models: no providers' });
  expect(t.calls).toHaveLength(0);
});

it('a second Sync while the models are listed joins it, and Stop ends it', async () => {
  let listed!: (models: SyncModel[]) => void;
  const t = setup(undefined, opencode(() => new Promise((resolve) => (listed = resolve)), { syncModel: 'prov/cheap' }));

  const first = t.service.sync();
  expect(t.service.sync()).toBe(first);
  expect(t.service.view().syncing).toBe(true);
  t.service.cancel();
  listed(MODELS);

  expect(await first).toEqual({ error: SYNC_STOPPED });
  await flush();
  expect(t.calls).toHaveLength(0);
  expect(t.service.view()).toMatchObject({ syncing: false, ask: null });
});

it('a Claude sync asks for no model', async () => {
  const t = setup();

  const pending = t.service.sync();

  expect(t.calls).toHaveLength(1);
  t.last().answer(TOOLS_ANSWER);
  expect(await pending).toEqual({ ask: 'tools' });
  expect(t.saves).toEqual([]);
});

it('confirming or picking with nothing to confirm or pick is refused', async () => {
  const t = setup();

  await expect(t.service.confirmTools()).rejects.toThrow('Nothing to allow; sync again');
  await expect(t.service.pickList(0)).rejects.toThrow('No such list; sync again');
  // Tools to confirm are not lists to pick from.
  const first = t.service.sync();
  t.last().answer(TOOLS_ANSWER);
  await first;
  await expect(t.service.pickList(0)).rejects.toThrow('No such list; sync again');
  expect(t.calls).toHaveLength(1);
  expect(existsSync(t.file)).toBe(false);
});

it('a run that fails or answers none leaves the list as it was and says why', async () => {
  const t = setup();
  const first = t.service.sync();
  t.last().answer({ kind: 'none', message: 'No connector holds a to-do list' });
  expect(await first).toEqual({ error: 'No connector holds a to-do list' });
  expect(t.service.view()).toMatchObject({ error: 'No connector holds a to-do list', syncing: false, ask: null });

  await synced(t);
  const kept = readFileSync(t.file, 'utf8');
  const keptView = t.service.view();

  const failing = t.service.sync();
  t.last().fail('claude exited with code 1');
  expect(await failing).toEqual({ error: 'claude exited with code 1' });
  expect(t.service.view()).toEqual({ ...keptView, error: 'claude exited with code 1' });

  const none = t.service.sync();
  t.last().answer({ kind: 'none', message: "Can't read the list" });
  expect(await none).toEqual({ error: "Can't read the list" });
  expect(t.service.view()).toEqual({ ...keptView, error: "Can't read the list" });

  const unreadable = t.service.sync();
  t.last().print('not json');
  expect(await unreadable).toEqual({ error: "The sync run printed something Mainframe can't read" });
  expect(t.service.view()).toEqual({ ...keptView, error: "The sync run printed something Mainframe can't read" });
  expect(readFileSync(t.file, 'utf8')).toBe(kept);

  // The next good sync clears the error.
  const again = t.service.sync();
  t.last().answer(CARDS_ANSWER);
  expect(await again).toEqual({ cards: 2 });
  expect(t.service.view().error).toBeNull();
});

it.each([
  ['the first sync', 'cards', CARDS_ANSWER],
  ['the first sync', 'lists', LISTS_ANSWER],
  ['a sync with tools', 'tools', TOOLS_ANSWER],
  ['a sync with tools', 'cards without a source', { kind: 'cards', cards: CARDS }],
  ['a sync with tools', 'lists with none listed', { kind: 'lists', lists: [] }],
])('an answer of the wrong kind for the step is an error (%s answered %s)', async (step, _kind, answer) => {
  const t = setup();
  if (step === 'a sync with tools') await synced(t);
  const kept = t.service.view();

  const pending = t.service.sync();
  t.last().answer(answer);

  const message = "The sync run answered something Mainframe didn't ask for";
  expect(await pending).toEqual({ error: message });
  expect(t.service.view()).toEqual({ ...kept, error: message });
});

it.each([
  ['an empty id', [card('c1'), card('')], 'The sync gave a card no id; sync again'],
  ['an id of blanks', [card('   '), card('c2')], 'The sync gave a card no id; sync again'],
  ['a repeated id', [card('c1'), card('c2'), card('c1', { title: 'Again' })], 'The sync gave two cards the id c1; sync again'],
  ['two ids repeated', [card('c1'), card('c2'), card('c2'), card('c1')], 'The sync gave two cards the id c2; sync again'],
])('a cards answer with %s is refused whole, and the earlier cards stay', async (_what, cards, message) => {
  const t = setup();
  await synced(t);
  const kept = readFileSync(t.file, 'utf8');
  const keptView = t.service.view();

  const pending = t.service.sync();
  t.last().answer({ kind: 'cards', source: SOURCE, cards });

  expect(await pending).toEqual({ error: message });
  expect(t.service.view()).toEqual({ ...keptView, error: message });
  expect(t.service.view().cards).toEqual(CARDS);
  expect(readFileSync(t.file, 'utf8')).toBe(kept);
});

it("a sync whose settings can't be written says why in the view, and runs nothing", async () => {
  const t = setup();
  mkdirSync(t.settingsFile, { recursive: true });
  await expect(t.service.sync()).resolves.toEqual({ error: expect.stringMatching(/^Could not write the sync's settings: EISDIR/) });
  expect(t.calls).toHaveLength(0);
  expect(t.changes.at(-1)).toMatchObject({ syncing: false, error: expect.stringMatching(/^Could not write the sync's settings/) });
});

it('afterRun gets what each run printed', async () => {
  const afterRun = vi.fn();
  const t = setup(undefined, { ...CLAUDE, adapter: { ...ADAPTERS.claude, sync: { ...ADAPTERS.claude.sync, afterRun } } });
  const dir = dirname(t.settingsFile);

  await synced(t);
  const unreadable = t.service.sync();
  t.last().print('not json');
  await unreadable;
  const failed = t.service.sync();
  t.last().fail('claude exited with code 1');
  await failed;

  expect(afterRun.mock.calls).toEqual([
    [{ bin: 'claude', dir, env: ENV, stdout: printed(TOOLS_ANSWER) }],
    [{ bin: 'claude', dir, env: ENV, stdout: printed(CARDS_ANSWER) }],
    [{ bin: 'claude', dir, env: ENV, stdout: 'not json' }],
  ]);
});

it('afterRun gets what a stopped or timed-out run had printed', async () => {
  const afterRun = vi.fn();
  const t = setup(undefined, { ...CLAUDE, adapter: { ...ADAPTERS.claude, sync: { ...ADAPTERS.claude.sync, afterRun } } });
  const dir = dirname(t.settingsFile);

  const pending = t.service.sync();
  t.service.cancel();
  t.last().fail(SYNC_STOPPED, 'the first event');
  await pending;

  expect(afterRun.mock.calls).toEqual([[{ bin: 'claude', dir, env: ENV, stdout: 'the first event' }]]);
});

it('a discover that finds no connector says where to set it up', async () => {
  const none = { kind: 'none', message: 'No connector holds a to-do list.' };
  const { noConnector } = ADAPTERS.opencode.sync.words;
  const opencodeWords: AgentInUse = {
    ...CLAUDE,
    adapter: { ...ADAPTERS.claude, sync: { ...ADAPTERS.claude.sync, words: ADAPTERS.opencode.sync.words } },
  };
  const t = setup(undefined, opencodeWords);
  const first = t.service.sync();
  t.last().answer(none);
  expect(await first).toEqual({ error: `No connector holds a to-do list. ${noConnector}` });

  const c = setup();
  const second = c.service.sync();
  c.last().answer(none);
  expect(await second).toEqual({ error: 'No connector holds a to-do list.' });
});

it('a second Sync while one runs joins it', async () => {
  const t = setup();

  const first = t.service.sync();
  const second = t.service.sync();

  expect(second).toBe(first);
  expect(t.calls).toHaveLength(1);
  t.last().answer(TOOLS_ANSWER);
  expect(await second).toEqual({ ask: 'tools' });
  expect(await first).toEqual({ ask: 'tools' });
  expect(t.calls).toHaveLength(1);

  // Once it has ended, the next one runs again.
  void t.service.sync();
  expect(t.calls).toHaveLength(2);
});

it('Set up again forgets the tools and the list and keeps the cards and notes', async () => {
  const t = setup();
  await synced(t, LISTS_ANSWER);
  const picking = t.service.pickList(0);
  t.last().answer(CARDS_ANSWER);
  await picking;
  t.service.saveNote({ title: 'Call the bank', text: '' });
  expect(t.service.view().setUp).toBe(true);

  t.service.resetSource();

  expect(t.service.view()).toMatchObject({ setUp: false, source: SOURCE, syncedAt: NOW, cards: CARDS, notes: [{ title: 'Call the bank' }] });
  expect(t.todo().readTools).toBeUndefined();
  expect(t.todo().pickedList).toBeUndefined();
  expect(t.todo()).toMatchObject({ source: SOURCE, cards: CARDS, notes: [{ title: 'Call the bank' }] });

  // The next sync begins again: with nothing allowed.
  void t.service.sync();
  expect(t.last().options.input).toBe(prompt({ kind: 'discover' }));
  expect(t.settings().permissions).toBeUndefined();
});

it('Set up again drops an ask that was waiting, and stops a sync that is running', async () => {
  const t = setup();
  await synced(t, LISTS_ANSWER);
  expect(t.service.view().ask).not.toBeNull();

  t.service.resetSource();
  expect(t.service.view().ask).toBeNull();

  const running = t.service.sync();
  t.service.resetSource();
  expect(t.last().cancelled).toBe(true);
  expect(await running).toEqual({ error: 'The sync was stopped' });
  expect(t.service.view().syncing).toBe(false);
});

it('cancel stops the run, and an answer that comes after changes nothing', async () => {
  const t = setup();
  await synced(t);
  const kept = readFileSync(t.file, 'utf8');
  const keptView = t.service.view();
  const pending = t.service.sync();
  const run = t.last();
  expect(t.service.view().syncing).toBe(true);

  t.service.cancel();

  expect(run.cancelled).toBe(true);
  expect(await pending).toEqual({ error: 'The sync was stopped' });
  expect(t.service.view()).toEqual(keptView);
  const changesAtCancel = t.changes.length;

  // The run answers after all, with other cards: none of it is kept.
  run.answer({ kind: 'cards', source: SOURCE, cards: [card('c9')] });
  await flush();

  expect(t.service.view()).toEqual(keptView);
  expect(readFileSync(t.file, 'utf8')).toBe(kept);
  expect(t.changes).toHaveLength(changesAtCancel);
});

it('close stops a running sync, and no sync starts after it, whoever asks', async () => {
  const t = setup();
  await synced(t, LISTS_ANSWER);
  const running = t.service.sync();
  const run = t.last();
  const launched = t.calls.length;

  t.service.close();

  expect(run.cancelled).toBe(true);
  expect(await running).toEqual({ error: 'The sync was stopped' });
  expect(t.service.view().syncing).toBe(false);

  await expect(t.service.sync()).rejects.toThrow('The project is closing');
  expect(t.calls).toHaveLength(launched);
  expect(t.service.view().syncing).toBe(false);

  // Whatever the stopped run answers later, and a second close, change nothing.
  run.answer({ kind: 'cards', source: SOURCE, cards: [card('c9')] });
  await flush();
  t.service.close();
  expect(t.service.view().cards).toEqual([]);
});

it('an ask that was waiting cannot be answered once the project is closing: nothing launches', async () => {
  const tools = setup();
  const first = tools.service.sync();
  tools.last().answer(TOOLS_ANSWER);
  await first;
  tools.service.close();
  await expect(tools.service.confirmTools()).rejects.toThrow('The project is closing');
  expect(tools.calls).toHaveLength(1);

  const lists = setup();
  await synced(lists, LISTS_ANSWER);
  const launched = lists.calls.length;
  lists.service.close();
  await expect(lists.service.pickList(1)).rejects.toThrow('The project is closing');
  expect(lists.calls).toHaveLength(launched);
});

it('an answer from a stopped run does not touch the sync that replaced it', async () => {
  const t = setup();
  await synced(t);
  const stopped = t.service.sync();
  const old = t.last();
  t.service.cancel();
  await stopped;

  const next = t.service.sync();
  const current = t.last();
  expect(current).not.toBe(old);

  old.fail('The sync was stopped');
  await flush();
  expect(t.service.view().syncing).toBe(true);
  expect(t.service.view().error).toBeNull();

  current.answer({ kind: 'cards', source: SOURCE, cards: [card('c3')] });
  expect(await next).toEqual({ cards: 1 });
  expect(t.service.view().cards).toEqual([card('c3')]);
});

it('notes are added, edited and deleted, kept in todo.json, and a sync leaves them', async () => {
  const t = setup();

  const bank = t.service.saveNote({ title: '  Call the bank ', text: 'About the loan' });
  const other = t.service.saveNote({ title: 'Second', text: '' });

  expect(bank).toEqual({ id: 'id-1', title: 'Call the bank', text: 'About the loan' });
  expect(t.service.view().notes).toEqual([bank, other]);
  expect(t.changes).toHaveLength(2);

  const edited = t.service.saveNote({ id: bank.id, title: 'Call the bank today', text: 'About the loan, Monday' });

  expect(edited).toEqual({ id: 'id-1', title: 'Call the bank today', text: 'About the loan, Monday' });
  expect(t.service.view().notes).toEqual([edited, other]);
  expect(t.todo().notes).toEqual([edited, other]);

  await synced(t);
  expect(t.service.view().notes).toEqual([edited, other]);
  expect(t.todo().notes).toEqual([edited, other]);

  t.service.deleteNote(other.id);

  expect(t.service.view().notes).toEqual([edited]);
  expect(t.todo().notes).toEqual([edited]);
  expect(t.make().view().notes).toEqual([edited]);

  const changesAfterDelete = t.changes.length;
  t.service.deleteNote('nope');
  expect(t.changes).toHaveLength(changesAfterDelete);

  expect(() => t.service.saveNote({ title: '   ', text: 'No title' })).toThrow('A todo needs a title');
  expect(() => t.service.saveNote({ id: 'nope', title: 'Title', text: '' })).toThrow('No todo nope');
  expect(t.service.view().notes).toEqual([edited]);
});

it('a card starts a task with its title, the brief and its card', async () => {
  const t = setup();
  await synced(t);
  const kept = t.service.view();

  const started = await t.service.startItem({ kind: 'card', id: 'c2' }, { noQuestions: true, brief: 'Do the second thing' });

  expect(started).toBe(TASK);
  const second: TaskCardRef = {
    sourceKind: 'Tracker',
    id: 'c2',
    number: '#c2',
    url: 'https://tracker.example/c/c2',
    labels: [],
    position: 1,
    urgent: false,
  };
  expect(t.starts).toStrictEqual([{ title: 'Card c2', description: 'Do the second thing', noQuestions: true, card: second }]);

  // Without a brief the task has no description; the card's place is its index at the time.
  await t.service.startItem({ kind: 'card', id: 'c1' }, { noQuestions: false });
  expect(t.starts[1]).toStrictEqual({
    title: 'Card c1',
    description: '',
    noQuestions: false,
    card: { sourceKind: 'Tracker', id: 'c1', number: '#c1', url: 'https://tracker.example/c/c1', labels: ['bug'], position: 0, urgent: true },
  });
  // The list is the sync's: starting a task leaves it alone.
  expect(t.service.view()).toEqual(kept);

  // What the task service refuses reaches the caller.
  t.control.startFails = new Error('#c1 is already open as the task "Card c1"');
  await expect(t.service.startItem({ kind: 'card', id: 'c1' }, { noQuestions: false })).rejects.toThrow('#c1 is already open');
});

it("a card also starts by its number as the list shows it, with or without the #, as by its id", async () => {
  const t = setup();
  const cards = [card('x9f', { number: '#131' }), card('x1a', { number: '7' }), card('x2b', { number: null })];
  await synced(t, { ...CARDS_ANSWER, cards });
  const ref = (id: string, number: string | null, position: number): TaskCardRef => ({
    sourceKind: 'Tracker',
    id,
    number,
    url: `https://tracker.example/c/${id}`,
    labels: [],
    position,
    urgent: false,
  });

  for (const asked of ['x9f', '#131', '131']) await t.service.startItem({ kind: 'card', id: asked }, { noQuestions: false });
  expect(t.starts.map((s) => s.card)).toStrictEqual([ref('x9f', '#131', 0), ref('x9f', '#131', 0), ref('x9f', '#131', 0)]);

  // A number the service shows without the #: either way finds it.
  for (const asked of ['7', '#7']) await t.service.startItem({ kind: 'card', id: asked }, { noQuestions: false });
  expect(t.starts.slice(3).map((s) => s.card)).toStrictEqual([ref('x1a', '7', 1), ref('x1a', '7', 1)]);

  // Only one leading # is dropped, and a card without a number has none to match.
  for (const asked of ['#999', '##131', 'null', '']) {
    await expect(t.service.startItem({ kind: 'card', id: asked }, { noQuestions: false })).rejects.toThrow(
      `No card ${asked} in the synced list; sync it again`,
    );
  }
  expect(t.starts).toHaveLength(5);
});

it("a card whose id is asked for beats an earlier card whose number is the same", async () => {
  const t = setup();
  // A's number is what B's id spells; the id is the exact name, so B it is.
  const cards = [card('901', { number: '#42', title: 'Card A' }), card('42', { number: '#7', title: 'Card B' })];
  await synced(t, { ...CARDS_ANSWER, cards });

  await t.service.startItem({ kind: 'card', id: '42' }, { noQuestions: false });
  await t.service.startItem({ kind: 'card', id: '#42' }, { noQuestions: false });

  expect(t.starts.map((s) => [s.title, s.card?.id, s.card?.position])).toStrictEqual([
    ['Card B', '42', 1],
    // With no id of that name, the number is looked up.
    ['Card A', '901', 0],
  ]);
});

it("a card marked as the owner's is not started unless the owner chose it, whether asked for by its id or by its number, and says so", async () => {
  const t = setup();
  const cards = [card('c7', { number: '#7', forOwner: true }), card('c8', { number: null, title: 'Decide', forOwner: true })];
  await synced(t, { ...CARDS_ANSWER, cards });
  const refusal = (name: string) => `${name} is marked as the owner's; the owner starts it from its ticket with Start anyway`;

  await expect(t.service.startItem({ kind: 'card', id: 'c7' }, { noQuestions: false })).rejects.toThrow(refusal('#7'));
  await expect(t.service.startItem({ kind: 'card', id: '7' }, { noQuestions: false })).rejects.toThrow(refusal('#7'));
  // Without a number, the title stands in.
  await expect(t.service.startItem({ kind: 'card', id: 'c8' }, { noQuestions: false })).rejects.toThrow(refusal('Decide'));
  // Said not to be, it is refused as when it is not said at all.
  await expect(t.service.startItem({ kind: 'card', id: 'c7' }, { noQuestions: false, ownersCard: false })).rejects.toThrow(refusal('#7'));
  expect(t.starts).toEqual([]);
});

it("a card for the owner starts when the owner chose it, with the card ref any card has", async () => {
  const t = setup();
  const cards = [card('c7', { number: '#7', forOwner: true, labels: ['Decision'], urgent: true }), card('c9', { number: '#9', labels: ['Decision'], urgent: true })];
  await synced(t, { ...CARDS_ANSWER, cards });

  const started = await t.service.startItem({ kind: 'card', id: 'c7' }, { noQuestions: true, brief: 'Take it from here', ownersCard: true });
  await t.service.startItem({ kind: 'card', id: '9' }, { noQuestions: true, brief: 'Take it from here' });

  expect(started).toBe(TASK);
  expect(t.starts).toStrictEqual([
    {
      title: 'Card c7',
      description: 'Take it from here',
      noQuestions: true,
      card: { sourceKind: 'Tracker', id: 'c7', number: '#7', url: 'https://tracker.example/c/c7', labels: ['Decision'], position: 0, urgent: true },
    },
    {
      title: 'Card c9',
      description: 'Take it from here',
      noQuestions: true,
      card: { sourceKind: 'Tracker', id: 'c9', number: '#9', url: 'https://tracker.example/c/c9', labels: ['Decision'], position: 1, urgent: true },
    },
  ]);
  // By its number too.
  await t.service.startItem({ kind: 'card', id: '#7' }, { noQuestions: false, ownersCard: true });
  expect(t.starts[2].card?.id).toBe('c7');
});

it("the owner's choice changes nothing for a card for an agent or a note", async () => {
  const t = setup();
  await synced(t);
  const note = t.service.saveNote({ title: 'Fix the gate', text: 'It sticks' });
  const other = t.service.saveNote({ title: 'Oil the hinge', text: 'It squeaks' });

  await t.service.startItem({ kind: 'card', id: 'c2' }, { noQuestions: false });
  await t.service.startItem({ kind: 'card', id: 'c2' }, { noQuestions: false, ownersCard: true });
  expect(t.starts[1]).toStrictEqual(t.starts[0]);

  await t.service.startItem({ kind: 'note', id: note.id }, { noQuestions: false });
  await t.service.startItem({ kind: 'note', id: other.id }, { noQuestions: false, ownersCard: true });
  expect(t.starts.slice(2)).toStrictEqual([
    { title: 'Fix the gate', description: 'It sticks', noQuestions: false },
    { title: 'Oil the hinge', description: 'It squeaks', noQuestions: false },
  ]);
});

it('a note starts a task with its title and text, then leaves the list; a start that fails keeps it', async () => {
  const t = setup();
  const keep = t.service.saveNote({ title: 'Keep me', text: 'Stays' });
  const note = t.service.saveNote({ title: 'Fix the gate', text: 'It sticks on Tuesdays' });

  t.control.startFails = new Error('Could not start');
  await expect(t.service.startItem({ kind: 'note', id: note.id }, { noQuestions: false })).rejects.toThrow('Could not start');
  expect(t.service.view().notes).toEqual([keep, note]);
  expect(t.todo().notes).toEqual([keep, note]);

  t.control.startFails = null;
  const started = await t.service.startItem({ kind: 'note', id: note.id }, { noQuestions: true, brief: 'Not used for a note' });

  expect(started).toBe(TASK);
  expect(t.starts[1]).toStrictEqual({ title: 'Fix the gate', description: 'It sticks on Tuesdays', noQuestions: true });
  expect(t.service.view().notes).toEqual([keep]);
  expect(t.todo().notes).toEqual([keep]);
});

it('an unknown card or note is refused, saying so', async () => {
  const t = setup();
  await synced(t);

  await expect(t.service.startItem({ kind: 'card', id: 'zz' }, { noQuestions: false })).rejects.toThrow(
    'No card zz in the synced list; sync it again',
  );
  await expect(t.service.startItem({ kind: 'note', id: 'zz' }, { noQuestions: false })).rejects.toThrow('No todo zz');
  // A card's id is not a note's.
  await expect(t.service.startItem({ kind: 'note', id: 'c1' }, { noQuestions: false })).rejects.toThrow('No todo c1');
  expect(t.starts).toEqual([]);
});

it('a Todo file from a newer Mainframe: the panel says so, and nothing syncs or saves', async () => {
  const newer = JSON.stringify({ version: 2, cards: [{ id: 'c1' }], notes: [{ id: 'n1' }], extra: true });
  const t = setup(newer);
  const message = t.service.view().error!;

  expect(message).toContain('newer Mainframe');
  expect(t.service.view()).toEqual({ source: null, syncedAt: null, cards: [], notes: [], syncing: false, longSync: false, error: message, ask: null, setUp: false });

  await expect(t.service.sync()).rejects.toThrow(message);
  expect(() => t.service.saveNote({ title: 'A note', text: '' })).toThrow(message);
  expect(() => t.service.deleteNote('n1')).toThrow(message);
  await expect(t.service.startItem({ kind: 'note', id: 'n1' }, { noQuestions: false })).rejects.toThrow(message);
  expect(() => t.service.resetSource()).toThrow(message);

  expect(t.calls).toEqual([]);
  expect(t.starts).toEqual([]);
  expect(t.service.view().error).toBe(message);
  expect(readFileSync(t.file, 'utf8')).toBe(newer);
  expect(t.warnings).toEqual([]);
});

// The long-sync line, on both agents.
const AGENTS: [string, () => AgentInUse][] = [
  ['Claude', () => CLAUDE],
  ['OpenCode', () => opencode(async () => MODELS, { syncModel: 'prov/cheap' })],
];

it.each(AGENTS)('after 2 minutes the view says the sync is still running (%s)', async (_name, agent) => {
  const t = setup(undefined, agent());
  void t.service.sync();
  await flush();

  expect(t.timers).toHaveLength(1);
  expect(t.timers[0].ms).toBe(120_000);
  expect(t.timers[0].ms).toBe(LONG_SYNC_MS);
  expect(t.service.view().longSync).toBe(false);
  t.timers[0].fire();

  expect(t.service.view()).toMatchObject({ syncing: true, longSync: true });
  expect(t.changes.at(-1)!.longSync).toBe(true);
});

it('Keep going hides it for the rest of that run', async () => {
  const t = setup();
  void t.service.sync();
  t.timers[0].fire();

  t.service.keepSyncing();

  expect(t.service.view()).toMatchObject({ syncing: true, longSync: false });
  expect(t.changes.at(-1)!.longSync).toBe(false);
});

it('a run that ends first never shows it, and clears its timer', async () => {
  const t = setup();
  const pending = t.service.sync();
  t.last().answer(TOOLS_ANSWER);
  await pending;

  expect(t.timers[0].cleared).toBe(true);
  t.timers[0].fire();
  expect(t.service.view().longSync).toBe(false);
  expect(t.changes.some((v) => v.longSync)).toBe(false);
});

it('Stop clears it', () => {
  const t = setup();
  void t.service.sync();
  t.timers[0].fire();
  expect(t.service.view().longSync).toBe(true);

  t.service.cancel();

  expect(t.timers[0].cleared).toBe(true);
  expect(t.service.view()).toMatchObject({ syncing: false, longSync: false });
});

it('the next run starts without it, and an earlier run\'s timer cannot show it', async () => {
  const t = setup();
  void t.service.sync();
  t.timers[0].fire();
  t.service.cancel();

  void t.service.sync();
  expect(t.timers).toHaveLength(2);
  expect(t.service.view()).toMatchObject({ syncing: true, longSync: false });
  t.timers[0].fire();
  expect(t.service.view().longSync).toBe(false);
  t.timers[1].fire();
  expect(t.service.view().longSync).toBe(true);
});

const cardRef = (id: string): TaskCardRef => ({
  sourceKind: 'Tracker', id, number: `#${id}`, url: `https://tracker.example/c/${id}`, labels: [], position: 0, urgent: false,
});
/** A Paused task on the board, as the task service lists it. */
const paused = (over: Partial<TaskView> = {}): TaskView =>
  ({ id: 'task-7', title: 'Fix the gate', description: 'It sticks', place: null, session: null, closedAt: 900, card: null, ...over }) as TaskView;
const PUT_BACK_FAILED = 'Put back: the card is not on the to-do list';

it("putBack of a note's task adds the note back with the task's id and marks it put back", async () => {
  const t = setup();
  t.taskViews.push(paused());

  await t.service.putBack('task-7');

  const note = { id: 'id-1', title: 'Fix the gate', text: 'It sticks', taskId: 'task-7' };
  expect(t.service.view().notes).toEqual([note]);
  expect(t.make().view().notes).toEqual([note]);
  expect(t.taskCalls).toEqual([['markPutBack', 'task-7']]);
  // An edit from the panel, which knows nothing of the task, keeps the link.
  t.service.saveNote({ id: 'id-1', title: 'Fix the gate today', text: 'It sticks' });
  expect(t.todo().notes).toEqual([{ ...note, title: 'Fix the gate today' }]);
});

it('putBack refuses a task that is not Paused on the board, and adds no note', async () => {
  const t = setup();
  t.taskViews.push(paused({ session: { id: 's1', startedWithPrompt: false } }), paused({ id: 'task-8', place: 'finished' }));

  await expect(t.service.putBack('task-7')).rejects.toThrow('Close Fix the gate before putting it back');
  await expect(t.service.putBack('task-8')).rejects.toThrow('Task Fix the gate is not paused on the board, so it cannot be put back');
  expect(t.service.view().notes).toEqual([]);
  expect(t.taskCalls).toEqual([]);
});

it("putBack of a card's task marks it put back when the next sync lists the card", async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ card: cardRef('c1') }));
  const runs = t.calls.length;

  const putting = t.service.putBack('task-7');
  await flush();
  expect(t.calls).toHaveLength(runs + 1);
  expect(t.taskCalls).toEqual([['putBackCard', 'task-7']]);
  t.last().answer(CARDS_ANSWER);
  await putting;

  expect(t.taskCalls).toEqual([['putBackCard', 'task-7'], ['markPutBack', 'task-7']]);
});

it("putBack of a card's task returns it to the board with the problem when the sync doesn't list the card", async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ card: cardRef('c1') }));

  const missing = t.service.putBack('task-7');
  await flush();
  t.last().answer({ ...CARDS_ANSWER, cards: [card('c2')] });
  await missing;
  expect(t.taskCalls.at(-1)).toEqual(['returnToBoard', 'task-7', PUT_BACK_FAILED]);

  // A sync that fails says the same.
  const failed = t.service.putBack('task-7');
  await flush();
  t.last().fail('The run timed out');
  await failed;
  expect(t.taskCalls.at(-1)).toEqual(['returnToBoard', 'task-7', PUT_BACK_FAILED]);
  expect(t.taskCalls.filter((c) => c[0] === 'markPutBack')).toEqual([]);
});

it('a put-back sync waits for a sync already running, and syncs again', async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ card: cardRef('c1') }));
  const held = { release: () => {} };
  t.putBackHooks.card = () => new Promise<boolean>((resolve) => (held.release = () => resolve(true)));

  const putting = t.service.putBack('task-7');
  // The owner pressed Sync while the agent was moving the card.
  void t.service.sync();
  const before = t.last();
  held.release();
  await flush();
  before.answer({ ...CARDS_ANSWER, cards: [card('c2')] });
  await flush();
  expect(t.last()).not.toBe(before);
  t.last().answer(CARDS_ANSWER);
  await putting;
  expect(t.taskCalls.at(-1)).toEqual(['markPutBack', 'task-7']);
});

it('starting a put-back note continues its task and removes the note', async () => {
  const t = setup();
  t.taskViews.push(paused({ place: 'putBack' }));
  const note = t.service.saveNote({ title: 'Fix the gate', text: 'It sticks', taskId: 'task-7' });

  const continued = await t.service.startItem({ kind: 'note', id: note.id }, { noQuestions: false });

  expect(continued.id).toBe('task-7');
  expect(t.taskCalls).toEqual([['continueTask', 'task-7']]);
  expect(t.starts).toEqual([]);
  expect(t.service.view().notes).toEqual([]);
});

it('a put-back note stays when its Continue starts nothing', async () => {
  const t = setup();
  const view = paused({ place: 'putBack' });
  t.taskViews.push(view);
  const note = t.service.saveNote({ title: 'Fix the gate', text: 'It sticks', taskId: 'task-7' });
  // As a reopen does for a task a round is removing.
  t.putBackHooks.continued = (v) => v;

  await t.service.startItem({ kind: 'note', id: note.id }, { noQuestions: false });
  expect(t.service.view().notes).toEqual([note]);
});

it('starting a card whose task is finished continues it; one whose task was discarded starts a new task', async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(
    paused({ id: 'task-f', place: 'finished', card: cardRef('c1') }),
    paused({ id: 'task-d', place: 'discarded', card: cardRef('c2') }),
  );

  const continued = await t.service.startItem({ kind: 'card', id: 'c1' }, { noQuestions: false });
  expect(continued.id).toBe('task-f');
  expect(t.taskCalls).toEqual([['continueTask', 'task-f']]);
  expect(t.starts).toEqual([]);

  await t.service.startItem({ kind: 'card', id: '#c2' }, { noQuestions: false });
  expect(t.starts.map((s) => s.card?.id)).toEqual(['c2']);
  expect(t.taskCalls).toHaveLength(1);
});

it('starting a card whose task was put back continues it', async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ place: 'putBack', card: cardRef('c1') }));

  await t.service.startItem({ kind: 'card', id: 'c1' }, { noQuestions: false });
  expect(t.taskCalls).toEqual([['continueTask', 'task-7']]);
  expect(t.starts).toEqual([]);
});

it('deleting a put-back note returns its task to the board', () => {
  const t = setup();
  const note = t.service.saveNote({ title: 'Fix the gate', text: 'It sticks', taskId: 'task-7' });

  t.service.deleteNote(note.id);

  expect(t.taskCalls).toEqual([['returnToBoard', 'task-7']]);
  expect(t.service.view().notes).toEqual([]);
});

it("a sync that drops a put-back task's card returns the task to the board", async () => {
  const t = setup();
  t.taskViews.push(paused({ place: 'putBack', card: cardRef('c1') }), paused({ id: 'task-8', place: 'putBack', card: cardRef('c2') }));

  await synced(t, { ...CARDS_ANSWER, cards: [card('c2')] });

  expect(t.taskCalls).toEqual([['returnToBoard', 'task-7']]);
});

it('a put-back whose session ended in a question or an error neither syncs nor touches the task', async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ card: cardRef('c1') }));
  t.putBackHooks.card = async () => false;
  const runs = t.calls.length;

  await t.service.putBack('task-7');

  expect(t.calls).toHaveLength(runs);
  expect(t.taskCalls).toEqual([['putBackCard', 'task-7']]);
});

it("a note's put-back whose note can't be written returns the task to the board", async () => {
  const t = setup();
  t.taskViews.push(paused());
  vi.spyOn(t.service, 'saveNote').mockImplementation(() => {
    throw new Error('EACCES: permission denied');
  });

  await expect(t.service.putBack('task-7')).rejects.toThrow('EACCES');
  expect(t.taskCalls).toEqual([['markPutBack', 'task-7'], ['returnToBoard', 'task-7', 'Put back: EACCES: permission denied']]);
});

it("a put-back that fails says why on the paused task's card, and says nothing on a task that runs again", async () => {
  const t = setup();
  t.taskViews.push(paused({ card: cardRef('c1') }));
  t.putBackHooks.card = async () => {
    throw new Error('git refused');
  };
  await expect(t.service.putBack('task-7')).rejects.toThrow('git refused');
  expect(t.taskCalls.at(-1)).toEqual(['returnToBoard', 'task-7', 'Put back: git refused']);

  // Reopened meanwhile: its running session must not carry the line on.
  t.taskCalls.length = 0;
  t.putBackHooks.card = async () => {
    t.taskViews[0].session = { id: 's2', startedWithPrompt: false };
    t.taskViews[0].closedAt = null;
    throw new Error('Close Fix the gate before putting it back');
  };
  await expect(t.service.putBack('task-7')).rejects.toThrow('Close Fix the gate');
  expect(t.taskCalls).toEqual([['putBackCard', 'task-7']]);
});

it('a Put back runs marked from its session to its sync, and a second one meanwhile is refused without touching the task', async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ card: cardRef('c1') }));

  const putting = t.service.putBack('task-7');
  expect(t.taskViews[0].puttingBack).toBe(true);
  await flush();
  await expect(t.service.putBack('task-7')).rejects.toThrow('Fix the gate is being put back');
  expect(t.taskCalls).toEqual([['putBackCard', 'task-7']]);

  t.last().answer(CARDS_ANSWER);
  await putting;
  expect(t.taskViews[0].puttingBack).toBe(false);
  expect(t.taskCalls).toEqual([['putBackCard', 'task-7'], ['markPutBack', 'task-7']]);
});

it('a put-back sync that misses the card says nothing on a task that runs again', async () => {
  const t = setup();
  await synced(t);
  t.taskViews.push(paused({ card: cardRef('c1') }));

  const putting = t.service.putBack('task-7');
  await flush();
  // Reopened while the sync ran.
  t.taskViews[0].session = { id: 's2', startedWithPrompt: false };
  t.taskViews[0].closedAt = null;
  t.last().answer({ ...CARDS_ANSWER, cards: [card('c2')] });
  await putting;

  expect(t.taskCalls).toEqual([['putBackCard', 'task-7']]);
});
