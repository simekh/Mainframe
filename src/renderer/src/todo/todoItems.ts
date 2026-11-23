import { isEnded, type TaskView, type TodoCard, type TodoItemRef, type TodoNote, type TodoSource, type TodoView } from '../../../shared/types';
import { cardKey } from '../../../shared/cardKey';

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
  /**
   * Start; Reopen of the card's task while it is Paused on the board; Continue of its task, or a note's, that was put
   * back or finished; none for a card for the owner that has no task.
   */
  action: { kind: 'start' } | { kind: 'reopen'; taskId: string } | { kind: 'continue'; taskId: string } | null;
  card: TodoCard | null;
  note: TodoNote | null;
}

/**
 * The list as the panel shows it: the cards in the source's order, then the notes. A card has one task for good,
 * discarded ones aside: a discarded attempt is given up, so its card starts afresh. It is hidden while that task is
 * open, even when a sync brings it back before the task has moved it: Start would refuse it. A task matches its card on
 * the card's id alone: the source's name is each sync's own answer.
 */
export function todoItems(view: TodoView, tasks: TaskView[]): TodoItem[] {
  const taskOf = new Map<string, TaskView>();
  for (const t of tasks) if (t.card !== null && t.place !== 'discarded') taskOf.set(cardKey(t.card.id), t);
  const cards = view.cards.flatMap((card): TodoItem[] => {
    const task = taskOf.get(cardKey(card.id));
    if (task?.session) return [];
    // A card marked for the owner has no Start in the list, though its task, once closed, can be reopened or continued.
    // The owner starts it from its ticket.
    const action: TodoItem['action'] = task
      ? { kind: task.place === null ? 'reopen' : 'continue', taskId: task.id }
      : card.forOwner
        ? null
        : { kind: 'start' };
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
      action: note.taskId === undefined ? { kind: 'start' } : { kind: 'continue', taskId: note.taskId },
      card: null,
      note,
    }),
  );
  return [...cards, ...notes];
}

/** The items the list shows: with `hideMine`, every card for the owner is left out; notes and the cards for sessions stay. */
export const visibleItems = (items: TodoItem[], hideMine: boolean): TodoItem[] =>
  hideMine ? items.filter((item) => !item.forOwner) : items;

/** Whether the item's ticket has a Start: any item that offers neither Reopen nor Continue, a card for the owner with no task too. */
export const startsFromTicket = (item: TodoItem): boolean => item.action === null || item.action.kind === 'start';

/** What a ticket's Start hands the Todo panel: the choice of no questions, a note's edits, and the owner's own start of their card. */
export interface StartOptions {
  noQuestions: boolean;
  note?: { title: string; text: string };
  ownersCard?: boolean;
}

/** The task a Reopen would reopen, for an item's `action`. */
export const reopenTaskId = (action: TodoItem['action']): string | null => (action?.kind === 'reopen' ? action.taskId : null);

/**
 * The Finished tab's tasks: the finished and discarded ones, the newest first, whose title or card number holds the
 * query, in any case and with or without a leading `#`.
 */
export function finishedTasks(tasks: TaskView[], query: string): TaskView[] {
  const bare = (s: string) => s.toLowerCase().replace(/^#/, '');
  const q = bare(query.trim());
  return tasks
    .filter((t) => isEnded(t.place))
    .filter((t) => t.title.toLowerCase().includes(q) || (t.card?.number != null && bare(t.card.number).includes(q)))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
}

/** Each locale's day-and-short-month format, made once: the Finished tab formats a date for every row. */
const dayMonth = new Map<string | undefined, Intl.DateTimeFormat>();

/** A Finished row's line: where the task went and when, day and short month in `locale` (the system's by default). */
export function endedLine(task: TaskView, locale?: string): string {
  const what = task.place === 'discarded' ? 'Discarded' : 'Finished';
  let format = dayMonth.get(locale);
  if (!format) dayMonth.set(locale, (format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })));
  const when = task.endedAt === null ? '' : ` ${format.format(task.endedAt)}`;
  return `${what}${when}${task.card === null ? ' · no card' : ''}`;
}

/** Where in its service the list is: the board or project, and the list. The service's name goes before it. */
export function sourcePlace(source: TodoSource): string {
  return [source.board, source.list].filter((part) => part !== null).join(' · ');
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
