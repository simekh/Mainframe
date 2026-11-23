# Mainframe: Trello read and written directly — design

Date: 2026-11-23. Card: #30 "Todo panel: Sync takes too long to load the list" (https://trello.com/c/LQ0uLBpv), which this work closes and widens.

## 1. Why

The Todo panel reads the owner's to-do list through a headless agent run that uses the owner's tracker connector (MCP). Each sync copies every card word for word into one JSON answer (`syncRun.ts`, `todoSchema.ts`). That is slow, costs money and grows with the board: Damela's list is 38 cards and about 49,000 characters, and a sync of Mainframe's own board on 2026-11-23 failed with "Reached maximum budget ($1)". The runs are also loose: Damela's saved source kind reads "list" instead of "Trello".

The owner asked (2026-11-23): "maybe it's time to implement a real Trello API? Doing it the Claude MCP way is very slow. Maybe brainstorm how we can improve the Trello todo panel fully?" The 2026-11-06 Todo design (§1, §2) left this open: "A direct integration may come later, to make syncing cheaper **(owner)**", and kept syncing manual only "because every sync costs a Claude run".

**Decided with the owner in this conversation:**
- Mainframe talks to Trello's REST API itself. The agent path stays for every other tracker (Linear, Jira, GitHub Issues…).
- Mainframe writes to Trello, not only reads: create, read, update; delete means archive (owner: "full CRUD or at least CRU").
- The manager and task sessions also write to Trello through Mainframe's own MCP tools, not only the owner through the panel (owner: "The agents too").
- Mainframe is public for anyone to use (owner), so the auth must scale past friends and keep within Atlassian's terms.
- Sign-in is Trello's OAuth 2.0 with a public client (owner: "lets run the Oauth 2.0"), confirmed by a live test (§5).

## 2. Goals, non-goals, anti-goals

**Goals**
- A Trello project's list shows in about a second, at no model cost, and stays fresh by itself.
- Connect Trello once per Mainframe, in the browser, with one click and no copy-paste.
- Each project picks its own board and list from real dropdowns.
- Edit cards from the panel: create, edit title/description/labels/checklists, comment, move between lists, rank by drag, archive with Undo.
- Start moves the card to the project's in-progress list at once.
- Sessions work on their card through Mainframe's tools, with or without a Trello connector of their own.

**Non-goals**
- Direct adapters for other trackers. The small seam (§6.1) leaves room, but nothing is built for them.
- Trello webhooks: they need a public HTTPS callback, which a desktop app has none of.
- Permanent deletion of cards, and creating, renaming or archiving lists or labels.
- A full board view inside Mainframe: Trello already is one.
- Moving cards on merge. Each project's flow differs (Dev vs Done), and the project's `CLAUDE.md` tells its sessions what to do; the task tools (§8) let them do it.

**Anti-goals**
- A project with no Trello stops working, or a friend on Linear loses today's AI sync.
- A Trello app secret, key or token in the source code (Atlassian Developer Terms §2.1: credentials "must not [be embedded] in open-source projects").
- Anything a session or the manager can do to the board beyond its scope: a task touching another card, anyone permanently deleting.
- Polling that can lock the shared client out for every Mainframe user (§6.4).

## 3. Constraints

- **Project-agnostic** (Mainframe CLAUDE.md): no board, list name, label name or tracker in code, prompts or defaults. List and label choices come from the owner's picks in setup; prompts defer to "this repo's CLAUDE.md".
- **Several projects at once**: one Trello sign-in for the whole app; each project keeps its own board, list, label rules, poll and view. Two projects on the same board must work. Every IPC call and event names its project by folder, as today.
- **Proportion**: TrelloClient, TrelloAuth and the Trello source stay small; no general tracker framework.
- **Newest versions only** (owner memory): Electron's async `safeStorage` API (`encryptStringAsync`/`decryptStringAsync`), Node's built-in `fetch`.
- **Three agents**: everything sessions get works the same for Claude Code, Codex and OpenCode.
- **Release notes**: each part adds its `New:`/`Fixed:` line under `## Unreleased` in `CHANGELOG.md` as it merges.

## 4. Approaches considered

**Where the cards come from**
1. **Trello REST API from main (picked).** One or two requests per read, about a second, free; makes editing possible.
2. A slimmer agent run (`--strict-mcp-config`, fewer fields). Still a model run per sync, still slow, and can't back an editing UI.
3. Trello's hosted MCP server (`https://mcp.trello.com/v1`, OAuth only) called as a program, without a model. Unpublished schemas and limits, no list create/archive, one workspace per connection, built "to connect Trello to AI assistants". Kept out.

**How a user signs in**
1. **OAuth 2.0, public client, PKCE, loopback redirect (picked; tested §5).** One click, no secret in the code, the documented successor to legacy tokens.
2. One shared legacy API key in the code, user pastes a never-expiring token. The most common pattern (JetBrains, Raycast, Obsidian Trello plugin), but it embeds an Atlassian access key in open source, which the Developer Terms forbid, and needs a copy-paste.
3. Each user creates their own key in Trello's app admin and pastes key and token (n8n's way). No shared limit, but five confusing steps. Kept only as the "own app" escape hatch (§6.2), in OAuth form.

**Who writes**
1. **Owner, manager and tasks, all through Mainframe (picked).** Same behaviour with or without a Trello connector in the sessions.
2. Owner only; sessions keep using their own connector. Sessions without one couldn't move or comment.

## 5. The OAuth test, 2026-11-23

The owner accepted the developer terms; a non-Power-Up app "Mainframe (test)" was created in their workspace (trello.com/power-ups/admin, app id `6b042fb88cde9b867e07d1b4`) with a **public** OAuth 2.0 client, client id `cjmiq05mPFq8nq2NbdTU5En5PgRfxFAv`, scopes Read boards, Write boards, Read members, and callback `http://127.0.0.1:33333/callback`. A throwaway Node script ran the flow from this Mac.

- The admin page **accepts** `http://127.0.0.1:<port>/…` callbacks and **rejects** custom schemes ("Callback URL must use https or localhost").
- Authorize → Atlassian login → consent → redirect to the loopback with `code` and the right `state`: **works**.
- Code exchange at `https://auth.atlassian.com/oauth/token` with PKCE and **no client secret**: HTTP 200, access token (3600 s), refresh token, scopes as asked.
- `GET https://api.trello.com/1/members/me` and `/1/members/me/boards` with only `Authorization: Bearer <token>` (no API key): HTTP 200. `https://trello.com/1/…` works too.
- Refresh with no secret: HTTP 200 and a new pair. Reusing the same refresh token a second later also returned 200 (a grace window); don't rely on it.
- Rate-limit headers on every response: `x-rate-limit-oauth2-client-id-max: 300` per 10 s (**shared by all users of the client id**), `x-rate-limit-oauth2-member-max: 100` per 10 s (per user), `x-rate-limit-member-max: 375` per 10 s, and `x-rate-limit-oauth2-db-query-time-*`. No `Retry-After` seen on a 200.

So OAuth 2.0 does not lift the per-app limit; it moves it from the key to the client id. §6.4 keeps Mainframe well under it, and §6.2 gives anyone their own client.

## 6. Part 1: direct reading

### 6.1 The seam

`TodoService` gets its cards from one of two sources per project:
- **Agent source**: today's sync run, unchanged (`syncRun.ts`, the adapters' `SyncAdapter`, tools/list/model asks).
- **Trello source**: new, in `src/main/todo/trello/`: `trelloAuth.ts` (sign-in, tokens), `trelloClient.ts` (fetch with auth, rate-limit tracking, backoff), `trelloSource.ts` (read the list and map it to `TodoCard`; later the writes).

`todo.json` records which source a project uses. A version bump (VERSION 2, with a read of version 1 as "agent source") adds:

```
trello?: {
  boardId, boardName, boardUrl,
  listId, listName,
  inProgressListId?: string,      // for Start (part 2); none = Start moves nothing
  mineLabelIds: string[],         // "for the owner" (today's forOwner)
  urgentLabelIds: string[],       // "comes first" (today's urgent)
}
```

`TodoView` keeps its shape for the renderer, plus `sourceKind: 'agent' | 'trello'` and `trello: { connected: boolean, needsReconnect: boolean }` so the panel can show the right buttons.

### 6.2 Connecting Trello (app-wide)

- **Where:** Settings gets a Trello section; the Todo panel's empty state offers "Connect Trello" too.
- **Flow:** Mainframe starts a one-shot HTTP listener on `127.0.0.1` at the first free port of a short registered list (33333, then 33334, 33335), opens `https://auth.atlassian.com/authorize` in the **system browser** (`shell.openExternal`) with `client_id`, `scope=read:member:trello read:board:trello write:board:trello offline_access`, `redirect_uri`, `response_type=code`, `prompt=consent`, PKCE S256 and a random `state`. The listener accepts one request on `/callback`, checks `state`, answers with a short "You can close this tab" page, closes, and times out after 5 minutes. Mainframe exchanges the code (no secret) and reads `/1/members/me?fields=username,fullName` to show "Connected as @username".
- Write scope is asked at Connect, so parts 2 and 3 need no second consent (designer's call).
- **The client id** is a constant in `trelloAuth.ts`: a public client has no secret, and RFC 8252 treats a native app's client id as public. Atlassian's terms don't address public OAuth client ids; if Atlassian ever objects, the escape hatch below becomes the default.
- **"Use my own Trello app":** an advanced field in the Trello section for a client id of the user's own non-Power-Up app (public client, same three callback URLs, same scopes). A short help text lists the steps. It gives that user their own 300-per-10-s budget.
- **Disconnect** deletes the stored tokens and says where to revoke the grant in the Atlassian account (Trello documents no revoke endpoint; the builder checks).
- **Port taken:** all three ports busy → the panel says so and offers Retry. No paste fallback: OAuth codes are useless without the listener's PKCE verifier anyway.

### 6.3 Tokens

- One sign-in per Mainframe (one Trello account), in the data folder as `trello-auth.json`: `{ clientId, refreshToken, accessToken, expiresAt, username }`, the token fields encrypted with `safeStorage.encryptStringAsync`.
- If `safeStorage.getSelectedStorageBackend()` is `basic_text` (Linux with no keyring), Mainframe keeps the tokens in memory only and the Trello section says it can't remember the sign-in on this system (designer's call).
- **Refresh:** when `expiresAt` is under a minute away, or on a 401, exchange the refresh token. One refresh at a time for the whole app (several projects share it). **Write the new pair to disk before using it.** A failed refresh (400/401) marks the connection `needsReconnect`: every Trello project shows "Reconnect Trello", and the stored list stays on screen.
- A refresh token lasts 90 days and rotates on each use, so a Mainframe left unopened for 90 days asks to reconnect once.

### 6.4 Reading and staying fresh

- **Read the list:** `GET /1/lists/{listId}/cards` with `fields=id,idShort,name,desc,labels,pos,shortUrl,dateLastActivity` and `checklists=all` (`checklist_fields=name`, items with `name,state,pos`). Cards come in `pos` order. The builder verifies the exact parameter names against the API reference.
- **Mapping to `TodoCard`:** `id` = Trello's card id; `number` = `#${idShort}`; `title` = `name`; `description` = `desc`; `labels` = each label's name, or its colour when it has no name (Mainframe's own board has colour-only labels); `checklists` from Trello's; `url` = `shortUrl`; `forOwner` = has any `mineLabelIds`; `urgent` = has any `urgentLabelIds`. `TodoSource` = `{ kind: 'Trello', board: boardName, list: listName, url: boardUrl }`.
- **Old task records:** tasks started from an agent sync keep card ids like `ari:cloud:trello::card/workspace/<ws>/<hex>` (seen in Damela's and Word²'s `todo.json`); Trello's id is the last segment. Card matching (the `todoItems` task map, `board/lanes.ts`, `startItem`, Put back) compares on the last `/` segment, so old tasks still find their cards (designer's call; a one-time rewrite of task records is the alternative).
- **Change check:** one cheap request per board, `GET /1/boards/{id}?fields=dateLastActivity`; when it moved, re-read the list. The builder verifies that card edits, moves and checklist ticks move `dateLastActivity`; if not, use `GET /1/boards/{id}/actions?limit=1&fields=date` instead.
- **When:** at panel open, at window focus, right after Mainframe's own writes, on the refresh button, and every 60 s while that project's Todo panel is open (not folded or off) and the window is visible and focused. Nothing polls while Mainframe is in the background.
- **Being a good neighbour on the shared client:** every response's `x-rate-limit-oauth2-client-id-remaining` is tracked; under 30% of max, the poll interval doubles (up to 10 min) and returns to 60 s once it recovers. A 429 stops all of this Mainframe's Trello calls for `Retry-After` seconds, or 10 s doubling to 2 min, and the panel shows "Trello is busy; retrying". At one request a minute per open project, the shared 300/10 s covers about 1,800 projects open at once.
- **The panel:** the Sync button becomes a refresh button for Trello projects; the "Synced … ago" line stays. The 2-minute "long sync" warning, the tools ask and the model ask are agent-source only. `sync_todo` (manager) refreshes a Trello project at once.
- **Errors:** 404 on the list or board → "This list is gone or you no longer have access" with "Pick again". Network failure → the list stays, with a quiet "Offline; showing the last copy".

### 6.5 Project setup

From the Todo panel of a project with no source yet, or "Set up again":

```
┌ Todo ─────────────────────────────┐
│ Where does this project's to-do   │
│ list live?                        │
│  [ Trello ]  [ Another tracker (AI connector) ] │
├───────────────────────────────────┤
│ Board        [ Damela          ▾] │
│ To-do list   [ TODO            ▾] │
│ In progress  [ In Progress     ▾] │  (optional: "None")
│ Mine         [ You ×  + label  ]  │  label chips, name or colour
│ Comes first  [ Blocker × + label] │
│                    [ Use this ]   │
└───────────────────────────────────┘
```

- Boards: `GET /1/members/me/boards?filter=open&fields=name,url`. Lists: `GET /1/boards/{id}/lists?fields=name,pos`. Labels: `GET /1/boards/{id}/labels?fields=name,color`.
- Labels are stored by id, so a renamed label keeps its meaning.
- Mainframe suggests nothing by name (project-agnostic); the owner picks.
- "Another tracker" goes to today's agent flow unchanged. A project on the agent path whose source kind is Trello sees a one-line hint "Connect Trello for instant sync" (designer's call).

### 6.6 Card #30's done-when, updated

The Trello path replaces the measurement the card asked for: the agent sync no longer runs for Trello projects. Done when a Trello list shows within about a second, refreshes by itself, gives the same cards the agent sync gave (titles, descriptions, checklists, labels, order), and old tasks still match their cards.

## 7. Part 2: editing from the panel

- **Live ticket:** opening a card fetches `GET /1/cards/{id}` with checklists, comments (`actions=commentCard`) and attachments. The "as of the last sync" line goes; comments show newest first; image attachments show as thumbnails that open in the browser.
- **Edit in the ticket:** title (inline), description (text area with the panel's existing Markdown preview), labels (toggle from the board's labels), checklist items (tick, add, rename, remove; add a checklist), add a comment, move to another list (dropdown of the board's lists), archive.
- **Archive** (`closed=true`) leaves the list with an Undo toast for 6 s (`closed=false`). No permanent delete anywhere.
- **Quick Add**, on a Trello project, has "Add to Trello" (default) and "Keep in Mainframe"; "Add to Trello" asks top or bottom of the list and creates the card (`POST /1/cards`). Notes keep working as today.
- **Rank by drag:** dragging a card in the list sets its `pos` between its new neighbours' (Trello's own float positions). Notes sit below the cards and don't mix with them. Keyboard: the same move with Alt+↑/↓ on a focused row (designer's call, for accessibility).
- **Writes are optimistic:** the panel shows the change at once, rolls back on failure with the reason in the ticket, and re-reads the list after.
- **Conflicts:** at save of a title or description, if the card's `dateLastActivity` moved since the ticket loaded, Mainframe asks "Changed in Trello since you opened it: overwrite or reload?". Other edits are last-write-wins (designer's call).
- **Start:** when the project has an in-progress list, Mainframe moves the card there (`PUT /1/cards/{id}` `idList`, top) as the task starts. A failed move doesn't stop the start; the task's card shows "Couldn't move the card in Trello: …".
- **Mainframe makes the other moves too (owner, 2026-11-23),** all only when the project has an in-progress list, and none of them resumes a session or runs a model:
  - **Put back:** Mainframe moves the card back to the to-do list at its old place (`TaskCardRef.position`: between the cards now at that index, or the bottom when the list is shorter), re-reads the list, and marks the task put back once the card is on it. Today's flow (`putBackPrompt` in `carryOn.ts`, the session moving the card) stays for agent-source projects.
  - **Discard:** the same move back, so the card can be started afresh (a discarded attempt is given up).
  - **Continue and Reopen** of a put-back or finished task: the card moves to in progress again.
  - A failed move says why on the task's card; Put back then leaves the task Paused, as today's failure does.
- **The opening prompt** of a Trello card's task changes in part 3 (§8.3). In part 2 only its "mark the card as in progress" line goes when Mainframe has moved it.

## 8. Part 3: the agents write through Mainframe

### 8.1 Each task gets Mainframe's MCP server

Today only the manager connects to Mainframe's MCP server (`mcpServer.ts`, one token per app run). Tasks of a Trello project get their own connection: a token per task that the server maps to `(project, taskId)`, passed in each agent's own way, as the manager's is (Claude Code `--mcp-config` file, Codex `mcp_servers.mainframe` with the token in env, OpenCode `OPENCODE_CONFIG_CONTENT`), with the task tools pre-allowed. The token changes with each app run, so a reopened task gets a fresh one at launch.

### 8.2 The tools

**A task's tools** reach only its own card, and exist only when the task has a Trello card:
- `card_get`: the live card (title, description, labels, checklists with item ids, last 25 comments, list name).
- `card_comment(text)`
- `card_update(title?, description?)`
- `card_check_item(itemId, done)`, `card_add_checklist_item(checklist, text)`
- `board_lists`: the board's lists (name, id), so the session can follow its `CLAUDE.md` ("move to Dev").
- `card_move(listId, position: top|bottom)`

**The manager's tools** reach any card on its project's board, "only when the owner asks" in each description:
- `cards_list(listId?)` (default: the project's to-do list), `card_get(cardId or #number)`, `board_lists`
- `card_create(listId?, title, description?, position)`
- `card_update`, `card_move`, `card_comment`, `card_check_item`, `card_add_checklist_item`
- `card_archive(cardId)`

**Who approves what (owner, 2026-11-23):** the manager's reading tools (`cards_list`, `card_get`, `board_lists`) are pre-allowed. Every manager tool that changes the board asks the owner first, through the agent's own permission prompt, as `start_task` does today (it is kept out of `MANAGER_ALLOWED_TOOLS` in `claude.ts` for that reason); the owner can allow them for good in their own settings. The same split holds for Codex and OpenCode launches. A task's tools are all pre-allowed: they reach only its own card.

No tool deletes, and no tool touches another board. Tool results put card text in quotes as data: card text is written by anyone on the board.

### 8.3 Prompts

- A Trello card's opening prompt: the card's number, title, labels and URL as today, plus the **fresh card text** (description and checklists, read at Start; in the description file when long, as today). It says Mainframe has moved the card to in progress when it has, and that Mainframe's card tools read and update the card, to be used as this repo's `CLAUDE.md` says. It names no list and no connector.
- Agent-source cards keep today's text ("read the live card with your … connector").
- The manager's role prompt mentions its card tools for Trello projects.

## 9. Settings and the panel, together

- **Settings → Trello:** "Connected as @username" · Disconnect; or "Connect Trello". An "Advanced: use my own Trello app" field with the client id and help steps. A line when tokens can't be stored (§6.3).
- **Todo panel header (Trello):** "Trello ↗ · Board · List", "Updated just now", refresh, Quick Add.
- The visual design of setup, the editable ticket and the drag handle is the builder's, with the `frontend-design` skill, matching the panel's current look.

## 10. Owner steps (labelled You)

- Rename the app "Mainframe (test)" to "Mainframe" and fill its basic information; add callbacks `http://127.0.0.1:33334/callback` and `…:33335/callback` (OAuth 2.0 tab).
- Optionally revoke the test grant in the Atlassian account's connected apps after part 1 is built and tried.

## 11. Left to the builder

- Exact REST parameter names and response fields (verify against https://developer.atlassian.com/cloud/trello/rest/), the change check (§6.4), and how comments and attachments come back.
- Whether Trello's "Personal Data Storage and GDPR" compliance polling applies to a desktop app that stores card text and the user's username locally (the "Personal Data Storage and GDPR" guide under Compliance in Trello's developer docs); if it does, a plan task implements it.
- Whether Atlassian offers a token revoke for Trello OAuth 2.0.
- The split into three branches and plans, in the order Part 1 → 2 → 3, each with its tests, reviews and changelog line. Part 1 can't break the agent path: its tests keep passing unchanged.
- e2e: a fake Trello server (like the existing fakes) for the panel, so no test touches real Trello.
- UI layout and wording, within §6.5 and §9.

**Settled while planning and building part 1 (2026-11-23):**
- Electron 44.11.4 has `safeStorage.encryptStringAsync`, `decryptStringAsync` (resolves `{ shouldReEncrypt, result }`), `isAsyncEncryptionAvailable` and `getSelectedStorageBackend` (checked in `electron.d.ts`). The sync API is deprecated from 45 and removed in 46.
- REST requests and fields, checked live on the owner's board: `members/me` (`id, username, fullName`), `members/me/boards?filter=open&fields=name,url`, `boards/{id}/lists?fields=name,pos&filter=open`, `boards/{id}/labels?fields=name,color&limit=1000`, and `lists/{id}/cards?fields=id,idShort,name,desc,labels,pos,shortUrl&checklists=all&checklist_fields=name,pos` all answer 200 with those fields, in `pos` order; `idShort` is a number; a missing list answers 404. No checked card had a checklist, so `checkItems` follows the docs.
- **The change check is dropped:** it costs one request a minute, as the list read does, and the rate limit counts requests, so each poll reads the list itself.
- **GDPR:** Trello's guide applies to public apps that store personal data outside Trello for more than 14 days, and its polling needs a confidential client, which an open-source desktop app can't hold. Mainframe keeps no member data on disk (the username is held in memory only); card text is the board's content, kept as the agent sync keeps it.
- **Revoke:** no OAuth 2.0 revoke endpoint is documented. Disconnect deletes the local tokens and says the grant can be revoked under Connected apps in the Atlassian account.
- **Start-up never waits on Trello:** the Keychain is asked only when a sealed sign-in must be read or written, and the sign-in loads in the background while projects open.

## 12. Research notes (2026-11-23)

- **Prior art:** JetBrains' Trello task server, Raycast's Trello extension and the Obsidian "Trello" plugin ship one legacy key and have users paste a never-expiring token; n8n and some Obsidian plugins make each user create a key. No desktop tool found used OAuth 2.0 yet (it arrived 2026-09-15).
- **Terms:** Atlassian Developer Terms §2.1: credentials are confidential, "may not be shared with third parties", and developers "must not embed them in open-source projects"; §6(h) bars distributing "any access key provided by Atlassian". Trello's admin page links these terms. Trello's API introduction still says the key "is intended to be publicly accessible".
- **OAuth 2.0:** authorize `https://auth.atlassian.com/authorize`, token `https://auth.atlassian.com/oauth/token`, PKCE S256 required, `offline_access` for a refresh token, access 1 h, refresh 90 days and single-use. Docs describe public clients for Power-Ups; the test (§5) shows a non-Power-Up public client works. Non-Power-Up clients are not workspace-restricted. API tokens are "not going away", with at least six months' notice of any change.
- **Limits:** legacy 300/10 s per key, 100/10 s per token; over 200 429s in a window blocks the key for everyone until it ends. OAuth: per client id 300/10 s, per member 100/10 s (measured, §5).
- **Webhooks** need a public HTTPS callback (HEAD check at creation), so a desktop app polls.
- **Desktop practice:** system browser, never a webview (RFC 8252); loopback on 127.0.0.1, one request, `state` check, timeout; `safeStorage` async API; pause polling when hidden.
