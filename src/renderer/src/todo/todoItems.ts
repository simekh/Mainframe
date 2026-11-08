import type { TaskView, TodoCard, TodoItemRef, TodoNote, TodoView } from '../../../shared/types';

/** One row of the Todo panel's list: a synced card or one of the owner's notes. */
export interface TodoItem {
  key: string; // `card:<id>` | `note:<id>`
  kind: TodoItemRef['kind'];
  /** The card's or the note's own id. */
  id: string;
  title: string;
  body: string;
  number: string | null;
  labels: string[];
  forOwner: boolean;
  /** Start; Reopen of the newest closed task that has this card; none for a card for the owner. */
  action: { kind: 'start' } | { kind: 'reopen'; taskId: string } | null;
  card: TodoCard | null;
  note: TodoNote | null;
}

/**
 * The list as the panel shows it: the cards in the source's order, then the notes. A card is hidden while a task
 * started from it is open, even when a sync brings it back before that task has moved it: Start would refuse it.
 * A task matches its card on the card's id alone: the source's name is each sync's own answer.
 */
export function todoItems(view: TodoView, tasks: TaskView[]): TodoItem[] {
  // The tasks started from a card, by the card's id, each in the order of `tasks`.
  const byCard = new Map<string, TaskView[]>();
  for (const t of tasks) {
    if (t.card === null) continue;
    const own = byCard.get(t.card.id);
    if (own) own.push(t);
    else byCard.set(t.card.id, [t]);
  }
  const cards = view.cards.flatMap((card): TodoItem[] => {
    const own = byCard.get(card.id) ?? [];
    if (own.some((t) => t.session !== null)) return [];
    const newest = own.reduce<TaskView | null>((a, t) => (a && a.createdAt >= t.createdAt ? a : t), null);
    const action: TodoItem['action'] = card.forOwner ? null : newest ? { kind: 'reopen', taskId: newest.id } : { kind: 'start' };
    const { id, title, description, number, labels, forOwner } = card;
    return [{ key: `card:${id}`, kind: 'card', id, title, body: description, number, labels, forOwner, action, card, note: null }];
  });
  const notes = view.notes.map(
    (note): TodoItem => ({
      key: `note:${note.id}`,
      kind: 'note',
      id: note.id,
      title: note.title,
      body: note.text,
      number: null,
      labels: [],
      forOwner: false,
      action: { kind: 'start' },
      card: null,
      note,
    }),
  );
  return [...cards, ...notes];
}

/** The items the list shows: with `hideMine`, every card for the owner is left out; notes and the cards for sessions stay. */
export const visibleItems = (items: TodoItem[], hideMine: boolean): TodoItem[] =>
  hideMine ? items.filter((item) => !item.forOwner) : items;

/** The task a Reopen would reopen, for an item's `action`. */
export const reopenTaskId = (action: TodoItem['action']): string | null => (action?.kind === 'reopen' ? action.taskId : null);

/** Where the list comes from, as the last sync found it; nothing before the first. */
export function sourceLine(view: TodoView): string {
  const { source } = view;
  if (!source) return '';
  return [source.kind, source.board, source.list].filter((part) => part !== null).join(' · ');
}

/** How long ago the list was synced. */
export function syncedLine(view: TodoView, now: number): string {
  return view.syncedAt === null ? 'Not synced yet' : `Synced ${syncedAgo(view.syncedAt, now)}`;
}

/** How long ago `syncedAt` was, for a line that names the sync itself. */
export function syncedAgo(syncedAt: number, now: number): string {
  const minutes = Math.floor((now - syncedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}
