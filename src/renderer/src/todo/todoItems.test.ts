import { describe, it, expect } from 'vitest';
import type { TaskView, TodoCard, TodoNote, TodoView } from '../../../shared/types';
import { sourceLine, syncedLine, todoItems } from './todoItems';

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
const task = (id: string, cardId: string, o: { open: boolean; createdAt?: number; sourceKind?: string }): TaskView => ({
  id,
  title: id,
  description: '',
  slug: id,
  branch: `worktree-${id}`,
  worktreePath: `/repo/.claude/worktrees/${id}`,
  createdAt: o.createdAt ?? 0,
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
    // Also beside a closed task of the same card.
    expect(keys(view({ cards: [card('2')] }), [...running, task('t0', '2', { open: false })])).toEqual([]);
  });

  it('a card whose task has closed offers Reopen of the newest such task', () => {
    const tasks = [
      task('older', '1', { open: false, createdAt: 10 }),
      task('newest', '1', { open: false, createdAt: 30 }),
      task('middle', '1', { open: false, createdAt: 20 }),
    ];
    const [item] = todoItems(view({ cards: [card('1')] }), tasks);
    expect(item.action).toEqual({ kind: 'reopen', taskId: 'newest' });
  });

  it('a card for the owner offers nothing', () => {
    const items = todoItems(view({ cards: [card('1', { forOwner: true }), card('2', { forOwner: true })] }), [
      task('t2', '2', { open: false }),
    ]);
    expect(items.map((i) => [i.key, i.forOwner, i.action])).toEqual([
      ['card:1', true, null],
      ['card:2', true, null],
    ]);
  });

  it('a task matches a card only from the same source', () => {
    const elsewhere = [task('t1', '1', { open: true, sourceKind: 'Other' }), task('t2', '2', { open: false, sourceKind: 'Other' })];
    const items = todoItems(view({ cards: [card('1'), card('2')] }), elsewhere);
    expect(items.map((i) => [i.key, i.action])).toEqual([
      ['card:1', { kind: 'start' }],
      ['card:2', { kind: 'start' }],
    ]);
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
