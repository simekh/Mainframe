/** Where the REST client gets its OAuth access token. */
export interface TrelloTokens {
  accessToken(): Promise<string>;
  /** A new access token, after Trello refused the current one. */
  refreshed(): Promise<string>;
}

export type TrelloErrorKind = 'auth' | 'notFound' | 'busy' | 'offline' | 'http';

export class TrelloError extends Error {
  constructor(
    readonly kind: TrelloErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'TrelloError';
  }
}

const BASE_POLL_MS = 60_000;
const MAX_POLL_MS = 600_000;
const LOW_BUDGET = 0.3;
const FIRST_PAUSE_MS = 10_000;
const MAX_PAUSE_MS = 120_000;
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Reads Trello's REST API. One instance serves every open project, so the pause
 * after a 429 and the poll interval are shared by all of them.
 */
export class TrelloApi {
  private readonly tokens: TrelloTokens;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private pausedUntil = 0;
  private nextPauseMs = FIRST_PAUSE_MS;
  private pollInterval = BASE_POLL_MS;

  constructor(deps: { tokens: TrelloTokens; base: string; fetch?: typeof fetch; now?: () => number; timeoutMs?: number }) {
    this.tokens = deps.tokens;
    this.base = deps.base;
    this.doFetch = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** 60_000, doubled per response under 30% client-id budget, at most 600_000; 60_000 again once a response is over it. */
  pollMs(): number {
    return this.pollInterval;
  }

  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    if (this.now() < this.pausedUntil) throw new TrelloError('busy', 'Trello is busy; retrying');
    const search = new URLSearchParams(query).toString();
    const url = `${this.base}${path}${search ? `?${search}` : ''}`;

    let response = await this.send(url, await this.token(() => this.tokens.accessToken()));
    if (response.status === 401) {
      response = await this.send(url, await this.token(() => this.tokens.refreshed()));
      // The refresh worked, so the sign-in is fine: this token just can't reach this resource.
      if (response.status === 401) throw new TrelloError('notFound', 'Trello refused access to that');
    }
    if (response.status === 429) {
      this.pause(response.headers.get('retry-after'));
      throw new TrelloError('busy', 'Trello is busy; retrying');
    }
    if (response.status === 404) throw new TrelloError('notFound', 'Trello could not find that');
    if (!response.ok) throw new TrelloError('http', `Trello answered ${response.status}`);
    this.nextPauseMs = FIRST_PAUSE_MS;
    try {
      return (await response.json()) as T;
    } catch {
      throw new TrelloError('http', 'Trello sent something that is not JSON');
    }
  }

  /** A TrelloError from the token side passes through (offline stays offline); anything else is auth. */
  private async token(fetchToken: () => Promise<string>): Promise<string> {
    try {
      return await fetchToken();
    } catch (e) {
      throw e instanceof TrelloError ? e : new TrelloError('auth', e instanceof Error ? e.message : String(e));
    }
  }

  private async send(url: string, token: string): Promise<Response> {
    let response: Response;
    try {
      // A timeout rejects as a fetch that can't reach Trello does.
      response = await this.doFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new TrelloError('offline', "Can't reach Trello");
    }
    this.readRateHeaders(response);
    return response;
  }

  private pause(retryAfter: string | null): void {
    const now = this.now();
    const seconds = Number(retryAfter);
    let ms: number;
    if (retryAfter?.trim() && Number.isFinite(seconds) && seconds >= 0) {
      ms = seconds * 1000;
    } else if (now < this.pausedUntil) {
      return; // another request already set this pause
    } else {
      ms = this.nextPauseMs;
      this.nextPauseMs = Math.min(ms * 2, MAX_PAUSE_MS);
    }
    this.pausedUntil = Math.max(this.pausedUntil, now + ms);
  }

  private readRateHeaders(response: Response): void {
    const remaining = Number(response.headers.get('x-rate-limit-oauth2-client-id-remaining'));
    const max = Number(response.headers.get('x-rate-limit-oauth2-client-id-max'));
    if (!response.headers.has('x-rate-limit-oauth2-client-id-remaining') || !(max > 0) || Number.isNaN(remaining)) return;
    this.pollInterval = remaining / max < LOW_BUDGET ? Math.min(this.pollInterval * 2, MAX_POLL_MS) : BASE_POLL_MS;
  }
}
