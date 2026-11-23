import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A card as a test writes it: its number, and its labels by name. */
export interface FakeCard {
  number: number;
  name: string;
  desc?: string;
  labels?: string[];
  checklists?: { name: string; items: { name: string; done: boolean }[] }[];
}

export interface FakeBoard {
  name: string;
  /** A label with no name is told apart by its colour. */
  labels?: { name: string; color: string | null }[];
  lists: { name: string; cards: FakeCard[] }[];
}

export interface FakeTrello {
  url: string;
  /** Every request, oldest first, as `METHOD path?query`. */
  requests: string[];
  /** Replaces the boards: what the next read sees. */
  set(state: FakeBoard[]): void;
  /** The next API request (not the sign-in's) answers `status` with `headers`, once. */
  respondNext(status: number, headers?: Record<string, string>): void;
  close(): Promise<void>;
}

const ACCESS_TOKEN = 'fake-access-token';
export const FAKE_USERNAME = 'ada';

/**
 * Trello's ids are 24 hex digits; the fake's come from the names, so a board, list, label or card keeps its id
 * across `set` and loses it with its name. A card's comes from its board and number, as Trello numbers per board.
 */
export const fakeId = (...names: (string | number)[]) => createHash('sha256').update(names.join('/')).digest('hex').slice(0, 24);

export const fakeCardId = (board: string, number: number) => fakeId(board, '#', number);

const running = new Set<FakeTrello>();

/** Closes every fake a test started, passed or failed: `test.afterEach(closeFakeTrellos)`. */
export async function closeFakeTrellos(): Promise<void> {
  await Promise.all([...running].map((fake) => fake.close()));
}

/**
 * A stand-in for Trello's sign-in and REST API on 127.0.0.1, at one address, for `MAINFRAME_E2E_TRELLO_URL`. The
 * sign-in signs in at once: `/authorize` sends the browser straight back to the app's loopback with a code.
 */
export async function startFakeTrello(state: FakeBoard[]): Promise<FakeTrello> {
  let boards = state;
  let next: { status: number; headers: Record<string, string> } | null = null;
  const requests: string[] = [];

  const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  const labelsOf = (board: FakeBoard) =>
    (board.labels ?? []).map((l) => ({ id: fakeId(board.name, 'label', l.name || (l.color ?? '')), name: l.name, color: l.color }));

  // Sent with every API answer: a budget well over the 30% that slows the polls.
  const RATE = { 'x-rate-limit-oauth2-client-id-remaining': '299', 'x-rate-limit-oauth2-client-id-max': '300' };

  /** The API's answer, or null for a path it doesn't have. */
  function api(path: string): unknown {
    if (path === '/1/members/me') return { id: fakeId('member'), username: FAKE_USERNAME, fullName: 'Ada Example' };
    if (path === '/1/members/me/boards') {
      return boards.map((b) => ({ id: fakeId(b.name), name: b.name, url: `https://trello.example/b/${fakeId(b.name).slice(0, 8)}` }));
    }
    const onBoard = /^\/1\/boards\/([^/]+)\/(lists|labels)$/.exec(path);
    if (onBoard) {
      const board = boards.find((b) => fakeId(b.name) === onBoard[1]);
      if (!board) return null;
      if (onBoard[2] === 'labels') return labelsOf(board);
      return board.lists.map((l, i) => ({ id: fakeId(board.name, 'list', l.name), name: l.name, pos: (i + 1) * 1024 }));
    }
    const cardsOf = /^\/1\/lists\/([^/]+)\/cards$/.exec(path);
    if (cardsOf) {
      for (const board of boards) {
        const list = board.lists.find((l) => fakeId(board.name, 'list', l.name) === cardsOf[1]);
        if (!list) continue;
        const labels = labelsOf(board);
        const cards = list.cards.map((c, i) => {
          const id = fakeCardId(board.name, c.number);
          return {
            id,
            idShort: c.number,
            name: c.name,
            desc: c.desc ?? '',
            labels: (c.labels ?? []).map((name) => labels.find((l) => (l.name || l.color) === name)!),
            pos: (i + 1) * 1024,
            shortUrl: `https://trello.example/c/${id.slice(0, 8)}`,
            checklists: (c.checklists ?? []).map((list, j) => ({
              id: fakeId(id, 'checklist', j),
              name: list.name,
              pos: (j + 1) * 1024,
              checkItems: list.items.map((item, k) => ({
                id: fakeId(id, 'checklist', j, k),
                name: item.name,
                state: item.done ? 'complete' : 'incomplete',
                pos: (k + 1) * 1024,
              })),
            })),
          };
        });
        // Out of order, as Trello doesn't promise one: the app sorts by pos.
        return cards.reverse();
      }
    }
    return null;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(`${req.method} ${url.pathname}${url.search}`);

    if (req.method === 'GET' && url.pathname === '/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.search = new URLSearchParams({ code: 'fake', state: url.searchParams.get('state') ?? '' }).toString();
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      // The body is read, so the connection is free for the next request.
      req.resume();
      req.on('end', () => json(res, 200, { access_token: ACCESS_TOKEN, refresh_token: 'fake-refresh-token', expires_in: 3600 }));
      return;
    }
    if (req.method !== 'GET' || !url.pathname.startsWith('/1/')) {
      res.writeHead(404).end();
      return;
    }
    if (next) {
      const { status, headers } = next;
      next = null;
      json(res, status, { message: `answered ${status} by the test` }, headers);
      return;
    }
    if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
      json(res, 401, { message: 'invalid token' });
      return;
    }
    const body = api(url.pathname);
    if (body === null) json(res, 404, { message: 'not found' }, RATE);
    else json(res, 200, body, RATE);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fake: FakeTrello = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    set: (state) => void (boards = state),
    respondNext: (status, headers = {}) => void (next = { status, headers }),
    close: () => {
      running.delete(fake);
      // The app's keep-alive sockets would hold close() open.
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
  running.add(fake);
  return fake;
}
