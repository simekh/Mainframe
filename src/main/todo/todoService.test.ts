import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { TaskCardRef, TaskView, TodoCard, TodoListRef, TodoSource } from '../../shared/types';
import { projectKey } from '../tasks/naming';
import type { TaskService } from '../tasks/taskService';
import { SYNC_TIMEOUT_MS, syncArgv, syncPrompt, syncSettings, type runClaude } from './syncRun';
import { TodoService } from './todoService';

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
  options: Parameters<typeof runClaude>[0];
  cancelled: boolean;
  answer(structured: unknown): void;
  print(stdout: string): void;
  fail(message: string): void;
}

function setup(todoFile?: string) {
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
  const run: typeof runClaude = (options) => {
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
      fail: (message) => reject(new Error(message)),
    };
    calls.push(call);
    return { done, cancel: () => (call.cancelled = true) };
  };

  const starts: Parameters<TaskService['start']>[0][] = [];
  const control = { startFails: null as Error | null };
  const startTask: TaskService['start'] = async (req) => {
    starts.push(req);
    if (control.startFails) throw control.startFails;
    return TASK;
  };

  const changes: ReturnType<TodoService['view']>[] = [];
  const warnings: string[] = [];
  let counter = 0;
  const make = () =>
    new TodoService({
      projectDir,
      dataDir,
      claudeBin: 'claude',
      env: ENV,
      startTask,
      onChange: (view) => changes.push(view),
      run,
      newId: () => `id-${++counter}`,
      now: () => NOW,
      warn: (msg) => warnings.push(msg),
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
    changes,
    warnings,
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
    input: syncPrompt({ kind: 'discover' }),
    timeoutMs: SYNC_TIMEOUT_MS,
  });
  expect(t.settings().permissions).toBeUndefined();
  expect(readFileSync(t.settingsFile, 'utf8')).toBe(syncSettings([]));
  expect(t.service.view().syncing).toBe(true);

  t.last().answer(TOOLS_ANSWER);

  expect(await pending).toEqual({ ask: 'tools' });
  expect(t.service.view()).toEqual({
    source: null,
    syncedAt: null,
    cards: [],
    notes: [],
    syncing: false,
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
  expect(t.last().options.input).toBe(syncPrompt({ kind: 'read', list: null }));
  expect(t.settings().permissions).toEqual({ allow: TOOLS });
  expect(readFileSync(t.settingsFile, 'utf8')).toBe(syncSettings(TOOLS));
  expect(t.todo().readTools).toEqual({ connector: 'Tracker', tools: TOOLS });
  expect(t.service.view()).toMatchObject({ syncing: true, ask: null, setUp: true });

  t.last().answer(CARDS_ANSWER);

  expect(await confirming).toEqual({ cards: 2 });
  const expected = {
    source: SOURCE,
    syncedAt: NOW,
    cards: CARDS,
    notes: [],
    syncing: false,
    error: null,
    ask: null,
    setUp: true,
  };
  expect(t.service.view()).toEqual(expected);
  expect(t.todo()).toEqual({
    version: 1,
    readTools: { connector: 'Tracker', tools: TOOLS },
    source: SOURCE,
    syncedAt: NOW,
    cards: CARDS,
    notes: [],
  });

  // Another sync reads with the same tools; a restart finds the list, and no ask.
  void t.service.sync();
  expect(t.last().options.input).toBe(syncPrompt({ kind: 'read', list: null }));
  expect(t.settings().permissions).toEqual({ allow: TOOLS });
  expect(t.make().view()).toEqual(expected);
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

  expect(t.last().options.input).toBe(syncPrompt({ kind: 'read', list: DOING }));
  expect(t.last().options.input).toContain('Doing');
  expect(t.settings().permissions).toEqual({ allow: TOOLS });
  expect(t.todo().pickedList).toEqual(DOING);
  expect(t.service.view()).toMatchObject({ ask: null, setUp: true });

  t.last().answer(CARDS_ANSWER);

  expect(await picking).toEqual({ cards: 2 });
  // The answer of cards keeps the tools and the picked list; the next sync reads that list again.
  expect(t.todo()).toMatchObject({ readTools: { connector: 'Tracker', tools: TOOLS }, pickedList: DOING });
  void t.service.sync();
  expect(t.last().options.input).toBe(syncPrompt({ kind: 'read', list: DOING }));
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
  expect(t.last().options.input).toBe(syncPrompt({ kind: 'discover' }));
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

  expect(() => t.service.saveNote({ title: '   ', text: 'No title' })).toThrow('A note needs a title');
  expect(() => t.service.saveNote({ id: 'nope', title: 'Title', text: '' })).toThrow('No note nope');
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

it('a card for the owner is not started unless the owner chose it, whether asked for by its id or by its number, and says so', async () => {
  const t = setup();
  const cards = [card('c7', { number: '#7', forOwner: true }), card('c8', { number: null, title: 'Decide', forOwner: true })];
  await synced(t, { ...CARDS_ANSWER, cards });
  const refusal = (name: string) => `${name} is for the owner; start it only when the owner names it`;

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
  await expect(t.service.startItem({ kind: 'note', id: 'zz' }, { noQuestions: false })).rejects.toThrow('No note zz');
  // A card's id is not a note's.
  await expect(t.service.startItem({ kind: 'note', id: 'c1' }, { noQuestions: false })).rejects.toThrow('No note c1');
  expect(t.starts).toEqual([]);
});

it('a Todo file from a newer Mainframe: the panel says so, and nothing syncs or saves', async () => {
  const newer = JSON.stringify({ version: 2, cards: [{ id: 'c1' }], notes: [{ id: 'n1' }], extra: true });
  const t = setup(newer);
  const message = t.service.view().error!;

  expect(message).toContain('newer Mainframe');
  expect(t.service.view()).toEqual({ source: null, syncedAt: null, cards: [], notes: [], syncing: false, error: message, ask: null, setUp: false });

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
