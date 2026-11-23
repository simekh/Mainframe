import { describe, expect, it, vi } from 'vitest';
import { TrelloApi, TrelloError, type TrelloTokens } from './trelloApi';

const json = (body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), init);
const status = (code: number, headers: Record<string, string> = {}): Response => new Response('', { status: code, headers });

function setup(responses: (Response | Error)[], tokens?: Partial<TrelloTokens>) {
  const queue = [...responses];
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  let time = 1_000_000;
  const api = new TrelloApi({
    tokens: { accessToken: async () => 'tok1', refreshed: async () => 'tok2', ...tokens },
    base: 'https://api.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => time,
  });
  return { api, fetch, calls, advance: (ms: number) => (time += ms) };
}

const kindOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as TrelloError).kind;

describe('TrelloApi', () => {
  it('sends the bearer token and the query', async () => {
    const { api, calls } = setup([json({ ok: 1 })]);
    expect(await api.get('/1/lists/L/cards', { fields: 'a' })).toEqual({ ok: 1 });
    expect(calls[0].url).toBe('https://api.test/1/lists/L/cards?fields=a');
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer tok1' });
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    const { api, calls } = setup([status(401), json([])]);
    await api.get('/x');
    expect(calls).toHaveLength(2);
    expect(calls[1].init?.headers).toEqual({ Authorization: 'Bearer tok2' });
  });

  it('a 401 that survives a successful refresh is notFound: this token cannot reach that resource', async () => {
    const { api, fetch } = setup([status(401), status(401)]);
    expect(await kindOf(api.get('/x'))).toBe('notFound');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a refresh that throws is an auth error, and keeps a TrelloError kind', async () => {
    const a = setup([status(401)], {
      refreshed: async () => {
        throw new Error('nope');
      },
    });
    expect(await kindOf(a.api.get('/x'))).toBe('auth');
    const b = setup([status(401)], {
      refreshed: async () => {
        throw new TrelloError('offline', 'down');
      },
    });
    expect(await kindOf(b.api.get('/x'))).toBe('offline');
  });

  it('pauses every call after a 429', async () => {
    const { api, fetch, advance } = setup([status(429, { 'retry-after': '3' }), json({})]);
    expect(await kindOf(api.get('/x'))).toBe('busy');
    advance(2999);
    expect(await kindOf(api.get('/x'))).toBe('busy');
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    await api.get('/x');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('without Retry-After the pause grows 10 s, 20 s … 120 s and resets after a success', async () => {
    const { api, fetch, advance } = setup([
      ...Array.from({ length: 6 }, () => status(429)),
      json({}),
      status(429),
      json({}),
    ]);
    for (const pause of [10_000, 20_000, 40_000, 80_000, 120_000, 120_000]) {
      expect(await kindOf(api.get('/x'))).toBe('busy');
      advance(pause - 1);
      expect(await kindOf(api.get('/x'))).toBe('busy');
      advance(1);
    }
    await api.get('/x');
    expect(await kindOf(api.get('/x'))).toBe('busy');
    advance(9_999);
    expect(await kindOf(api.get('/x'))).toBe('busy');
    expect(fetch).toHaveBeenCalledTimes(8);
    advance(1);
    await api.get('/x');
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it('a blank Retry-After counts as missing (10 s), while 0 stays a 0 s pause', async () => {
    const a = setup([status(429, { 'retry-after': '  ' }), json({})]);
    expect(await kindOf(a.api.get('/x'))).toBe('busy');
    a.advance(9_999);
    expect(await kindOf(a.api.get('/x'))).toBe('busy');
    a.advance(1);
    await a.api.get('/x');
    expect(a.fetch).toHaveBeenCalledTimes(2);

    const b = setup([status(429, { 'retry-after': '0' }), json({})]);
    expect(await kindOf(b.api.get('/x'))).toBe('busy');
    await b.api.get('/x');
    expect(b.fetch).toHaveBeenCalledTimes(2);
  });

  it('429s that arrive together make one pause, and a shorter Retry-After never shortens it', async () => {
    const { api, fetch, advance } = setup([status(429), status(429), status(429, { 'retry-after': '1' }), status(429), json({})]);
    await Promise.all([api.get('/a').catch(() => 0), api.get('/b').catch(() => 0), api.get('/c').catch(() => 0)]);
    advance(9_999);
    expect(await kindOf(api.get('/x'))).toBe('busy');
    advance(1);
    expect(await kindOf(api.get('/x'))).toBe('busy');
    expect(fetch).toHaveBeenCalledTimes(4);
    advance(19_999);
    expect(await kindOf(api.get('/x'))).toBe('busy');
    advance(1);
    await api.get('/x');
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('pollMs doubles under 30% of the client budget, caps at 10 min, and returns to 60 s', async () => {
    const rate = (remaining: number) => ({
      headers: {
        'x-rate-limit-oauth2-client-id-remaining': String(remaining),
        'x-rate-limit-oauth2-client-id-max': '100',
      },
    });
    const { api } = setup([
      json({}, rate(29)),
      json({}, rate(10)),
      json({}, rate(5)),
      json({}, rate(5)),
      json({}, rate(5)),
      json({}, rate(5)),
      json({}, rate(30)),
      json({}),
    ]);
    expect(api.pollMs()).toBe(60_000);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await api.get('/x');
      seen.push(api.pollMs());
    }
    expect(seen).toEqual([120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
    await api.get('/x');
    expect(api.pollMs()).toBe(60_000);
    await api.get('/x');
    expect(api.pollMs()).toBe(60_000);
  });

  it('a response without rate headers leaves the interval unchanged', async () => {
    const { api } = setup([
      json({}, { headers: { 'x-rate-limit-oauth2-client-id-remaining': '1', 'x-rate-limit-oauth2-client-id-max': '100' } }),
      json({}),
    ]);
    await api.get('/x');
    await api.get('/x');
    expect(api.pollMs()).toBe(120_000);
  });

  it('a network failure is offline', async () => {
    const { api } = setup([new TypeError('fetch failed')]);
    expect(await kindOf(api.get('/x'))).toBe('offline');
  });

  it('a 404 is notFound', async () => {
    expect(await kindOf(setup([status(404)]).api.get('/x'))).toBe('notFound');
  });

  it('a 500 is http with the status in the message', async () => {
    const err = (await setup([status(500)]).api.get('/x').catch((e) => e)) as TrelloError;
    expect(err.kind).toBe('http');
    expect(err.message).toContain('500');
  });

  it('a 2xx body that is not JSON is http', async () => {
    expect(await kindOf(setup([new Response('<html>')]).api.get('/x'))).toBe('http');
  });

  it('a request that gets no answer in time is offline', async () => {
    // Answers only by honouring the abort signal.
    const hang = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    );
    const api = new TrelloApi({
      tokens: { accessToken: async () => 'tok1', refreshed: async () => 'tok2' },
      base: 'https://api.test',
      fetch: hang as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(await kindOf(api.get('/x'))).toBe('offline');
  });
});
