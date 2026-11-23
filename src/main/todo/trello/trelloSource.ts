import * as z from 'zod/v4';
import type { TodoCard, TodoSource, TrelloBoardChoices, TrelloBoardRef, TrelloPick } from '../../../shared/types';
import { TODO_CARD } from '../todoSchema';
import { TrelloError, type TrelloApi } from './trelloApi';

type Api = Pick<TrelloApi, 'get'>;

const LABELS = z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() }));
type RawLabel = z.infer<typeof LABELS>[number];
const LISTS = z.array(z.object({ id: z.string(), name: z.string(), pos: z.number() }));
const BOARDS = z.array(z.object({ id: z.string(), name: z.string(), url: z.string() }));

interface RawCard {
  id: string;
  idShort: number;
  name: string;
  desc: string;
  pos: number;
  shortUrl: string;
  labels?: RawLabel[];
  checklists?: {
    name: string;
    pos: number;
    checkItems?: { name: string; state: 'complete' | 'incomplete'; pos: number }[];
  }[];
}

const byPos = <T extends { pos: number }>(a: T, b: T): number => a.pos - b.pos;

function toCard(raw: RawCard, pick: TrelloPick): TodoCard {
  const labels = raw.labels ?? [];
  const hasAny = (ids: string[]) => labels.some((l) => ids.includes(l.id));
  return {
    id: raw.id,
    number: `#${raw.idShort}`,
    title: raw.name,
    description: raw.desc,
    labels: labels.flatMap((l) => l.name || l.color || []),
    checklists: (raw.checklists ?? []).sort(byPos).map((list) => ({
      name: list.name,
      items: (list.checkItems ?? []).sort(byPos).map((i) => ({ text: i.name, done: i.state === 'complete' })),
    })),
    url: raw.shortUrl,
    forOwner: hasAny(pick.mineLabelIds),
    urgent: hasAny(pick.urgentLabelIds),
  };
}

const CARDS = z.array(TODO_CARD);

/** What `read` makes of Trello's answer; an answer it can't read is refused whole. */
function readable<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new TrelloError('http', "Trello's answer had a shape Mainframe can't read");
  }
}

/**
 * The picked list's cards, in list order, with where they were read from. An answer that doesn't map to valid cards
 * is refused whole: saved, it would get todo.json set aside at the next start, notes and all.
 */
export async function readList(api: Api, pick: TrelloPick): Promise<{ source: TodoSource; cards: TodoCard[] }> {
  const raw = await api.get<RawCard[]>(`/1/lists/${encodeURIComponent(pick.listId)}/cards`, {
    fields: 'id,idShort,name,desc,labels,pos,shortUrl',
    checklists: 'all',
  });
  const cards = readable(() => CARDS.parse(raw.sort(byPos).map((c) => toCard(c, pick))));
  return { source: { kind: 'Trello', board: pick.boardName, list: pick.listName, url: pick.boardUrl }, cards };
}

/** The signed-in member's open boards. */
export async function listBoards(api: Api): Promise<TrelloBoardRef[]> {
  const raw = await api.get<unknown>('/1/members/me/boards', { filter: 'open', fields: 'name,url' });
  return readable(() => BOARDS.parse(raw));
}

/** A board's open lists (in list order) and its labels, for the owner to pick from. */
export async function boardChoices(api: Api, boardId: string): Promise<TrelloBoardChoices> {
  const board = `/1/boards/${encodeURIComponent(boardId)}`;
  const [lists, labels] = await Promise.all([
    api.get<unknown>(`${board}/lists`, { fields: 'name,pos', filter: 'open' }),
    api.get<unknown>(`${board}/labels`, { fields: 'name,color', limit: '1000' }),
  ]);
  return readable(() => ({
    lists: LISTS.parse(lists).sort(byPos).map(({ id, name }) => ({ id, name })),
    // Parsing keeps only the fields named.
    labels: LABELS.parse(labels),
  }));
}
