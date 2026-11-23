import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrelloConnection } from '../../../shared/types';
import { TrelloError } from './trelloApi';
import { TRELLO_CLIENT_ID, TrelloAuth, type TokenCrypt } from './trelloAuth';

const NOW = 1_000_000_000;
const reverse = (s: string): string => [...s].reverse().join('');

/** Reverses the text; `stale` says what decrypt reports. `delayMs` makes encrypt slow. */
function fakeCrypt(o: { stale?: boolean; delayMs?: number } = {}): TokenCrypt {
  return {
    encrypt: async (text) => {
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      return Buffer.from(reverse(text));
    },
    decrypt: async (data) => ({ text: reverse(data.toString()), stale: o.stale ?? false }),
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const pair = (n: number) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600 });

interface Call {
  url: string;
  body: Record<string, string> | null;
  auth: string | null;
}

/** Answers the token endpoint with `token` and /1/members/me with @ada; records every call. */
function fakeFetch(token: (body: Record<string, string>) => Response | Promise<Response> = () => json(200, pair(1))) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : null;
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url, body, auth });
    if (url === 'https://auth.test/oauth/token') return token(body!);
    if (url === 'https://api.test/1/members/me?fields=username') return json(200, { username: 'ada' });
    return json(404, {});
  });
  return { fn: fn as unknown as typeof fetch, calls, tokenCalls: () => calls.filter((c) => c.url.endsWith('/oauth/token')) };
}

/** Plays the browser: reads the authorize URL and calls the loopback back. */
function browser(answer: (state: string) => string = (state) => `code=c1&state=${state}`) {
  const opened: URL[] = [];
  const pages: string[] = [];
  const openExternal = vi.fn(async (url: string) => {
    const u = new URL(url);
    opened.push(u);
    const redirect = u.searchParams.get('redirect_uri')!;
    void fetch(`${redirect}?${answer(u.searchParams.get('state')!)}`).then(async (r) => pages.push(await r.text()));
  });
  return { openExternal, opened, pages };
}

/** Listening on the port again proves it was released. */
async function expectFree(port: number): Promise<void> {
  const s = http.createServer();
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((r) => s.close(r));
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trello-auth-'));
  file = join(dir, 'trello-auth.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function make(o: {
  fetch?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  crypt?: TokenCrypt | null | (() => Promise<TokenCrypt | null>);
  timeoutMs?: number;
  requestTimeoutMs?: number;
  warn?: (msg: string) => void;
  now?: () => number;
  ports?: number[];
  plainTextOnly?: () => boolean;
}) {
  const views: TrelloConnection[] = [];
  const crypt = o.crypt === undefined ? fakeCrypt() : o.crypt;
  const auth = new TrelloAuth({
    file,
    crypt: typeof crypt === 'function' ? crypt : async () => crypt,
    requestTimeoutMs: o.requestTimeoutMs,
    authBase: 'https://auth.test',
    apiBase: 'https://api.test',
    ports: o.ports ?? [0],
    openExternal: o.openExternal ?? (async () => undefined),
    onChange: (v) => views.push(v),
    fetch: o.fetch ?? fakeFetch().fn,
    now: o.now ?? (() => NOW),
    timeoutMs: o.timeoutMs,
    warn: o.warn ?? (() => undefined),
    plainTextOnly: o.plainTextOnly,
  });
  return { auth, views };
}

interface Stored {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Writes a trello-auth.json the way TrelloAuth seals it with the fake crypt. */
function seed(t: Partial<Stored> = {}, ownClientId?: string): void {
  const tokens: Stored = { clientId: TRELLO_CLIENT_ID, accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt: NOW + 3_600_000, ...t };
  const sealed = Buffer.from(reverse(JSON.stringify(tokens))).toString('base64');
  writeFileSync(file, JSON.stringify({ version: 1, ownClientId, sealed }));
}

function readStored(): { raw: string; data: { version: number; ownClientId?: string; sealed?: string }; tokens: Stored | null } {
  const raw = readFileSync(file, 'utf8');
  const data = JSON.parse(raw) as { version: number; ownClientId?: string; sealed?: string };
  const tokens = data.sealed ? (JSON.parse(reverse(Buffer.from(data.sealed, 'base64').toString())) as Stored) : null;
  return { raw, data, tokens };
}

const portOf = (u: URL): number => Number(new URL(u.searchParams.get('redirect_uri')!).port);

describe('TrelloAuth connect', () => {
  it('connect opens the authorize URL with PKCE and the scopes', async () => {
    const b = browser();
    const { auth } = make({ openExternal: b.openExternal });
    await auth.connect();
    const u = b.opened[0];
    expect(`${u.origin}${u.pathname}`).toBe('https://auth.test/authorize');
    const q = u.searchParams;
    expect(q.get('client_id')).toBe(TRELLO_CLIENT_ID);
    expect(q.get('scope')).toBe('read:member:trello read:board:trello write:board:trello offline_access');
    expect(q.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).toBeTruthy();
  });

  it('exchanges the code with the verifier and no secret, then shows the username', async () => {
    const f = fakeFetch();
    const b = browser();
    const { auth, views } = make({ fetch: f.fn, openExternal: b.openExternal });
    await auth.connect();
    const [exchange] = f.tokenCalls();
    const { createHash } = await import('node:crypto');
    const challenge = createHash('sha256').update(exchange.body!.code_verifier).digest('base64url');
    expect(challenge).toBe(b.opened[0].searchParams.get('code_challenge'));
    expect(exchange.body).toEqual({
      grant_type: 'authorization_code',
      client_id: TRELLO_CLIENT_ID,
      code: 'c1',
      redirect_uri: b.opened[0].searchParams.get('redirect_uri'),
      code_verifier: exchange.body!.code_verifier,
    });
    const me = f.calls.find((c) => c.url.includes('/1/members/me'))!;
    expect(me.auth).toBe('Bearer access-1');
    expect(auth.view()).toEqual({
      loaded: false,
      connected: true,
      username: 'ada',
      needsReconnect: false,
      connecting: false,
      remembers: true,
      ownClientId: null,
      error: null,
    });
    expect(views.some((v) => v.connecting)).toBe(true);
    expect(views.at(-1)).toEqual(auth.view());
    expect(await auth.accessToken()).toBe('access-1');
    await vi.waitFor(() => expect(b.pages[0]).toContain('Mainframe is connected to Trello. You can close this tab.'));
  });

  it('a second connect while one waits opens the browser once', async () => {
    let answer!: () => void;
    const opened: string[] = [];
    const openExternal = vi.fn(async (url: string) => {
      opened.push(url);
      const u = new URL(url);
      answer = () => void fetch(`${u.searchParams.get('redirect_uri')}?code=c1&state=${u.searchParams.get('state')}`).then((r) => r.text());
    });
    const { auth } = make({ openExternal });
    const first = auth.connect();
    const second = auth.connect();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    answer();
    await first;
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(auth.view().connected).toBe(true);
  });

  it('consent refused, a wrong state and a timeout each say why and free the port', async () => {
    const cases: { answer?: (state: string) => string; timeoutMs?: number; error: RegExp; page?: string }[] = [
      { answer: (s) => `error=access_denied&state=${s}`, error: /^Trello access was not allowed\.$/, page: "Mainframe didn't connect to Trello:" },
      // The loopback ignores an answer with another state and waits on until the timeout.
      { answer: () => 'code=c1&state=wrong', timeoutMs: 300, error: /^No answer from the browser within \d+ minutes; Connect again\.$/ },
      { timeoutMs: 50, error: /^No answer from the browser within \d+ minutes; Connect again\.$/ },
    ];
    for (const c of cases) {
      const opened: URL[] = [];
      const pages: string[] = [];
      const openExternal = async (url: string): Promise<void> => {
        const u = new URL(url);
        opened.push(u);
        if (c.answer) void fetch(`${u.searchParams.get('redirect_uri')}?${c.answer(u.searchParams.get('state')!)}`).then(async (r) => pages.push(await r.text()));
      };
      const f = fakeFetch();
      const { auth } = make({ fetch: f.fn, openExternal, timeoutMs: c.timeoutMs });
      await auth.connect();
      expect(auth.view().error).toMatch(c.error);
      expect(auth.view().connected).toBe(false);
      expect(auth.view().connecting).toBe(false);
      expect(f.tokenCalls()).toHaveLength(0);
      if (c.page) await vi.waitFor(() => expect(pages[0]).toContain(c.page));
      await expectFree(portOf(opened[0]));
    }
  });

  it('says which ports are busy when none is free', async () => {
    const held = http.createServer();
    await new Promise<void>((r) => held.listen(0, '127.0.0.1', r));
    const port = (held.address() as { port: number }).port;
    try {
      const openExternal = vi.fn(async () => undefined);
      const { auth } = make({ ports: [port, port], openExternal });
      await auth.connect();
      expect(auth.view().error).toBe(`Ports ${port}–${port} are all in use. Close what uses them, then Connect again.`);
      expect(openExternal).not.toHaveBeenCalled();
    } finally {
      await new Promise((r) => held.close(r));
    }
  });

  it('the timeout message names the minutes of the default timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { auth } = make({});
      const done = auth.connect();
      await vi.waitFor(() => expect(auth.view().connecting).toBe(true));
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await done;
      expect(auth.view().error).toBe('No answer from the browser within 5 minutes; Connect again.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a token answer without tokens is a Connect error that keeps the old connection', async () => {
    seed();
    const f = fakeFetch(() => json(200, { access_token: 'x' }));
    const { auth } = make({ fetch: f.fn, openExternal: browser().openExternal });
    await auth.load();
    await auth.connect();
    expect(auth.view().error).toBe("Trello's answer had no tokens; Connect again.");
    expect(auth.view().connected).toBe(true);
    expect(await auth.accessToken()).toBe('access-0');
  });

  it('disconnect during a pending connect cancels it without an error', async () => {
    let opened: URL | undefined;
    const { auth } = make({ openExternal: async (url) => void (opened = new URL(url)) });
    const done = auth.connect();
    await vi.waitFor(() => expect(opened).toBeDefined());
    await auth.disconnect();
    await done;
    expect(auth.view()).toMatchObject({ connected: false, connecting: false, error: null });
    await expectFree(portOf(opened!));
  });

  it('a browser that fails to open is a Connect error and frees the port', async () => {
    let opened: URL | undefined;
    const { auth } = make({
      openExternal: async (url) => {
        opened = new URL(url);
        throw new Error('no browser');
      },
    });
    await auth.connect();
    expect(auth.view()).toMatchObject({ connected: false, connecting: false, error: "Couldn't connect to Trello; Connect again." });
    await expectFree(portOf(opened!));
  });

  it('a new connect after a refused refresh clears needsReconnect', async () => {
    seed();
    let refuse = true;
    const f = fakeFetch((body) => (body.grant_type === 'refresh_token' && refuse ? json(400, {}) : json(200, pair(1))));
    const { auth } = make({ fetch: f.fn, openExternal: browser().openExternal });
    await auth.load();
    await expect(auth.refreshed()).rejects.toMatchObject({ kind: 'auth' });
    refuse = false;
    await auth.connect();
    expect(auth.view()).toMatchObject({ connected: true, needsReconnect: false, error: null });
  });

  it('a save that fails still shows the connection, then rejects', async () => {
    const crypt: TokenCrypt = { ...fakeCrypt(), encrypt: () => Promise.reject(new Error('keychain locked')) };
    const { auth, views } = make({ crypt, openExternal: browser().openExternal });
    await expect(auth.connect()).rejects.toThrow('keychain locked');
    expect(views.at(-1)).toMatchObject({ connected: true, connecting: false });
  });

  it('the file holds no username', async () => {
    const { auth } = make({ openExternal: browser().openExternal });
    await auth.connect();
    expect(auth.view().username).toBe('ada');
    const { raw, tokens } = readStored();
    expect(raw).not.toContain('ada');
    expect(raw).not.toContain('access-1');
    expect(JSON.stringify(tokens)).not.toContain('ada');
    expect(tokens).toEqual({ clientId: TRELLO_CLIENT_ID, accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: NOW + 3_600_000 });
  });
});

describe('TrelloAuth tokens', () => {
  it('one refresh for concurrent callers', async () => {
    seed();
    let clock = NOW;
    const f = fakeFetch(() => json(200, pair(2)));
    const { auth } = make({ fetch: f.fn, now: () => clock });
    await auth.load();
    expect(f.tokenCalls()).toHaveLength(0);
    clock = NOW + 3_600_000 - 30_000;
    const tokens = await Promise.all([auth.accessToken(), auth.accessToken()]);
    expect(tokens).toEqual(['access-2', 'access-2']);
    expect(f.tokenCalls()).toHaveLength(1);
    expect(f.tokenCalls()[0].body).toEqual({ grant_type: 'refresh_token', client_id: TRELLO_CLIENT_ID, refresh_token: 'refresh-0' });
  });

  it('a refresh overtaken by a new connect answers with the new token', async () => {
    seed();
    let answer!: (r: Response) => void;
    const f = fakeFetch((body) => (body.grant_type === 'refresh_token' ? new Promise<Response>((r) => (answer = r)) : json(200, pair(5))));
    const { auth } = make({ fetch: f.fn, openExternal: browser().openExternal });
    await auth.load();
    const refreshing = auth.refreshed();
    await auth.connect();
    answer(json(400, {}));
    expect(await refreshing).toBe('access-5');
    expect(auth.view()).toMatchObject({ connected: true, needsReconnect: false });
  });

  it('saves the new pair before resolving the refresh', async () => {
    seed();
    const f = fakeFetch(() => json(200, pair(2)));
    const { auth } = make({ fetch: f.fn, crypt: fakeCrypt({ delayMs: 20 }) });
    await auth.load();
    const token = await auth.refreshed();
    expect(token).toBe('access-2');
    expect(readStored().tokens).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it.each([400, 401, 403])('a refused refresh (%i) sets needsReconnect and later calls reject auth', async (status) => {
    seed();
    const f = fakeFetch(() => json(status, { error: 'invalid_grant' }));
    const { auth, views } = make({ fetch: f.fn });
    await auth.load();
    await expect(auth.refreshed()).rejects.toMatchObject({ kind: 'auth' });
    expect(auth.view()).toMatchObject({ connected: false, needsReconnect: true });
    expect(views.at(-1)).toMatchObject({ needsReconnect: true });
    expect(readStored().data.sealed).toBeUndefined();
    await expect(auth.accessToken()).rejects.toBeInstanceOf(TrelloError);
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'auth' });
    await expect(auth.refreshed()).rejects.toMatchObject({ kind: 'auth' });
  });

  it.each([
    [503, 'http'],
    [408, 'http'],
    [429, 'busy'],
  ])('a refresh answered %i rejects %s and keeps the tokens', async (status, kind) => {
    seed();
    const f = fakeFetch(() => json(status, {}));
    const { auth } = make({ fetch: f.fn });
    await auth.load();
    await expect(auth.refreshed()).rejects.toMatchObject({ kind });
    expect(auth.view()).toMatchObject({ connected: true, needsReconnect: false });
    expect(readStored().tokens).toMatchObject({ refreshToken: 'refresh-0' });
  });

  it('a refresh that cannot reach Trello rejects offline and changes nothing', async () => {
    seed();
    const f = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const { auth } = make({ fetch: f.fn });
    await auth.load();
    const before = readFileSync(file, 'utf8');
    await expect(auth.refreshed()).rejects.toMatchObject({ kind: 'offline' });
    expect(auth.view()).toMatchObject({ connected: true, needsReconnect: false });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(await auth.accessToken()).toBe('access-0');
  });

  it('without crypt the tokens stay in memory and remembers is false', async () => {
    const { auth } = make({ crypt: null, openExternal: browser().openExternal });
    await auth.connect();
    expect(auth.view()).toMatchObject({ connected: true, remembers: false });
    expect(await auth.accessToken()).toBe('access-1');
    expect(readStored().data).toEqual({ version: 1 });
  });

  it('disconnect drops the tokens and keeps the own client id', async () => {
    seed({ clientId: 'mine' }, 'mine');
    const { auth } = make({});
    await auth.load();
    expect(auth.view()).toMatchObject({ connected: true, ownClientId: 'mine' });
    await auth.disconnect();
    expect(auth.view()).toMatchObject({ connected: false, username: null, ownClientId: 'mine' });
    expect(readStored().data).toEqual({ version: 1, ownClientId: 'mine' });
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('setOwnClientId changes the client id used and disconnects', async () => {
    seed();
    const b = browser();
    const { auth } = make({ openExternal: b.openExternal });
    await auth.load();
    await auth.setOwnClientId('  mine  ');
    expect(auth.view()).toMatchObject({ connected: false, ownClientId: 'mine' });
    await auth.connect();
    expect(b.opened[0].searchParams.get('client_id')).toBe('mine');
    expect(readStored().tokens?.clientId).toBe('mine');
    await auth.setOwnClientId('');
    expect(auth.view()).toMatchObject({ connected: false, ownClientId: null });
  });
});

describe('TrelloAuth load', () => {
  it('starts clean with no file, or a file it cannot read', async () => {
    const warn = vi.fn();
    const { auth } = make({ warn });
    await auth.load();
    expect(auth.view().connected).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    writeFileSync(file, '{not json');
    const { auth: broken } = make({ warn });
    await broken.load();
    expect(broken.view().connected).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(['null', '[]', '"x"', '7'])('starts clean when the file holds %s', async (content) => {
    writeFileSync(file, content);
    const warn = vi.fn();
    const { auth } = make({ warn });
    await auth.load();
    expect(auth.view()).toMatchObject({ connected: false, ownClientId: null });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('load drops tokens sealed under another client id', async () => {
    seed({ clientId: 'someone-else' });
    const { auth } = make({});
    await auth.load();
    expect(auth.view().connected).toBe(false);
  });

  it('load re-seals a stale decrypt', async () => {
    seed();
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), extra: true }));
    const { auth } = make({ crypt: fakeCrypt({ stale: true }) });
    await auth.load();
    await vi.waitFor(() => expect(auth.view()).toMatchObject({ connected: true, username: 'ada' }));
    const { data, tokens } = readStored();
    expect(data).not.toHaveProperty('extra');
    expect(tokens).toMatchObject({ accessToken: 'access-0', refreshToken: 'refresh-0' });
  });

  it('a load with no file never asks for the crypt', async () => {
    const crypt = vi.fn(async () => fakeCrypt());
    const { auth } = make({ crypt });
    await auth.load();
    await auth.disconnect();
    expect(crypt).not.toHaveBeenCalled();
    expect(auth.view().remembers).toBe(true);
  });

  it('a load with a sealed sign-in asks for the crypt once', async () => {
    seed();
    const crypt = vi.fn(async () => fakeCrypt());
    const f = fakeFetch(() => json(200, pair(2)));
    const { auth } = make({ crypt, fetch: f.fn });
    await auth.load();
    await auth.refreshed();
    expect(readStored().tokens).toMatchObject({ accessToken: 'access-2' });
    expect(crypt).toHaveBeenCalledOnce();
  });

  it('remembers turns false once the crypt is known to be none', async () => {
    seed();
    const { auth, views } = make({ crypt: null });
    expect(auth.view().remembers).toBe(true);
    await auth.load();
    expect(auth.view()).toMatchObject({ connected: false, remembers: false });
    expect(views.at(-1)).toMatchObject({ remembers: false });
  });

  it('loaded turns true once the load is done, with or without a file', async () => {
    const { auth, views } = make({});
    expect(auth.view().loaded).toBe(false);
    await auth.load();
    expect(views.at(-1)).toMatchObject({ loaded: true, connected: false });
    seed();
    const { auth: sealed, views: sealedViews } = make({});
    await sealed.load();
    expect(sealedViews.at(-1)).toMatchObject({ loaded: true, connected: true });
  });

  it('a system that could keep the sign-in only as plain text shows remembers false at load, asking no crypt', async () => {
    const crypt = vi.fn(async () => null);
    const { auth, views } = make({ crypt, plainTextOnly: () => true });
    await auth.load();
    expect(views.at(-1)).toMatchObject({ loaded: true, remembers: false });
    expect(crypt).not.toHaveBeenCalled();
  });

  it('a crypt that fails to come warns and counts as none', async () => {
    seed();
    const warn = vi.fn();
    const { auth } = make({ warn, crypt: () => Promise.reject(new Error('keychain check failed')) });
    await auth.load();
    expect(auth.view()).toMatchObject({ connected: false, remembers: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('keychain check failed'));
  });

  it('a Connect during a slow load that finds a sign-in opens no browser', async () => {
    seed();
    let give!: (c: TokenCrypt) => void;
    const openExternal = vi.fn(async () => undefined);
    const { auth } = make({ openExternal, crypt: () => new Promise<TokenCrypt>((r) => (give = r)) });
    const loading = auth.load();
    const connecting = auth.connect();
    await vi.waitFor(() => expect(give).toBeDefined());
    give(fakeCrypt());
    await loading;
    await connecting;
    expect(openExternal).not.toHaveBeenCalled();
    expect(auth.view()).toMatchObject({ connected: true, connecting: false });
    // A later Connect is a new one, not the one skipped.
    expect(auth.connect()).not.toBe(connecting);
    await auth.disconnect();
  });

  it('accessToken during a slow load waits for it, then answers with the token', async () => {
    seed();
    let give!: (c: TokenCrypt) => void;
    const { auth } = make({ crypt: () => new Promise<TokenCrypt>((r) => (give = r)) });
    const loading = auth.load();
    const token = auth.accessToken();
    await vi.waitFor(() => expect(give).toBeDefined());
    give(fakeCrypt());
    await loading;
    expect(await token).toBe('access-0');
  });

  it('a re-seal that fails warns that it could not re-save, and keeps the sign-in', async () => {
    seed();
    const warn = vi.fn();
    const crypt: TokenCrypt = {
      ...fakeCrypt({ stale: true }),
      encrypt: async () => {
        throw new Error('keychain locked');
      },
    };
    const { auth } = make({ warn, crypt });
    await auth.load();
    expect(auth.view().connected).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not re-save the Trello sign-in'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('could not be decrypted'));
  });

  it("a username that comes back after a reconnect is not shown for the new sign-in", async () => {
    seed();
    let answerOld!: (r: Response) => void;
    const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://auth.test/oauth/token') return json(200, pair(1));
      const auth = new Headers(init?.headers).get('authorization');
      if (auth === 'Bearer access-0') return new Promise<Response>((r) => (answerOld = r));
      return json(200, { username: 'bob' });
    }) as unknown as typeof fetch;
    const b = browser();
    const { auth } = make({ fetch: f, openExternal: b.openExternal });
    await auth.load();
    await vi.waitFor(() => expect(answerOld).toBeDefined());
    await auth.disconnect();
    await auth.connect();
    expect(auth.view().username).toBe('bob');
    answerOld(json(200, { username: 'ada' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(auth.view().username).toBe('bob');
  });

  it('a load does not wait for the username', async () => {
    seed();
    let answer!: (r: Response) => void;
    const fetchFn = vi.fn(() => new Promise<Response>((r) => (answer = r))) as unknown as typeof fetch;
    const { auth } = make({ fetch: fetchFn });
    await auth.load();
    expect(auth.view()).toMatchObject({ connected: true, username: null });
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer(json(200, { username: 'ada' }));
    await vi.waitFor(() => expect(auth.view().username).toBe('ada'));
  });

  it('a token request that times out rejects offline', async () => {
    seed();
    // Answers only by honouring the abort signal.
    const hang = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    ) as unknown as typeof fetch;
    const { auth } = make({ fetch: hang, requestTimeoutMs: 20 });
    await auth.load();
    await expect(auth.refreshed()).rejects.toMatchObject({ kind: 'offline' });
    expect(auth.view()).toMatchObject({ connected: true, needsReconnect: false });
  });
});
