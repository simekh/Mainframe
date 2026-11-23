import type { TodoCard, TodoSource, TrelloBoardChoices, TrelloBoardRef, TrelloPick } from '../../../shared/types';
import type { TrelloApi } from './trelloApi';

type Api = Pick<TrelloApi, 'get'>;

interface RawLabel {
  id: string;
  name: string;
  color: string | null;
}

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

/** The picked list's cards, in list order, with where they were read from. */
export async function readList(api: Api, pick: TrelloPick): Promise<{ source: TodoSource; cards: TodoCard[] }> {
  const raw = await api.get<RawCard[]>(`/1/lists/${encodeURIComponent(pick.listId)}/cards`, {
    fields: 'id,idShort,name,desc,labels,pos,shortUrl',
    checklists: 'all',
    checklist_fields: 'name,pos',
  });
  return {
    source: { kind: 'Trello', board: pick.boardName, list: pick.listName, url: pick.boardUrl },
    cards: raw.sort(byPos).map((c) => toCard(c, pick)),
  };
}

/** The signed-in member's open boards. */
export function listBoards(api: Api): Promise<TrelloBoardRef[]> {
  return api.get<TrelloBoardRef[]>('/1/members/me/boards', { filter: 'open', fields: 'name,url' });
}

/** A board's open lists (in list order) and its labels, for the owner to pick from. */
export async function boardChoices(api: Api, boardId: string): Promise<TrelloBoardChoices> {
  const board = `/1/boards/${encodeURIComponent(boardId)}`;
  const [lists, labels] = await Promise.all([
    api.get<{ id: string; name: string; pos: number }[]>(`${board}/lists`, { fields: 'name,pos', filter: 'open' }),
    api.get<RawLabel[]>(`${board}/labels`, { fields: 'name,color', limit: '1000' }),
  ]);
  return {
    lists: lists.sort(byPos).map(({ id, name }) => ({ id, name })),
    labels: labels.map(({ id, name, color }) => ({ id, name, color })),
  };
}
