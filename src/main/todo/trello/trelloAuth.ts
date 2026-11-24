import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TrelloConnection } from '../../../shared/types';
import { writeJsonAtomic } from '../../tasks/taskStore';
import { openLoopback, PortsBusyError, type Loopback } from './oauthLoopback';
import { REQUEST_TIMEOUT_MS, TrelloError, type TrelloTokens } from './trelloApi';

/** Mainframe's public OAuth client: it has no secret, so the id is not one either. */
export const TRELLO_CLIENT_ID = '0o0bnFVq8ZOZ7mywBIx6P6GBwgbNmQDz';

const SCOPES = 'read:member:trello read:board:trello write:board:trello offline_access';
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Encryption for the stored tokens; null keeps them in memory only. */
export interface TokenCrypt {
  encrypt(text: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<{ text: string; stale: boolean }>;
}

interface Tokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthFile {
  version: 1;
  ownClientId?: string;
  sealed?: string;
}

/** A Connect failure whose message is shown to the user as is. */
class ConnectError extends Error {}

/**
 * Why the browser's answer is no good: a short reason for the tab, and the sentence for the panel. The loopback
 * passes on only an answer with this sign-in's state and a code or an error.
 */
function callbackProblem(p: URLSearchParams): { reason: string; error: string } | null {
  if (p.get('error') === 'access_denied') return { reason: 'access was not allowed', error: 'Trello access was not allowed.' };
  if (p.get('error')) return { reason: 'Trello sent an error', error: "Trello didn't sign you in; Connect again." };
  return null;
}

/**
 * Trello's OAuth 2.0 sign-in (public client, PKCE, loopback redirect) and its tokens. One instance serves
 * every open project, so a refresh is shared by all of them.
 */
export class TrelloAuth implements TrelloTokens {
  private readonly d: {
    file: string;
    /** Asked once, and only when a sealed sign-in is read or written: asking may show the Keychain's prompt. */
    crypt(): Promise<TokenCrypt | null>;
    authBase: string;
    apiBase: string;
    ports: number[];
    openExternal(url: string): Promise<void>;
    onChange(view: TrelloConnection): void;
    /** Whether this system could keep the sign-in only as readable text: known without asking the Keychain. */
    plainTextOnly?(): boolean;
  };
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly warn: (msg: string) => void;
  private crypt: Promise<TokenCrypt | null> | null = null;
  /** Whether the tokens are kept across restarts: true until the load finds plain text only, or the crypt is known to be none. */
  private remembers = true;
  private loading: Promise<void> | null = null;
  private isLoaded = false;

  private tokens: Tokens | null = null;
  private username: string | null = null;
  private needsReconnect = false;
  private connecting = false;
  private error: string | null = null;
  private ownClientId: string | null = null;

  /** Bumped by disconnect, so a Connect that started before it keeps nothing. */
  private epoch = 0;
  private pendingConnect: Promise<void> | null = null;
  private loopback: Loopback | null = null;
  private pendingRefresh: Promise<string> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    deps: TrelloAuth['d'] & { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; requestTimeoutMs?: number; warn?: (msg: string) => void },
  ) {
    this.d = deps;
    this.doFetch = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.warn = deps.warn ?? console.warn;
  }

  /** Reads the file and decrypts, then starts fetching the username without waiting for it (failure: it stays null). */
  load(): Promise<void> {
    this.loading = this.runLoad().finally(() => {
      this.isLoaded = true;
      this.emit();
    });
    return this.loading;
  }

  /** A load under way, done; its failure is the load's caller's to see. */
  private async loaded(): Promise<void> {
    await this.loading?.catch(() => undefined);
  }

  /** The crypt, asked for once; one that fails to come counts as none. */
  private cryptOf(): Promise<TokenCrypt | null> {
    this.crypt ??= this.d
      .crypt()
      .catch((err: unknown) => {
        this.warn(`Couldn't ask for the Keychain, so the Trello sign-in is not kept: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      })
      .then((crypt) => {
        if (!crypt) {
          this.remembers = false;
          this.emit();
        }
        return crypt;
      });
    return this.crypt;
  }

  private async runLoad(): Promise<void> {
    if (this.d.plainTextOnly?.()) this.remembers = false;
    let data: Partial<AuthFile>;
    try {
      data = JSON.parse(readFileSync(this.d.file, 'utf8')) as Partial<AuthFile>;
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('not an object');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('Trello sign-in file unreadable; starting clean');
      return;
    }
    this.ownClientId = typeof data.ownClientId === 'string' && data.ownClientId.trim() ? data.ownClientId.trim() : null;
    const crypt = typeof data.sealed === 'string' ? await this.cryptOf() : null;
    let stale = false;
    if (crypt) {
      try {
        const opened = await crypt.decrypt(Buffer.from(data.sealed!, 'base64'));
        const t = JSON.parse(opened.text) as Tokens;
        if (t.clientId === this.clientId() && typeof t.accessToken === 'string' && typeof t.refreshToken === 'string' && typeof t.expiresAt === 'number') {
          this.tokens = t;
          stale = opened.stale;
        }
      } catch {
        this.warn('Trello sign-in could not be decrypted; starting clean');
      }
    }
    if (stale) {
      // The sign-in still works from memory; the next save tries again.
      await this.save().catch((e: unknown) => this.warn(`Could not re-save the Trello sign-in: ${e instanceof Error ? e.message : String(e)}`));
    }
    void this.fetchUsername();
  }

  view(): TrelloConnection {
    return {
      loaded: this.isLoaded,
      connected: this.tokens !== null,
      username: this.username,
      needsReconnect: this.needsReconnect,
      connecting: this.connecting,
      remembers: this.remembers,
      ownClientId: this.ownClientId,
      error: this.error,
    };
  }

  /** Signs in through the browser, once a load under way is done. A second call while one waits returns the same promise. */
  connect(): Promise<void> {
    this.pendingConnect ??= this.connectAfterLoad();
    return this.pendingConnect;
  }

  private async connectAfterLoad(): Promise<void> {
    const epoch = this.epoch;
    const duringLoad = this.loading !== null && !this.isLoaded;
    await this.loaded();
    // A disconnect while the load ran has cancelled this Connect.
    if (epoch !== this.epoch) return;
    // The load found a sign-in: pressed before it showed, this Connect has nothing to do.
    if (duringLoad && this.tokens) {
      this.pendingConnect = null;
      return;
    }
    await this.runConnect();
  }

  /** Drops the tokens in memory and on disk, and cancels a pending Connect; keeps ownClientId. */
  async disconnect(): Promise<void> {
    this.epoch++;
    this.loopback?.close();
    this.loopback = null;
    this.pendingConnect = null;
    this.connecting = false;
    this.tokens = null;
    this.username = null;
    this.needsReconnect = false;
    this.error = null;
    this.emit();
    await this.save();
  }

  /** Trims; '' is null. A change disconnects, as tokens belong to one client id. */
  async setOwnClientId(id: string | null): Promise<void> {
    const next = id?.trim() || null;
    if (next === this.ownClientId) return;
    this.ownClientId = next;
    await this.disconnect();
  }

  /** Refreshes first when under a minute is left. Waits for a load under way, as do `refreshed` and `connect`. */
  async accessToken(): Promise<string> {
    await this.loaded();
    if (this.tokens && this.tokens.expiresAt - this.now() < REFRESH_MARGIN_MS) return this.refreshed();
    return this.current();
  }

  /** One refresh at a time; the new pair is saved before it resolves. */
  async refreshed(): Promise<string> {
    await this.loaded();
    this.pendingRefresh ??= this.refresh().finally(() => (this.pendingRefresh = null));
    return this.pendingRefresh;
  }

  /** The token of a Connect that replaced the one being refreshed; auth when disconnected meanwhile. */
  private current(): string {
    if (!this.tokens) throw new TrelloError('auth', 'Trello is not connected');
    return this.tokens.accessToken;
  }

  private clientId(): string {
    return this.ownClientId ?? TRELLO_CLIENT_ID;
  }

  private emit(): void {
    this.d.onChange(this.view());
  }

  private async refresh(): Promise<string> {
    const held = this.tokens;
    if (!held) throw new TrelloError('auth', 'Trello is not connected');
    let res: Response;
    try {
      res = await this.postToken({ grant_type: 'refresh_token', client_id: held.clientId, refresh_token: held.refreshToken });
    } catch {
      throw new TrelloError('offline', "Can't reach Trello");
    }
    if (this.tokens !== held) return this.current();
    if (res.status === 429) throw new TrelloError('busy', 'Trello is busy; retrying');
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // Atlassian answers a dead or rotated refresh token with 400, 401 or 403 invalid_grant.
      this.tokens = null;
      this.username = null;
      this.needsReconnect = true;
      this.emit();
      await this.save();
      throw new TrelloError('auth', 'Trello refused the sign-in');
    }
    if (!res.ok) throw new TrelloError('http', `Trello answered ${res.status}`);
    const next = await this.readTokens(res, held.clientId);
    if (!next) throw new TrelloError('http', "Trello's answer had no tokens");
    if (this.tokens !== held) return this.current();
    this.tokens = next;
    await this.save();
    return next.accessToken;
  }

  private async runConnect(): Promise<void> {
    const epoch = this.epoch;
    this.connecting = true;
    this.error = null;
    this.emit();
    let tokens: Tokens | null = null;
    try {
      tokens = await this.signIn(epoch);
    } catch (e) {
      if (epoch === this.epoch) this.error = e instanceof ConnectError ? e.message : "Couldn't connect to Trello; Connect again.";
    }
    if (epoch !== this.epoch) return; // disconnected meanwhile: it reset the view already
    this.pendingConnect = null;
    this.loopback = null;
    this.connecting = false;
    if (tokens) {
      this.tokens = tokens;
      this.username = null;
      this.needsReconnect = false;
    }
    this.emit();
    if (!tokens) return;
    await this.save();
    await this.fetchUsername();
  }

  /** The browser round trip and the code exchange; null when a disconnect cancelled it. */
  private async signIn(epoch: number): Promise<Tokens | null> {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('base64url');
    let loopback: Loopback;
    try {
      loopback = await openLoopback({
        ports: this.d.ports,
        timeoutMs: this.timeoutMs,
        state,
        page: (p) => {
          const problem = callbackProblem(p);
          return problem
            ? `<p>Mainframe didn't connect to Trello: ${problem.reason}. You can close this tab.</p>`
            : '<p>Mainframe is connected to Trello. You can close this tab.</p>';
        },
      });
    } catch (e) {
      if (!(e instanceof PortsBusyError)) throw e;
      const ports = this.d.ports;
      throw new ConnectError(`Ports ${ports[0]}–${ports[ports.length - 1]} are all in use. Close what uses them, then Connect again.`);
    }
    loopback.params.catch(() => undefined); // close() below rejects it on every early way out
    try {
      if (epoch !== this.epoch) return null;
      this.loopback = loopback;
      const clientId = this.clientId();
      const url = new URL(`${this.d.authBase}/authorize`);
      url.search = new URLSearchParams({
        client_id: clientId,
        scope: SCOPES,
        redirect_uri: loopback.redirectUri,
        response_type: 'code',
        prompt: 'consent',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
      }).toString();
      await this.d.openExternal(url.toString());

      let params: URLSearchParams;
      try {
        params = await loopback.params;
      } catch {
        if (epoch !== this.epoch) return null;
        throw new ConnectError(`No answer from the browser within ${Math.round(this.timeoutMs / 60_000)} minutes; Connect again.`);
      }
      const problem = callbackProblem(params);
      if (problem) throw new ConnectError(problem.error);

      let res: Response;
      try {
        res = await this.postToken({
          grant_type: 'authorization_code',
          client_id: clientId,
          code: params.get('code')!,
          redirect_uri: loopback.redirectUri,
          code_verifier: verifier,
        });
      } catch {
        throw new ConnectError("Can't reach Trello; Connect again.");
      }
      if (!res.ok) throw new ConnectError(`Trello refused the sign-in (HTTP ${res.status}); Connect again.`);
      const tokens = await this.readTokens(res, clientId);
      if (!tokens) throw new ConnectError("Trello's answer had no tokens; Connect again.");
      return tokens;
    } finally {
      loopback.close();
    }
  }

  private postToken(body: Record<string, string>): Promise<Response> {
    return this.doFetch(`${this.d.authBase}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A timeout rejects as a fetch that can't reach Trello does.
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  private async readTokens(res: Response, clientId: string): Promise<Tokens | null> {
    const b = (await res.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
    if (typeof b?.access_token !== 'string' || typeof b.refresh_token !== 'string' || typeof b.expires_in !== 'number') return null;
    return { clientId, accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt: this.now() + b.expires_in * 1000 };
  }

  /** "Connected as @username"; a failure leaves it null and is not an error. */
  private async fetchUsername(): Promise<void> {
    try {
      const token = await this.accessToken();
      // A disconnect or a new Connect while this runs makes its answer another sign-in's.
      const asked = this.tokens;
      const res = await this.doFetch(`${this.d.apiBase}/1/members/me?fields=username`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const body = res.ok ? ((await res.json()) as { username?: unknown }) : null;
      if (typeof body?.username !== 'string' || this.tokens !== asked) return;
      this.username = body.username;
      this.emit();
    } catch {
      // no username yet; the connection itself is fine
    }
  }

  /** Writes the current state; saves run one after another, so the last write holds the latest state. */
  private save(): Promise<void> {
    const run = this.saving.then(async () => {
      const crypt = this.tokens ? await this.cryptOf() : null;
      const data: AuthFile = { version: 1 };
      if (this.ownClientId) data.ownClientId = this.ownClientId;
      if (crypt && this.tokens) data.sealed = (await crypt.encrypt(JSON.stringify(this.tokens))).toString('base64');
      writeJsonAtomic(this.d.file, data);
    });
    this.saving = run.catch(() => undefined);
    return run;
  }
}
