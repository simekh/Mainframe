import { describe, expect, it } from 'vitest';
import type { TrelloPick } from '../../../shared/types';
import { TrelloError } from './trelloApi';
import { boardChoices, listBoards, readList } from './trelloSource';

type Call = { path: string; query: Record<string, string> };

/** A fake `get` that records each request and answers with the fixture for its path. */
function fakeApi(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  return {
    calls,
    get: async <T>(path: string, query: Record<string, string> = {}): Promise<T> => {
      calls.push({ path, query });
      return answers[path] as T;
    },
  };
}

const pick: TrelloPick = {
  boardId: 'b1',
  boardName: 'Board',
  boardUrl: 'https://trello.com/b/b1',
  listId: 'l1',
  listName: 'List',
  inProgressListId: null,
  mineLabelIds: ['mine'],
  urgentLabelIds: ['hot'],
};

function card(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    idShort: 7,
    name: 'Title',
    desc: 'Body',
    pos: 1,
    shortUrl: 'https://trello.com/c/c1',
    labels: [],
    checklists: [],
    ...over,
  };
}

describe('readList', () => {
  it('reads the list with its checklists in one request', async () => {
    const api = fakeApi({ '/1/lists/l1/cards': [] });
    const result = await readList(api, pick);
    expect(api.calls).toEqual([
      {
        path: '/1/lists/l1/cards',
        // No checklist_fields: the full checklist objects carry their checkItems.
        query: { fields: 'id,idShort,name,desc,labels,pos,shortUrl', checklists: 'all' },
      },
    ]);
    expect(result).toEqual({
      source: { kind: 'Trello', board: 'Board', list: 'List', url: 'https://trello.com/b/b1' },
      cards: [],
    });
  });

  it('encodes the list id in the path', async () => {
    const api = fakeApi({ '/1/lists/a%2Fb/cards': [] });
    await readList(api, { ...pick, listId: 'a/b' });
    expect(api.calls[0].path).toBe('/1/lists/a%2Fb/cards');
  });

  it('maps a card', async () => {
    const api = fakeApi({
      '/1/lists/l1/cards': [
        card({
          labels: [{ id: 'x', name: 'UI', color: 'blue' }],
          checklists: [
            {
              id: 'k1',
              name: 'Steps',
              pos: 1,
              checkItems: [{ id: 'i1', name: 'Do it', state: 'complete', pos: 1 }, { id: 'i2', name: 'Check', state: 'incomplete', pos: 2 }],
            },
          ],
        }),
      ],
    });
    const { cards } = await readList(api, pick);
    expect(cards).toEqual([
      {
        id: 'c1',
        number: '#7',
        title: 'Title',
        description: 'Body',
        labels: ['UI'],
        checklists: [
          {
            name: 'Steps',
            items: [
              { text: 'Do it', done: true },
              { text: 'Check', done: false },
            ],
          },
        ],
        url: 'https://trello.com/c/c1',
        forOwner: false,
        urgent: false,
      },
    ]);
  });

  it('names a label by its colour when it has no name, and leaves out one with neither', async () => {
    const api = fakeApi({
      '/1/lists/l1/cards': [
        card({
          labels: [
            { id: 'a', name: 'Named', color: 'red' },
            { id: 'b', name: '', color: 'green' },
            { id: 'c', name: '', color: null },
          ],
        }),
      ],
    });
    const { cards } = await readList(api, pick);
    expect(cards[0].labels).toEqual(['Named', 'green']);
  });

  it('marks forOwner and urgent by label id, not name', async () => {
    const api = fakeApi({
      '/1/lists/l1/cards': [
        card({ id: 'm', labels: [{ id: 'mine', name: 'whatever', color: null }] }),
        card({ id: 'u', labels: [{ id: 'hot', name: 'mine', color: null }] }),
        card({ id: 'n', labels: [{ id: 'other', name: 'mine', color: null }] }),
      ],
    });
    const { cards } = await readList(api, pick);
    expect(cards.map((c) => [c.id, c.forOwner, c.urgent])).toEqual([
      ['m', true, false],
      ['u', false, true],
      ['n', false, false],
    ]);
  });

  it('orders cards, checklists and items by pos', async () => {
    const item = (name: string, pos: number) => ({ id: name, name, state: 'incomplete', pos });
    const api = fakeApi({
      '/1/lists/l1/cards': [
        card({ id: 'second', pos: 20 }),
        card({
          id: 'first',
          pos: 10,
          checklists: [
            { id: 'k2', name: 'Late', pos: 2, checkItems: [item('b', 2), item('a', 1)] },
            { id: 'k1', name: 'Early', pos: 1, checkItems: [] },
          ],
        }),
      ],
    });
    const { cards } = await readList(api, pick);
    expect(cards.map((c) => c.id)).toEqual(['first', 'second']);
    expect(cards[0].checklists.map((l) => l.name)).toEqual(['Early', 'Late']);
    expect(cards[0].checklists[1].items.map((i) => i.text)).toEqual(['a', 'b']);
  });

  it('treats a missing labels, checklists or checkItems as empty', async () => {
    const api = fakeApi({
      '/1/lists/l1/cards': [
        { id: 'c', idShort: 1, name: 'T', desc: '', pos: 1, shortUrl: 'u', checklists: [{ id: 'k', name: 'L', pos: 1 }] },
        { id: 'd', idShort: 2, name: 'T', desc: '', pos: 2, shortUrl: 'u' },
      ],
    });
    const { cards } = await readList(api, pick);
    expect(cards[0].labels).toEqual([]);
    expect(cards[0].checklists).toEqual([{ name: 'L', items: [] }]);
    expect(cards[1].checklists).toEqual([]);
  });

  it.each([
    ['a card without a name', [card({ name: undefined })]],
    ['labels that are not a list', [card({ labels: 'x' })]],
    ['an answer that is not a list', { cards: [] }],
  ])("refuses %s as a shape it can't read, so nothing invalid is saved", async (_what, answer) => {
    const api = fakeApi({ '/1/lists/l1/cards': answer });
    const err = await readList(api, pick).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrelloError);
    expect(err).toMatchObject({ kind: 'http', message: "Trello's answer had a shape Mainframe can't read" });
  });
});

describe('listBoards', () => {
  it('reads the open boards', async () => {
    const api = fakeApi({ '/1/members/me/boards': [{ id: 'b1', name: 'One', url: 'https://trello.com/b/b1' }] });
    expect(await listBoards(api)).toEqual([{ id: 'b1', name: 'One', url: 'https://trello.com/b/b1' }]);
    expect(api.calls).toEqual([{ path: '/1/members/me/boards', query: { filter: 'open', fields: 'name,url' } }]);
  });

  it.each([
    ['an answer that is not a list', { boards: [] }],
    ['a board without a name', [{ id: 'b1', url: 'u' }]],
  ])("refuses %s as a shape it can't read", async (_what, answer) => {
    const err = await listBoards(fakeApi({ '/1/members/me/boards': answer })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrelloError);
    expect(err).toMatchObject({ kind: 'http', message: "Trello's answer had a shape Mainframe can't read" });
  });
});

describe('boardChoices', () => {
  it('reads a board’s open lists in pos order and its labels', async () => {
    const api = fakeApi({
      '/1/boards/b%201/lists': [
        { id: 'l2', name: 'Two', pos: 2 },
        { id: 'l1', name: 'One', pos: 1 },
      ],
      '/1/boards/b%201/labels': [
        { id: 'x', name: 'UI', color: 'blue' },
        { id: 'y', name: '', color: null },
      ],
    });
    expect(await boardChoices(api, 'b 1')).toEqual({
      lists: [
        { id: 'l1', name: 'One' },
        { id: 'l2', name: 'Two' },
      ],
      labels: [
        { id: 'x', name: 'UI', color: 'blue' },
        { id: 'y', name: '', color: null },
      ],
    });
    expect(api.calls).toContainEqual({ path: '/1/boards/b%201/lists', query: { fields: 'name,pos', filter: 'open' } });
    expect(api.calls).toContainEqual({ path: '/1/boards/b%201/labels', query: { fields: 'name,color', limit: '1000' } });
  });

  it.each([
    ['lists that are not a list', { lists: [] }, []],
    ['a list without a pos', [{ id: 'l1', name: 'One' }], []],
    ['a label without a colour field', [], [{ id: 'x', name: 'UI' }]],
  ])("refuses %s as a shape it can't read", async (_what, lists, labels) => {
    const api = fakeApi({ '/1/boards/b/lists': lists, '/1/boards/b/labels': labels });
    const err = await boardChoices(api, 'b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrelloError);
    expect(err).toMatchObject({ kind: 'http', message: "Trello's answer had a shape Mainframe can't read" });
  });
});
