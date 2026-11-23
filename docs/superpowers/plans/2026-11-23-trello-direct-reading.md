# Trello direct reading (part 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Trello project's Todo panel reads its list straight from Trello's REST API, signed in once per Mainframe with OAuth 2.0, in about a second and at no model cost; every other tracker keeps today's agent sync.

**Architecture:** One app-wide `TrelloAuth` (sign-in, tokens) and one `TrelloApi` (fetch, rate limits) live in `src/main/todo/trello/`, made in `start()` before the projects open. Each project's `TodoService` keeps `sync()` as its single seam: with a Trello pick in `todo.json` (now version 2) it reads the list through `trelloSource.ts`; without one it runs today's agent sync unchanged. The renderer owns the poll timer (it knows whether the panel shows and the window has focus); main owns the back-off and tells the renderer the interval through the view.

**Tech Stack:** Electron 44.11.4 (`safeStorage` async API, `shell.openExternal`), Node's built-in `fetch` and `node:http`, zod 4, Solid 1.9, vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-11-23-mainframe-trello-direct-design.md` (§6, and the part 1 bits of §9–§11). Card #30.

## Global Constraints

- Project-agnostic: no board, list or label name in code, prompts, defaults or UI copy; Mainframe suggests no list or label by name. The owner picks.
- Several projects at once: one Trello sign-in for the app; each project keeps its own pick, view and poll. Two projects on one board work. Every IPC call that is a project's names it by folder.
- No Trello secret, key or token in the source. The public client id `cjmiq05mPFq8nq2NbdTU5En5PgRfxFAv` is a constant in `trelloAuth.ts`.
- Scope, asked at Connect: `read:member:trello read:board:trello write:board:trello offline_access`. Authorize `https://auth.atlassian.com/authorize`, token `https://auth.atlassian.com/oauth/token`, API `https://api.trello.com`. `prompt=consent`, `response_type=code`, PKCE S256, random `state`.
- Loopback: `127.0.0.1`, path `/callback`, ports 33333, 33334, 33335 (first free), one-shot, 5-minute timeout. System browser only (`shell.openExternal`), never a webview.
- Tokens: access 1 h, refresh 90 days and single-use. Refresh when under 60 s left or on a 401; one refresh at a time app-wide; write the new pair to disk before using it.
- Polling: 60 s while that project's Todo panel is open and the window is visible and focused; also at panel open, window focus, and the refresh button. Under 30% of `x-rate-limit-oauth2-client-id-max` remaining, the interval doubles up to 10 min, back to 60 s once recovered. A 429 stops every Trello call of this Mainframe for `Retry-After` seconds, else 10 s doubling to 2 min.
- The agent path is untouched: its tests pass unchanged, and a project with no Trello pick behaves exactly as today.
- No Trello member data kept on disk (GDPR call, see Task 0): `trello-auth.json` holds tokens and the own client id only; the username is fetched at start and held in memory.
- Newest versions only; no fallbacks for old Electron or Node. Each renderer task uses the `frontend-design:frontend-design` skill and matches the panel's current look.
- `CHANGELOG.md`: one `New:` line under `## Unreleased` (Task 11).

## Review Focus

1. **Refresh race across projects:** two projects poll as the access token expires; exactly one refresh request goes out and both reads use its token (Task 5 test `one refresh for concurrent callers`).
2. **A read that lands late:** Set up again, Use this with another list, or the project's close while a Trello read is in flight; the late answer changes nothing (Task 7 test `drops a read that finished after the source changed`).
3. **Old tasks' card ids:** a task started under the agent sync holds `ari:cloud:trello::card/workspace/<ws>/<hex>`; the first Trello read gives `<hex>`. Start continues that task, the list shows Reopen/Continue, the board ranks it, and a put-back task stays put back (Task 2 tests, and Task 7 `keeps an old put-back task put back`).
4. **The browser asks for more than `/callback`:** a favicon request, a consent refusal (`error=access_denied`), a wrong `state`, a second Connect click while one waits; none of them crash, hang or leave a port open (Task 4 and Task 5 tests).
5. **A 429 while several projects poll:** the pause is app-wide, polls during it make no request and show "Trello is busy; retrying" (Task 3 test `pauses every call after a 429`, Task 7 test `busy and offline are notices`).

---

### Task 0: Prepare and pin the open facts (controller, before any dispatch)

Done by the main session, not a subagent. It needs the owner for one click.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-mainframe-trello-direct-design.md` (§11: record what this task settles)
- Modify: this plan's "Confirmed shapes" note below

- [ ] **Step 1:** `npm --prefix <worktree> install --include=dev --no-save --no-audit --no-fund`, then `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: both pass on the untouched branch.
- [ ] **Step 2:** Extend the throwaway probe (`/private/tmp/claude-501/-Users-simonekholm-Developer-Simmesolo-Mainframe/2f7f44b1-0e21-4275-ae0a-6d8a516a15bf/scratchpad/oauth-probe/trello-oauth-probe.mjs`) to call, after the code exchange, exactly the requests Task 6 makes, on the owner's Mainframe board and its TODO list, and print only status, rate headers, array length and the key names (top level, `labels[0]`, `checklists[0]`, `checklists[0].checkItems[0]`). It prints no card text, name or token. Ask the owner to click Allow on Trello's consent page, then run it.
  - `GET /1/members/me?fields=username,fullName`
  - `GET /1/members/me/boards?filter=open&fields=name,url`
  - `GET /1/boards/{boardId}/lists?fields=name,pos&filter=open`
  - `GET /1/boards/{boardId}/labels?fields=name,color&limit=1000`
  - `GET /1/lists/{listId}/cards?fields=id,idShort,name,desc,labels,pos,shortUrl&checklists=all&checklist_fields=name,pos`
  Expected: all 200; cards carry `checklists[].checkItems[]` with `name`, `state` (`complete`|`incomplete`), `pos`. If a parameter is ignored or refused, fix it here and in Task 6 before dispatch.
- [ ] **Step 3:** Record in spec §11 and commit (Markdown only, no gate):
  - Electron 44.11.4 has `safeStorage.encryptStringAsync`, `decryptStringAsync` (resolves `{ shouldReEncrypt, result }`), `isAsyncEncryptionAvailable`, `getSelectedStorageBackend` (checked in `electron.d.ts`).
  - **Change check dropped:** it costs one request a minute, as the list read does, and the rate limit counts requests, so each poll reads the list itself. Simpler, and no doubt about which edits move `dateLastActivity`.
  - **GDPR:** Trello's guide applies to public apps that store personal data outside Trello for more than 14 days, and its polling needs a confidential client, which an open-source desktop app can't hold. Mainframe keeps no member data on disk (username in memory only); card text is the board's content, kept as today's agent sync keeps it. The owner hears this in the hand-over.
  - **Revoke:** no OAuth 2.0 revoke endpoint is documented. Disconnect deletes the local tokens and says the grant can be revoked under Connected apps in the Atlassian account.
- [ ] **Step 4:** Confirmed shapes (fill from Step 2): _to be filled_.

---

### Task 1: Shared types and one card-key helper

**Files:**
- Modify: `src/shared/types.ts` (add `TrelloConnection`, `TrelloPick`, `TrelloBoardRef`, `TrelloBoardChoices`; extend `TodoView`)
- Create: `src/shared/cardKey.ts`
- Modify: `src/renderer/src/todo/todoItems.ts:31-33`, `src/renderer/src/board/lanes.ts:118-121`, `src/main/tasks/taskService.ts:457`, `src/main/todo/todoService.ts:239,266,461`
- Test: `src/shared/cardKey.test.ts`, `src/renderer/src/todo/todoItems.test.ts`, `src/renderer/src/board/lanes.test.ts`, `src/main/todo/todoService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TrelloConnection {
    connected: boolean;          // tokens held (in memory or on disk)
    username: string | null;     // null until /members/me answered
    needsReconnect: boolean;     // a refresh failed: every Trello project shows Reconnect
    connecting: boolean;         // a Connect waits for the browser
    remembers: boolean;          // tokens are kept on disk (false: Linux basic_text, or no encryption)
    ownClientId: string | null;  // "Use my own Trello app"
    error: string | null;        // why the last Connect failed
  }
  export interface TrelloPick {
    boardId: string; boardName: string; boardUrl: string;
    listId: string; listName: string;
    inProgressListId: string | null;   // used from part 2
    mineLabelIds: string[];            // forOwner
    urgentLabelIds: string[];          // urgent
  }
  export interface TrelloBoardRef { id: string; name: string; url: string }
  export interface TrelloBoardChoices { lists: { id: string; name: string }[]; labels: { id: string; name: string; color: string | null }[] }
  // TodoView gains:
  sourceKind: 'agent' | 'trello';
  /** How often the panel polls a Trello list; null for the agent source. */
  pollMs: number | null;
  /** A quiet line under the source (offline, Trello busy); the list stays. */
  notice: string | null;
  ```
  `cardKey(id: string): string`: Trello's own id from an agent-sync ARI (`ari:cloud:trello::card/…/<hex>` → `<hex>`), any other id unchanged. Only that ARI prefix is stripped, so another tracker's id with a `/` stays whole.

- [ ] **Step 1: Write the failing tests**
  - `cardKey.test.ts`: `cardKey('ari:cloud:trello::card/workspace/60c1/6b03f0975d81')` → `'6b03f0975d81'`; `cardKey('6b03f0975d81')` → same; `cardKey('owner/repo#12')` → `'owner/repo#12'`; `cardKey('c128')` → `'c128'`.
  - `todoItems.test.ts` `a task started from the ARI id matches the bare card id`: task with `card.id` ARI and place `finished`, view card id `<hex>` → the item's action is `{ kind: 'continue', taskId }`.
  - `lanes.test.ts` `ranks a task by its card when the ids differ only by the ARI prefix`.
  - `todoService.test.ts` `startItem continues the finished task whose card id is the ARI form`.
- [ ] **Step 2:** `npx vitest run src/shared/cardKey.test.ts src/renderer/src/todo/todoItems.test.ts src/renderer/src/board/lanes.test.ts src/main/todo/todoService.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Add the types; set `sourceKind: 'agent'`, `pollMs: null`, `notice: null` in `TodoService.view()` for now; compare by `cardKey` at all six sites (including `apply`'s put-back sweep at `todoService.ts:461` and `taskOfCard`).
- [ ] **Step 4:** Run the same command, then `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `Todo: match a task to its card by Trello's own id (#30)`.

### Task 2: `todo.json` version 2 with the Trello pick

**Files:**
- Modify: `src/main/todo/todoSchema.ts` (add `TRELLO_PICK`), `src/main/todo/todoFile.ts`
- Test: `src/main/todo/todoFile.test.ts`

**Interfaces:**
- Produces: `TRELLO_PICK` (zod, `satisfies z.ZodType<TrelloPick>`); `TodoRecord` gains `trello?: TrelloPick`; `VERSION = 2`.

- [ ] **Step 1: Write the failing tests**
  - `reads a version 1 file as the agent source, notes and cards intact`: a v1 file with `readTools`, `pickedList`, cards and notes loads with `version: 2`, the same fields, no `trello`, and no `.bad-` file next to it.
  - `keeps a Trello pick across a save and a load`.
  - `a version 3 file throws NewerTodoError` (the message names version 2 as what this one reads).
  - `a version 2 file with a malformed pick is set aside` (e.g. `mineLabelIds: 'x'`).
- [ ] **Step 2:** `npx vitest run src/main/todo/todoFile.test.ts` → FAIL.
- [ ] **Step 3:** `RECORD` v2 = v1's fields plus `trello: TRELLO_PICK.optional()`; `loadTodo` parses `version === 1` with the v1 schema and returns it as `{ ...v1, version: 2 }`; `saveTodo` writes v2.
- [ ] **Step 4:** Same command, then `npm test` → PASS.
- [ ] **Step 5:** Commit `Todo: todo.json version 2 keeps a Trello pick (#30)`.

### Task 3: `TrelloApi`, the REST client with rate-limit back-off

**Files:**
- Create: `src/main/todo/trello/trelloApi.ts`
- Test: `src/main/todo/trello/trelloApi.test.ts`

**Interfaces:**
- Consumes: `TrelloTokens` (implemented by `TrelloAuth`, Task 5).
- Produces:
  ```ts
  export interface TrelloTokens { accessToken(): Promise<string>; refreshed(): Promise<string> }
  export type TrelloErrorKind = 'auth' | 'notFound' | 'busy' | 'offline' | 'http';
  export class TrelloError extends Error { constructor(readonly kind: TrelloErrorKind, message: string) }
  export class TrelloApi {
    constructor(deps: { tokens: TrelloTokens; base: string; fetch?: typeof fetch; now?: () => number });
    get<T>(path: string, query?: Record<string, string>): Promise<T>;
    /** 60_000, doubled per response under 30% client-id budget, at most 600_000; 60_000 again once a response is over it. */
    pollMs(): number;
  }
  ```
  Requests send only `Authorization: Bearer <token>`. A 401 gets one `refreshed()` and one retry; a second 401, or a `refreshed()` that throws, is `TrelloError('auth')`. 404 → `notFound`. 429 → `busy` and an app-wide pause (`Retry-After` seconds, else 10 s doubling to 120 s, reset by the next 2xx). While paused, `get` rejects with `busy` without calling `fetch`. A `fetch` rejection → `offline`. Other non-2xx → `http` with the status in the message.

- [ ] **Step 1: Write the failing tests** (fake `fetch` returning `Response` objects, fake `now`)
  - `sends the bearer token and the query` (URL is `${base}/1/lists/L/cards?fields=a`).
  - `refreshes once on a 401 and retries with the new token`.
  - `a second 401 is an auth error`.
  - `pauses every call after a 429` (Retry-After 3 → calls before `now+3000` reject `busy` with no fetch; after, fetch again).
  - `without Retry-After the pause grows 10 s, 20 s … 120 s and resets after a success`.
  - `pollMs doubles under 30% of the client budget, caps at 10 min, and returns to 60 s` (headers `x-rate-limit-oauth2-client-id-remaining` / `-max`).
  - `a network failure is offline`, `a 404 is notFound`, `a 500 is http`.
- [ ] **Step 2:** `npx vitest run src/main/todo/trello/trelloApi.test.ts` → FAIL.
- [ ] **Step 3:** Implement as the interface says.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Trello: a REST client that backs off on rate limits (#30)`.

### Task 4: The one-shot OAuth loopback

**Files:**
- Create: `src/main/todo/trello/oauthLoopback.ts`
- Test: `src/main/todo/trello/oauthLoopback.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class PortsBusyError extends Error {}
  export interface Loopback { redirectUri: string; params: Promise<URLSearchParams>; close(): void }
  /** Listens on 127.0.0.1 at the first free port of `ports` (0 = any, for e2e). `params` resolves with the first
   *  /callback request's query, rejects after timeoutMs; any other path gets 404 and is ignored. */
  export function openLoopback(o: { ports: number[]; timeoutMs: number; page: (params: URLSearchParams) => string }): Promise<Loopback>;
  ```
  The server closes after the callback, on timeout, and on `close()`. It answers the callback with `page(params)` as `text/html; charset=utf-8`.

- [ ] **Step 1: Write the failing tests** (real `node:http`, port 0 and a port the test holds)
  - `takes the next port when the first is taken`.
  - `rejects with PortsBusyError when every port is taken`.
  - `ignores /favicon.ico and resolves with the callback's query`, and the port is free afterwards.
  - `rejects after the timeout and frees the port` (timeoutMs 50).
  - `close() before the callback rejects params and frees the port`.
- [ ] **Step 2:** `npx vitest run src/main/todo/trello/oauthLoopback.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Trello: a one-shot loopback for the OAuth redirect (#30)`.

### Task 5: `TrelloAuth`: Connect, tokens, refresh, Disconnect

Review row: auth and concurrency (Opus, high).

**Files:**
- Create: `src/main/todo/trello/trelloAuth.ts`
- Test: `src/main/todo/trello/trelloAuth.test.ts`

**Interfaces:**
- Consumes: `openLoopback`, `PortsBusyError` (Task 4); `TrelloTokens` (Task 3).
- Produces:
  ```ts
  export const TRELLO_CLIENT_ID = 'cjmiq05mPFq8nq2NbdTU5En5PgRfxFAv';
  export const TRELLO_PORTS = [33333, 33334, 33335];
  /** Encryption for the stored tokens; null keeps them in memory only. */
  export interface TokenCrypt { encrypt(text: string): Promise<Buffer>; decrypt(data: Buffer): Promise<{ text: string; stale: boolean }> }
  export class TrelloAuth implements TrelloTokens {
    constructor(deps: {
      file: string;                 // <dataDir>/trello-auth.json
      crypt: TokenCrypt | null;
      authBase: string;             // https://auth.atlassian.com
      apiBase: string;              // https://api.trello.com
      ports: number[];
      openExternal(url: string): Promise<void>;
      onChange(view: TrelloConnection): void;
      fetch?: typeof fetch; now?: () => number; timeoutMs?: number;  // timeoutMs default 5 min
    });
    load(): Promise<void>;          // reads the file, decrypts, then fetches the username (failure: username stays null)
    view(): TrelloConnection;
    connect(): Promise<void>;       // a second call while one waits returns the same promise
    disconnect(): Promise<void>;    // drops tokens in memory and on disk, keeps ownClientId
    setOwnClientId(id: string | null): Promise<void>;  // trims; '' = null; a change disconnects
    accessToken(): Promise<string>; // refreshes first when under 60 s left; TrelloError('auth') when not connected or needsReconnect
    refreshed(): Promise<string>;   // one refresh at a time; saves the new pair, then resolves
  }
  ```
  File: `{ version: 1, ownClientId?: string, sealed?: string }`, `sealed` = base64 of `crypt.encrypt(JSON.stringify({ clientId, accessToken, refreshToken, expiresAt }))`. With `crypt` null nothing sealed is written and `remembers` is false. A `stale` decrypt re-seals and saves. Tokens sealed under another client id than the current one are dropped at load. Token requests are JSON `POST {authBase}/oauth/token`: `{ grant_type: 'authorization_code', client_id, code, redirect_uri, code_verifier }` and `{ grant_type: 'refresh_token', client_id, refresh_token }`, never a secret. A refresh answered 400 or 401 sets `needsReconnect`, keeps nothing, and rejects `TrelloError('auth')`; a network failure rejects `offline` and changes nothing. The callback page says "Mainframe is connected to Trello. You can close this tab." or "Mainframe didn't connect to Trello: <reason>. You can close this tab."
  Connect errors in `view().error`: ports busy → "Ports 33333–33335 are all in use. Close what uses them, then Connect again." (built from `ports`); `error=access_denied` → "Trello access was not allowed."; wrong `state` → "The sign-in answer didn't match; Connect again."; timeout → "No answer from the browser within 5 minutes; Connect again.".

- [ ] **Step 1: Write the failing tests** (fake `fetch` for the token and `/1/members/me` calls; a fake `openExternal` that reads `redirect_uri` and `state` from the URL and requests the loopback with `node:http`; a fake `TokenCrypt` that reverses the text; `ports: [0]`)
  - `connect opens the authorize URL with PKCE and the scopes` (asserts `client_id`, `scope`, `redirect_uri`, `response_type=code`, `prompt=consent`, `code_challenge_method=S256`, a 43-char `code_challenge`, `state`).
  - `exchanges the code with the verifier and no secret, then shows the username`.
  - `a second connect while one waits opens the browser once`.
  - `consent refused, a wrong state and a timeout each say why and free the port`.
  - `one refresh for concurrent callers` (two `accessToken()` calls with 30 s left → one refresh request; both get the new token).
  - `saves the new pair before resolving the refresh` (the file holds it when the promise resolves).
  - `a refused refresh sets needsReconnect and later calls reject auth`.
  - `without crypt the tokens stay in memory and remembers is false`.
  - `disconnect drops the tokens and keeps the own client id`; `setOwnClientId changes the client id used and disconnects`.
  - `load drops tokens sealed under another client id`; `load re-seals a stale decrypt`.
  - `the file holds no username`.
- [ ] **Step 2:** `npx vitest run src/main/todo/trello/trelloAuth.test.ts` → FAIL.
- [ ] **Step 3:** Implement; PKCE with `node:crypto` (`randomBytes(32)` base64url verifier, SHA-256 challenge), `state` `randomBytes(16)`; write the file with `writeJsonAtomic` from `src/main/tasks/taskStore.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Trello: sign in with OAuth 2.0 and keep the tokens encrypted (#30)`.

### Task 6: `trelloSource.ts`, reading and mapping

**Files:**
- Create: `src/main/todo/trello/trelloSource.ts`
- Test: `src/main/todo/trello/trelloSource.test.ts`

**Interfaces:**
- Consumes: `TrelloApi.get` (Task 3); the request paths and fields Task 0 confirmed.
- Produces:
  ```ts
  export function readList(api: Pick<TrelloApi, 'get'>, pick: TrelloPick): Promise<{ source: TodoSource; cards: TodoCard[] }>;
  export function listBoards(api: Pick<TrelloApi, 'get'>): Promise<TrelloBoardRef[]>;
  export function boardChoices(api: Pick<TrelloApi, 'get'>, boardId: string): Promise<TrelloBoardChoices>;
  ```
  Mapping: `id` = Trello id; `number` = `#${idShort}`; `title` = `name`; `description` = `desc`; `labels` = each label's name, else its colour, else left out; `checklists` by `pos`, items by `pos`, `{ text: name, done: state === 'complete' }`; `url` = `shortUrl`; `forOwner` = any label id in `mineLabelIds`; `urgent` = any in `urgentLabelIds`. Cards sorted by `pos`. Source `{ kind: 'Trello', board: boardName, list: listName, url: boardUrl }`. Path segments are `encodeURIComponent`-ed.

- [ ] **Step 1: Write the failing tests** (a fake `get` recording path and query, answering fixtures with the Task 0 shapes)
  - `reads the list with its checklists in one request` (path and query as in Task 0 Step 2).
  - `maps a card` (number, url, description, a checklist with one complete item).
  - `names a label by its colour when it has no name, and leaves out one with neither`.
  - `marks forOwner and urgent by label id, not name`.
  - `orders cards, checklists and items by pos`.
  - `listBoards` and `boardChoices` paths, queries and shapes.
- [ ] **Step 2:** `npx vitest run src/main/todo/trello/trelloSource.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Trello: read a list into the Todo panel's cards (#30)`.

### Task 7: `TodoService` reads Trello through `sync()`

Review row: concurrency (Opus, high).

**Files:**
- Modify: `src/main/todo/todoService.ts`
- Modify: `src/main/mcp/managerTools.ts:84` (`sync_todo`'s description: "reads the owner's to-do list, from Trello directly or through their connector"; no other change)
- Test: `src/main/todo/todoService.test.ts`, `src/main/mcp/managerTools.test.ts` if it pins the description

**Interfaces:**
- Consumes: `TrelloError` (Task 3), `TrelloPick`, record v2 (Task 2).
- Produces:
  ```ts
  export interface TrelloReader { read(pick: TrelloPick): Promise<{ source: TodoSource; cards: TodoCard[] }>; pollMs(): number }
  // TodoServiceDeps gains: trello: TrelloReader;
  sync(opts?: { quiet?: boolean }): Promise<SyncOutcome>;  // quiet: no `syncing` in the view (polls)
  useTrello(pick: TrelloPick): Promise<SyncOutcome>;       // saves the pick, drops readTools and pickedList, clears ask and error, reads
  ```
  With `record.trello` set, `sync` reads through `deps.trello.read` instead of an agent run: a call while a read runs joins it; a non-quiet read sets `syncing` while it runs. Success saves `source`, `cards`, `syncedAt` and runs the same put-back sweep as `apply` (share that code, don't copy it), clears `error` and `notice`. Errors: `notFound` → `error` "This list is gone or you no longer have access. Set up again to pick another." (the list stays); `offline` → `notice` "Offline; showing the last copy"; `busy` → `notice` "Trello is busy; retrying"; `auth` → outcome `{ error: 'Reconnect Trello in Settings' }` with neither `error` nor `notice` set (the panel shows Reconnect from the connection); `http` → `error` with its message. A generation number, bumped by `useTrello`, `resetSource` and `close`, drops a read that finishes after it changed. `resetSource` also drops `trello`. `view()` gives `sourceKind: record.trello ? 'trello' : 'agent'`, `pollMs: record.trello ? deps.trello.pollMs() : null`, `notice`, and `setUp: true` with a pick. `cancel`, `keepSyncing`, the asks and the agent path are untouched.

- [ ] **Step 1: Write the failing tests** (a fake `TrelloReader` with settle-able promises)
  - `with a Trello pick, sync reads Trello and runs no agent` (`run` never called; cards, source and syncedAt saved).
  - `a quiet sync shows no syncing; a forced one does`.
  - `a second sync while a read runs joins it`.
  - `drops a read that finished after the source changed` (resetSource mid-read, and useTrello with another list mid-read, and close mid-read).
  - `keeps an old put-back task put back` (task with ARI card id, Trello read with the bare id: no `returnToBoard`); `returns a put-back task whose card left the list`.
  - `a gone list says so and keeps the cards`; `busy and offline are notices`; `an auth failure sets no error`.
  - `useTrello forgets the agent's tools and list`; `resetSource forgets the pick`.
  - `a project without a pick syncs through the agent as before` (the existing tests pass unchanged).
- [ ] **Step 2:** `npx vitest run src/main/todo/todoService.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command, then `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `Todo: a Trello project's sync reads Trello directly (#30)`.

### Task 8: Main wiring and IPC

**Files:**
- Modify: `src/main/config.ts` (`trelloUrl?: string` from `MAINFRAME_E2E_TRELLO_URL`, read only when `e2e`, as `updateDir` is), `src/main/config.test.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` (new `registerTrelloIpc`, `useTrello` and `pollTodo` handlers), `src/main/ipc.test.ts`
- Modify: `src/main/index.ts` (`start()`: make `TrelloAuth` and `TrelloApi` once, `await auth.load()` before the projects open, pass the reader to every `TodoService`)

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7.
- Produces (channels and bridge):
  ```ts
  getTrello: 'trello:get', trelloChanged: 'trello:changed', connectTrello: 'trello:connect',
  disconnectTrello: 'trello:disconnect', setTrelloClientId: 'trello:set-client-id',
  trelloBoards: 'trello:boards', trelloBoardChoices: 'trello:board-choices',
  useTrello: 'todo:use-trello', pollTodo: 'todo:poll',
  // MainframeApi
  getTrello(): Promise<TrelloConnection>;
  onTrello(cb: (view: TrelloConnection) => void): () => void;
  connectTrello(): Promise<void>;
  disconnectTrello(): Promise<void>;
  setTrelloClientId(id: string | null): Promise<void>;
  trelloBoards(): Promise<TrelloBoardRef[]>;
  trelloBoardChoices(boardId: string): Promise<TrelloBoardChoices>;
  useTrello(dir: string, pick: TrelloPick): Promise<void>;   // the pick is parsed with TRELLO_PICK; anything else is refused
  pollTodo(dir: string): Promise<void>;                     // sync({ quiet: true })
  ```
  In `start()`: `crypt` is null when `config.e2e` (no Keychain prompt from a hidden test window), or on Linux when `safeStorage.getSelectedStorageBackend() === 'basic_text'`, or when `await safeStorage.isAsyncEncryptionAvailable()` is false; else `{ encrypt: (t) => safeStorage.encryptStringAsync(t), decrypt: async (b) => { const r = await safeStorage.decryptStringAsync(b); return { text: r.result, stale: r.shouldReEncrypt } } }`. `authBase`/`apiBase` are `config.trelloUrl` when set, else the real ones; `ports` are `[0]` when `config.trelloUrl` is set, else `TRELLO_PORTS`. `openExternal` looks up `shell.openExternal` at each call, so e2e's recorder stands in. Auth's `onChange` sends `trelloChanged` to the window. The reader every project gets is `{ read: (pick) => readList(api, pick), pollMs: () => api.pollMs() }`; `trelloBoards` and `trelloBoardChoices` answer with `listBoards(api)` and `boardChoices(api, boardId)` (rejecting a non-string id).

- [ ] **Step 1: Write the failing tests**
  - `config.test.ts`: `MAINFRAME_E2E_TRELLO_URL is read only in e2e`.
  - `ipc.test.ts`: `useTrello refuses a malformed pick` and `passes a valid pick to the project's todo`; `pollTodo syncs quietly`.
- [ ] **Step 2:** `npx vitest run src/main/config.test.ts src/main/ipc.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command, then `npm test`, `npm run typecheck`, `npm run build` → PASS.
- [ ] **Step 5:** Commit `Trello: connect and pick a list from the window (#30)`.

### Task 9: Settings → Trello

Use `frontend-design:frontend-design`.

**Files:**
- Create: `src/renderer/src/settings/trelloStore.ts`, `src/renderer/src/settings/TrelloSection.tsx`
- Modify: `src/renderer/src/settings/SettingsDialog.tsx` (the section after the agents), `src/renderer/src/app.css`

**Interfaces:**
- Consumes: the Task 8 bridge.
- Produces: `trelloConnection(): TrelloConnection | undefined`, `loadTrello(): Promise<void>`, `connectTrello()`, `disconnectTrello()`, `setTrelloClientId(id: string | null)` (each logs what main refuses, as `todoStore` does).

The section, as §9 says: "Connected as @username" with Disconnect (and a line: "To revoke Mainframe's access too, remove it under Connected apps in your Atlassian account."); or "Connect Trello" (while connecting: "Waiting for your browser…"); the Connect error; "Reconnect Trello" when `needsReconnect`; when `remembers` is false: "This system can't keep the sign-in safely, so you connect again after each restart." An "Advanced: use my own Trello app" disclosure with a client id field, Save, and help text: create an app at trello.com/power-ups/admin, add an OAuth 2.0 public client with the three callback URLs (`http://127.0.0.1:33333/callback`, `…33334…`, `…33335…`) and the scopes Read boards, Write boards, Read members.

- [ ] **Step 1:** Build the store and section. `data-testid`s: `trello-connect`, `trello-disconnect`, `trello-user`, `trello-error`, `trello-client-id`, `trello-client-save`.
- [ ] **Step 2:** `npm run typecheck` and `npm run build` → PASS. The e2e in Task 11 covers the behaviour.
- [ ] **Step 3:** Commit `Settings: connect Trello (#30)`.

### Task 10: The Todo panel on Trello

Use `frontend-design:frontend-design`.

**Files:**
- Create: `src/renderer/src/todo/TrelloSetup.tsx`, `src/renderer/src/todo/poller.ts`, `src/renderer/src/todo/poller.test.ts`
- Modify: `src/renderer/src/todo/TodoPanel.tsx`, `src/renderer/src/todo/todoStore.ts` (`useTrello`, `pollTodo`), `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `trelloStore` (Task 9), the Task 8 bridge, `TodoView.sourceKind/pollMs/notice` (Task 1).
- Produces:
  ```ts
  /** Calls poll() every every() ms while active(); also at once when started. Returns stop. */
  export function startPolling(o: { every: () => number; active: () => boolean; poll: () => void; setTimer?: (fn: () => void, ms: number) => () => void }): () => void;
  ```

Panel behaviour:
- **No source yet** (`!v().setUp && !v().source`): the empty line becomes the choice "Where does this project's to-do list live?" with **Trello** and **Another tracker (AI connector)**. Another tracker shows today's line and Sync, unchanged. Trello shows Connect Trello when not connected, else `TrelloSetup`.
- **`TrelloSetup`** (§6.5 sketch): Board, To-do list, In progress (optional, "None"), Mine and Comes first as label chips (name, or colour when unnamed) from `trelloBoards()` / `trelloBoardChoices()`, then **Use this** → `useTrello(dir, pick)`. Nothing is preselected by name. Shown also from "Set up again" on a Trello project.
- **Trello project header:** the Sync button is a refresh button (icon kept, label "Refresh"), the synced line stays, `notice` shows quietly beside it, Reconnect Trello shows when `needsReconnect` (it calls `connectTrello`). The long-sync line, the tools, list and model asks never show (main never sets them for Trello).
- **Polling:** while the panel's `state` is open, `sourceKind === 'trello'` and the connection is connected: `startPolling({ every: () => v().pollMs ?? 60_000, active: () => document.visibilityState === 'visible' && document.hasFocus(), poll: () => pollTodo(dir) })`, plus `pollTodo` on window `focus`. Stopped when the panel folds or goes off, the project closes or the source changes. On a reconnect (needsReconnect turns false) it polls once.
- **Agent-path hint:** an agent-source project whose `source.kind` is Trello (case-insensitive) shows one line "Connect Trello for instant sync" that opens the Trello setup.

- [ ] **Step 1: Write the failing tests** `poller.test.ts`: `polls at once and then every interval while active`; `skips a tick while inactive and polls on the next active one`; `uses the interval each time` (every() changes 60 s → 120 s); `stop ends it`.
- [ ] **Step 2:** `npx vitest run src/renderer/src/todo/poller.test.ts` → FAIL.
- [ ] **Step 3:** Implement `poller.ts`, `TrelloSetup.tsx` and the panel changes. `data-testid`s: `todo-source-choice-trello`, `todo-source-choice-agent`, `trello-setup`, `trello-board`, `trello-list`, `trello-in-progress`, `trello-mine`, `trello-urgent`, `trello-use`, `todo-refresh`, `todo-notice`, `todo-reconnect`, `todo-trello-hint`.
- [ ] **Step 4:** `npx vitest run src/renderer/src/todo/poller.test.ts`, `npm test`, `npm run typecheck`, `npm run build` → PASS.
- [ ] **Step 5:** Commit `Todo: set up and show a Trello list in the panel (#30)`.

### Task 11: A fake Trello for e2e, the end-to-end tests, and the release line

**Files:**
- Create: `e2e/fakeTrello.ts`, `e2e/trello.e2e.ts`
- Modify: `CHANGELOG.md` (first line under `## Unreleased`)

**Interfaces:**
- Consumes: everything above; `launchApp`, `openedLinks` (e2e helpers).
- Produces: `startFakeTrello(state: FakeBoard[]): Promise<{ url: string; requests: string[]; set(state: FakeBoard[]): void; respondNext(status: number, headers?: Record<string, string>): void; close(): Promise<void> }>` on `127.0.0.1:0`, serving `/authorize` (302 to `redirect_uri?code=fake&state=<state>`), `/oauth/token` (fixed tokens, `expires_in: 3600`), and the Task 6 paths in the Task 0 shapes. The test passes `MAINFRAME_E2E_TRELLO_URL: fake.url`, takes the authorize URL from `openedLinks`, and `fetch`es it (following the redirect into the app's loopback).

- [ ] **Step 1: Write the tests** in `trello.e2e.ts`:
  - `Connect in Settings signs in through the browser and shows the username`.
  - `a project set up on Trello shows its list with numbers, labels and checklists, without a sync run` (the fake `claude` logs no sync launch).
  - `Refresh shows a card changed in Trello, in place`, and `window focus refreshes too`.
  - `two projects on one board keep their own lists` (different lists, side by side).
  - `a 429 shows "Trello is busy; retrying" and the list stays`.
  - `a gone list says so; Set up again picks another`.
  - `Disconnect shows Connect again, and the list stays on screen`.
- [ ] **Step 2:** Ask the owner to quit Mainframe (Cmd+Q) first: e2e must not run while it runs (owner's memory note). Then `npm run test:e2e` → the new file PASSES and every other e2e file still passes.
- [ ] **Step 3:** Add under `## Unreleased`: `New: The Todo panel reads a Trello list directly, in about a second and without an AI run: connect Trello once in Settings and pick the board and list.`
- [ ] **Step 4:** Commit `e2e: Trello signs in, shows and refreshes a list against a fake server (#30)`.

### After the last task (controller)

- `/simplify main...HEAD`, check its edits, run the three suites, commit, record the tip in `.git/claude-simplified`.
- Final whole-branch review (Opus, high; Fable, high if large).
- `/code-review high main...HEAD`, fix, run the three suites, commit, record the tip in both files.
- Owner acceptance on the real board: Connect, set up Damela or Mainframe, check the cards match the agent sync's, restart and stay connected, an old task's card still shows Reopen/Continue. Then comment on #30.
