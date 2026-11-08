import { describe, it, expect } from 'vitest';
import type { TaskView, TodoCard, TodoNote, TodoView } from '../../../shared/types';
import { reopenTaskId, sourceLine, startsFromTicket, syncedAgo, syncedLine, todoItems, visibleItems } from './todoItems';

const card = (id: string, extra: Partial<TodoCard> = {}): TodoCard => ({
  id,
  number: `#${id}`,
  title: `Card ${id}`,
  description: `About ${id}`,
  labels: [],
  checklists: [],
  url: null,
  forOwner: false,
  urgent: false,
  ...extra,
});

const note = (id: string): TodoNote => ({ id, title: `Note ${id}`, text: `Text ${id}` });

const view = (extra: Partial<TodoView> = {}): TodoView => ({
  source: { kind: 'Tracker', board: 'Shop', list: 'To do', url: null },
  syncedAt: 0,
  cards: [],
  notes: [],
  syncing: false,
  error: null,
  ask: null,
  setUp: true,
  ...extra,
});

/** A task started from the card `cardId` of `sourceKind`: open while it has a session. */
const task = (id: string, cardId: string, o: { open: boolean; sourceKind?: string }): TaskView => ({
  id,
  title: id,
  description: '',
  slug: id,
  branch: `worktree-${id}`,
  worktreePath: `/repo/.claude/worktrees/${id}`,
  createdAt: 0,
  closedAt: o.open ? null : 1,
  card: { sourceKind: o.sourceKind ?? 'Tracker', id: cardId, number: null, url: null, labels: [], position: 0, urgent: false },
  session: o.open ? { id: `s-${id}`, startedWithPrompt: true } : null,
});

const keys = (v: TodoView, tasks: TaskView[] = []) => todoItems(v, tasks).map((item) => item.key);

describe('todoItems', () => {
  it("cards keep the source's order and notes follow", () => {
    const items = todoItems(view({ cards: [card('3'), card('1', { labels: ['UI'] })], notes: [note('a'), note('b')] }), []);
    expect(items.map((i) => i.key)).toEqual(['card:3', 'card:1', 'note:a', 'note:b']);
    expect(items[1]).toEqual({
      key: 'card:1',
      kind: 'card',
      id: '1',
      title: 'Card 1',
      body: 'About 1',
      number: '#1',
      labels: ['UI'],
      forOwner: false,
      action: { kind: 'start' },
      card: card('1', { labels: ['UI'] }),
      note: null,
    });
    expect(items[2]).toEqual({
      key: 'note:a',
      kind: 'note',
      id: 'a',
      title: 'Note a',
      body: 'Text a',
      number: null,
      labels: [],
      forOwner: false,
      action: { kind: 'start' },
      card: null,
      note: note('a'),
    });
  });

  it('a card whose task runs is hidden, even when a sync brings it back', () => {
    const running = [task('t1', '2', { open: true })];
    expect(keys(view({ cards: [card('1'), card('3')] }), running)).toEqual(['card:1', 'card:3']);
    // The sync ran before the session moved its card: the card is back in the list, and stays hidden.
    expect(keys(view({ cards: [card('1'), card('2'), card('3')] }), running)).toEqual(['card:1', 'card:3']);
  });

  it('a card whose task has closed offers Reopen of that task', () => {
    const [item] = todoItems(view({ cards: [card('1')] }), [task('t1', '1', { open: false })]);
    expect(item.action).toEqual({ kind: 'reopen', taskId: 't1' });
  });

  it('a card for the owner has no Start, but a closed task of it offers Reopen, as any card does', () => {
    const items = todoItems(view({ cards: [card('1', { forOwner: true }), card('2', { forOwner: true })] }), [
      task('t2', '2', { open: false }),
    ]);
    expect(items.map((i) => [i.key, i.forOwner, i.action])).toEqual([
      ['card:1', true, null],
      ['card:2', true, { kind: 'reopen', taskId: 't2' }],
    ]);
  });

  it("a task matches its card whatever name the latest sync gave the source", () => {
    const renamed = [task('t1', '1', { open: true, sourceKind: 'Tracker Issues' }), task('t2', '2', { open: false, sourceKind: 'Tracker Issues' })];
    const items = todoItems(view({ cards: [card('1'), card('2'), card('3')] }), renamed);
    expect(items.map((i) => [i.key, i.action])).toEqual([
      ['card:2', { kind: 'reopen', taskId: 't2' }],
      ['card:3', { kind: 'start' }],
    ]);
  });
});

describe('startsFromTicket', () => {
  const only = (cards: TodoCard[], tasks: TaskView[] = []) => todoItems(view({ cards }), tasks)[0];

  it("is so for a card with a Start and for a card for the owner with no task, and not for one that offers Reopen", () => {
    expect(startsFromTicket(only([card('1')]))).toBe(true);
    expect(startsFromTicket(only([card('1', { forOwner: true })]))).toBe(true);
    expect(startsFromTicket(only([card('1')], [task('t', '1', { open: false })]))).toBe(false);
  });
});

describe('reopenTaskId', () => {
  it('is the task of a Reopen, and nothing for a Start or no action', () => {
    expect(reopenTaskId({ kind: 'reopen', taskId: 't1' })).toBe('t1');
    expect(reopenTaskId({ kind: 'start' })).toBeNull();
    expect(reopenTaskId(null)).toBeNull();
  });
});

describe('sourceLine', () => {
  it('names the source, its board and its list', () => {
    expect(sourceLine(view())).toBe('Tracker · Shop · To do');
  });

  it('leaves the board out when there is none', () => {
    expect(sourceLine(view({ source: { kind: 'Tracker', board: null, list: 'To do', url: null } }))).toBe('Tracker · To do');
  });

  it('is empty before the first sync', () => {
    expect(sourceLine(view({ source: null }))).toBe('');
  });
});

describe('syncedLine', () => {
  const at = 1_000_000_000_000;

  it.each([
    [0, 'Synced just now'],
    [30_000, 'Synced just now'],
    [12 * 60_000, 'Synced 12 min ago'],
    [3 * 3_600_000, 'Synced 3 h ago'],
  ])('%i ms after a sync it reads %s', (since, want) => {
    expect(syncedLine(view({ syncedAt: at }), at + since)).toBe(want);
  });

  it('reads Not synced yet before the first sync', () => {
    expect(syncedLine(view({ source: null, syncedAt: null }), at)).toBe('Not synced yet');
  });
});

describe('syncedAgo', () => {
  const at = 1_000_000_000_000;

  it.each([
    [0, 'just now'],
    [12 * 60_000, '12 min ago'],
    [3 * 3_600_000, '3 h ago'],
  ])('%i ms after a sync it reads %s, for a line that names the sync itself', (since, want) => {
    expect(syncedAgo(at, at + since)).toBe(want);
  });
});

describe('visibleItems', () => {
  const items = () =>
    todoItems(
      view({ cards: [card('1', { forOwner: true }), card('2'), card('3', { forOwner: true }), card('4'), card('5')], notes: [note('a')] }),
      [task('t4', '4', { open: false })],
    );

  it('keeps every item while the owner has not asked to hide theirs', () => {
    const all = items();
    expect(visibleItems(all, false)).toEqual(all);
  });

  it("leaves out the cards for the owner, and keeps the others, Reopen rows and notes in order", () => {
    const shown = visibleItems(items(), true);
    expect(shown.map((i) => [i.key, i.action])).toEqual([
      ['card:2', { kind: 'start' }],
      ['card:4', { kind: 'reopen', taskId: 't4' }],
      ['card:5', { kind: 'start' }],
      ['note:a', { kind: 'start' }],
    ]);
  });

  it('leaves the list it was given as it was', () => {
    const all = items();
    const before = all.map((i) => i.key);
    visibleItems(all, true);
    expect(all.map((i) => i.key)).toEqual(before);
  });

  it('leaves nothing when every item is for the owner', () => {
    const only = todoItems(view({ cards: [card('1', { forOwner: true }), card('2', { forOwner: true })] }), []);
    expect(visibleItems(only, true)).toEqual([]);
    expect(visibleItems([], true)).toEqual([]);
  });
});
