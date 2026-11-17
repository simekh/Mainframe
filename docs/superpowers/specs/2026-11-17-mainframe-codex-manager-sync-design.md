# Mainframe: the manager and the Todo sync on Codex (design)

Date: 2026-11-17. Branch `worktree-codex-manager-sync`. Builds on `2026-11-17-mainframe-codex-tasks-design.md` (Codex tasks, merged and pushed in 56625c9) and its findings `docs/superpowers/findings/2026-11-17-codex-checks.md`. The checks for this branch are in `docs/superpowers/findings/2026-11-17-codex-manager-sync-checks.md` (written as part of this branch, from the probes below).

## Intent

A friend who has only Codex should get the whole of Mainframe. Today they get tasks; the manager and the Todo sync refuse with "doesn't run on Codex yet", and setup's "Codex runs everything: the manager, the Todo sync and your tasks" is not true. This branch makes it true, writes the README for Codex, and settles whether a Codex found after setup is ticked by itself.

## Goals

- **The manager runs on Codex** when Codex is the default agent: Mainframe's tools, the role prompt, the carry-on prompt after Quit, and a chat that comes back after Quit and Restart.
- **The Todo sync runs on Codex**: discover, read, the owner's Allow and Pick, with a read-only guard as real as Claude Code's and OpenCode's.
- **README**: Codex in the agent lists, `MAINFRAME_CODEX_BIN` in the env table, Codex's `.mainframe/worktrees`, the CLAUDE.md config note, that npm's `codex.cmd` isn't used on Windows, and how the manager and the sync behave on Codex.
- **Setup's "runs everything" line** stays as it is: this branch makes it true.

## Decisions

- **A Codex found after setup is ticked by itself (owner, 2026-11-17).** Kept as today: an agent with no saved choice counts as ticked once found (`tickedAgents`). It only adds a choice in the New task box; the default agent doesn't change. Nothing to build; the README says it.
- **The manager learns its chat id from Mainframe's own tools (owner picked approach 1, 2026-11-17).** See Approaches.
- **The sync's discover accepts one gap and catches it (owner, 2026-11-17)**: a tool the user set to "approve" in their own Codex config could run during discover; Mainframe rejects that answer. See The Todo sync.

## Non-goals

- Anything in Codex's tasks (shipped).
- A model choice for the Codex sync: it runs on the user's own Codex model (designer's call: there is no stable "cheap Codex model" name, and ChatGPT plans aren't charged per call).
- Settings options for Codex: nothing needs one.
- Commands an agent leaves running, Codex through npm on Windows: still follow-ups of the tasks design.

## Anti-goals

- **Reading Codex's session store** (`$CODEX_HOME/sessions`, its SQLite files). Unchanged from the tasks design.
- **Hooks**: a SessionStart hook needs the user's trust in `/hooks`; `--dangerously-bypass-hook-trust` runs every hook a repo carries.
- **`codex resume --last` for the manager**: in the main checkout it would pick up the user's own Codex chats.
- **A sync that can write or run anything**: no shell, no web, no subagents, no tool the owner didn't confirm (with the one discover gap the owner accepted, below).
- Any change to what Claude Code's or OpenCode's manager and sync do.
- Anything that names the owner's projects, paths, branches or tools (`CLAUDE.md`'s project-agnostic rule); anything that assumes one project (the multi-project rule).

## What Codex 0.169.0 does (probed 2026-11-17)

Real `codex` against a fake Responses API and a logging MCP server, throwaway `CODEX_HOME`. The findings file records the commands.

- **MCP over HTTP with a token:** `-c 'mcp_servers.mainframe.url="…"' -c 'mcp_servers.mainframe.bearer_token_env_var="NAME"'` sends `Authorization: Bearer <value of NAME>`. The model sees the server's tools in a namespace `mcp__mainframe` (tool `list_sessions` etc.).
- **Approval of MCP tools** (`mcp_servers.<s>.default_tools_approval_mode`, `mcp_servers.<s>.tools.<t>.approval_mode`, values `auto | prompt | writes | approve`):
  - default (`auto`): a tool annotated `readOnlyHint: true` runs without asking; one without it asks.
  - `prompt`: always asks. In `codex exec` (approval policy never) the call fails with "MCP tool call requires approval, but approval policy is never".
  - `approve`: runs without asking.
- **The session id reaches the MCP server.** Every `tools/call` carries `params._meta.sessionId` (also `threadId`, and `x-codex-turn-metadata.session_id`), the id `codex resume <id>` takes. `initialize` and `tools/list` carry none. Not in Codex's docs. Checked in `codex exec` and in the TUI (in a pseudo-terminal); `codex resume <that id>` in the TUI opened the chat with its history.
- **Reports in the TUI:** a start with no prompt reports `idle` within a second; `codex resume <id>` with no prompt reports `idle` within 0.2 s.
- **`codex resume <id>` with an id Codex doesn't have**, in the TUI: it shows "ERROR: No saved session found with ID …" and exits with code 1 after about 4 s, having sent no report. It doesn't start a new chat.
- **`developer_instructions`** (string) is "additional developer instructions injected into the session". A `-c` replaces the user's own value for that key. A resumed chat keeps the instructions it was started with: a new value on `resume` doesn't reach the model (checked), as with Claude Code's manager.
- **Stdio connectors** (how most trackers run) start outside Codex's sandbox, with no `CODEX_SANDBOX`, and reach the network under `exec -s read-only`, in a trusted and in an untrusted folder.
- **Names.** The model sees a server's tools in a namespace `mcp__<name>` with every character outside `[A-Za-z0-9_]` turned into `_` (server `my-trk` → `mcp__my_trk`); the JSON events name the server as configured (`my-trk`). A `-c` dotted key can't name a server whose name holds a `.`, even quoted (`mcp_servers."a.b"…` fails to load).
- **`codex mcp list --json`** run in a trusted project's folder includes the servers of that project's `.codex/config.toml`, as `exec` there offers them.
- **`codex exec`**: prompt from stdin when none is given (or `-`); `--json` prints JSONL events (`thread.started`, `turn.started`, `item.started`/`item.completed` with items `agent_message`, `mcp_tool_call` {server, tool, status, error}, `error` (a warning item, e.g. unknown model metadata: not a failure), `turn.completed`, `turn.failed`); `--ephemeral` keeps no session file; `-s read-only`; `-C <dir>`.
- **`--output-schema <file>`** is sent as `text.format = {type: json_schema, strict: true}`. OpenAI's strict mode needs every property in `required` and `additionalProperties: false` on every object; an optional field is a union with `null`. `SYNC_ANSWER_JSON` has optional top-level fields, so the real API would refuse it as it is.
- **Switches that take tools away**: `features.shell_tool=false` (exec_command, write_stdin), `web_search="disabled"`, `features.multi_agent=false`, `features.apps=false` (ChatGPT apps), `features.goals=false`. With all five and no MCP server the model is offered only `request_user_input` (refused outside plan mode) and `view_image`. All five pass `--strict-config`.
- **`codex mcp list --json`** prints the configured servers as a JSON array of `{name, enabled, transport, …}`, honouring `CODEX_HOME` and `-c`.
- With MCP servers configured, `exec` also offers `list_mcp_resources`, `list_mcp_resource_templates` and `read_mcp_resource`: reads of the servers' resources, which tool approval doesn't cover. Left on: they only read.

## Approaches: how the manager finds its chat after Quit

1. **Learn the id from Mainframe's own tools (chosen).** Mainframe's MCP server takes `_meta.sessionId` from each tool call of the manager and saves it; the next start runs `codex resume <id>`. A `/new` is followed, since the next call carries the new id. Gaps and their fixes are below. Risk: the field is undocumented; if Codex stops sending it, each start opens a new chat, and nothing breaks.
2. **Never resume.** Simple, can't break; loses the conversation and the carry-on prompt on every Quit.
3. **The manager in a folder of its own**, so `--last` finds only its chats. Changes what the manager is: it could no longer make small changes in the main checkout.

Ruled out earlier: reading Codex's session files, a SessionStart hook, `resume --last` in the main checkout.

## The design

### The manager

**Launch.** In the project folder, as every manager runs:
- New chat: `codex <-c …> [prompt]`. Resume: `codex resume <id> <-c …> [prompt]`. (The carry-on prompt goes in as the first message, as for tasks.)
- The `-c`s, all Mainframe's own keys, so no user setting but `developer_instructions` is replaced:
  - `mcp_servers.mainframe.url="<url>"`
  - `mcp_servers.mainframe.bearer_token_env_var="MAINFRAME_MCP_TOKEN"`, with `MAINFRAME_MCP_TOKEN=<token>` in the launch's `env`. The token stays out of the argv (`ps`). It is in the manager's environment, readable by the commands it runs, as Claude Code's manager can read its `mcp.json`.
  - `mcp_servers.mainframe.tool_timeout_sec=<SYNC_TIMEOUT_MS + 60 s, in seconds>`: `sync_todo` waits out a sync, as Claude Code's `timeout` does.
  - `mcp_servers.mainframe.tools.<t>.approval_mode="approve"` for `list_sessions`, `sync_todo`, `close_session`; `"prompt"` for `start_task`. The same split as Claude Code's allow rules and OpenCode's `MANAGER_RULES`. `start_task` then follows the user's own approval setting (designer's call): Codex asks in its terminal (`blocked:kind=permission` on the board); under `--dangerously-bypass-approvals-and-sandbox` a `prompt` tool runs without asking (checked); under a sandboxed "never ask" policy Codex refuses the call and says why ("requires approval, but approval policy is never"), as Claude Code's `dontAsk` mode refuses a tool it isn't allowed. The README says so.
  - `developer_instructions="<role prompt>"`, the role prompt in Codex's words plus one sentence of Codex's own: "Before your first answer in a chat, call list_sessions." It makes the id known from the first turn and gives the manager the board. It is passed on every launch; a resumed chat keeps the one it began with, as Claude Code's does (`rolePrompt.ts` already says so). This replaces the user's own `developer_instructions` in the manager (only there; tasks pass no `-c`).
- The value of each `-c` is a TOML value: strings quoted as TOML basic strings (`JSON.stringify` gives one for these texts; builder confirms with a test through `codex debug prompt-input` or the fake model).
- No `answerStatusEarly`: Codex reports without being asked.

**Learning the id.** Mainframe's MCP server is per project and only the manager has its token, so every tool call it gets is that project's manager.
- On each tool call that carries a string `_meta.sessionId`, the project's manager records it: Codex's adapter writes it in the manager's folder (a small file, as Claude Code's hook writes `session-start.json` there), and `managerChat(dir)` reads it back. A tool call without it changes nothing, so Claude Code's and OpenCode's managers are untouched.
- `sessionId` rather than `threadId`: a subagent's call would carry its own thread; the session is the one `resume` opens (builder checks with a subagent call if the fake model can make one; otherwise this stays as stated).
- Mainframe's placeholder from `newSessionId` is never resumed: only an id Codex sent is.

**A saved chat Codex no longer has.** If a manager that was started with `codex resume <id>` exits before its first OSC 7501 report, Mainframe forgets the saved id, so Restart opens a new chat instead of failing again. (Checked: a missing id exits with no report; a resumed chat reports `idle` within 0.2 s, so quitting it early doesn't trip this.) Only for Codex: Claude Code's and OpenCode's managers keep what they do. A user who quits a resumed Codex manager while its sign-in screen is up loses that chat's id too; accepted, as the chat itself stays in Codex.

**Errors.** With no id saved, the manager simply starts a new chat. A launch that fails says Codex's own error in the manager column, as other agents' do.

### The Todo sync

**The run.** `codex exec --json --ephemeral -s read-only -C <project folder> --output-schema <file> <-c …> -` in the project folder, the prompt on stdin, `runSync`'s time limit and Stop as today. In the project folder, so Codex reads the project's instructions (`AGENTS.md`, or `CLAUDE.md` when the user's config lists it) and the project's trust; nothing can be changed there with the switches below.

**The `-c`s:**
- `features.shell_tool=false`, `web_search="disabled"`, `features.multi_agent=false`, `features.apps=false`, `features.goals=false`.
- The servers come from `codex mcp list --json`, run with the project folder as its working folder (not `-C`: with `-C` it misses the project's own servers) and the same env, before the run, so it reads the same config layers the run will.
- **Discover:** every listed server gets `mcp_servers.<s>.default_tools_approval_mode="prompt"`, so a call is refused in the background run. A per-tool `approval_mode = "approve"` the user set in their own Codex config still wins over that (Codex merges tables across config layers, so a `-c` can't clear them, and no Codex command shows them). Such a tool could run during discover; the prompt says to call none, and `readAnswer` rejects the answer and names the tool. **Accepted by the owner (2026-11-17)** over reading Codex's config files or a discover typed by hand.
- **Read:** each server that holds a confirmed tool gets `mcp_servers.<s>.enabled_tools=[its confirmed tools]` (a list, which a `-c` replaces, so nothing else of that server is offered), `default_tools_approval_mode="prompt"`, and `tools.<t>.approval_mode="approve"` for each confirmed tool. Every other listed server gets `mcp_servers.<s>.enabled=false`. So a read can call only the confirmed tools, whatever the user's own approvals say.
- A confirmed name is the model's `mcp__<namespace>__<tool>`; `<s>` is the listed server whose name, with every character outside `[A-Za-z0-9_]` turned into `_`, is `<namespace>`. A confirmed tool that maps to no listed server, or to two, refuses the sync ("Sync again to find the tools").
- A listed server whose name holds anything outside `[A-Za-z0-9_-]` (and a confirmed tool name likewise) refuses the sync with a plain error naming it: `-c` can't address it, and the run is never started unguarded.
- If the listing fails, the sync refuses with the reason.
- A server the run offers that the listing missed would keep Codex's default approval. The listing comes from the same config loader in the same folder, so none is expected; `readAnswer` rejecting any unconfirmed completed call stays as the backstop.
- Mainframe's own manager server is not in that list (it is passed only to the manager's launch).

**The answer.** `prepare` writes a strict copy of the answer schema into the project's Todo folder: every object lists all its properties in `required`, a property that was optional becomes `anyOf [its schema, {type: null}]`, `additionalProperties: false` stays. `readAnswer` from the JSONL:
- a `turn.failed` or a top-level `error` event: the run failed, with its message (an `item.completed` of type `error` is a warning, not a failure);
- any `mcp_tool_call` item with status `completed` whose `mcp__<server, cleaned as above>__<tool>` is not among the confirmed tools: "The sync used a tool that wasn't allowed: …" (in discover, any completed call);
- else the last `agent_message`'s text, parsed as JSON, top-level `null`s dropped, then `parseSyncAnswer`.

**Words and names.** `sessions: 'coding agent sessions'`, the AGENTS.md instructions wording, `toolNames: '(as mcp__<server>__<tool>, such as mcp__tracker__get_card)'`, and `noConnector`: "Mainframe looked in Codex's MCP servers: set your tracker up there (codex mcp add), then sync again." `isToolName` is Claude Code's `mcp__<server>__<tool>` check. Tools confirmed on Codex are saved with `agent: 'codex'`, as today.

**`prepare` becomes asynchronous** for the listing. While it runs, the sync counts as running (a second Sync joins it, Stop ends it), as `withModel`'s listing does. Claude Code's and OpenCode's `prepare` stay as they are in effect.

**Nothing after a run**: `--ephemeral` keeps no session.

### README

The agent lists, the requirements table (Codex from its installer, `~/.local/bin` or `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, Homebrew's cask, or PATH; npm's `codex.cmd` isn't run on Windows), `MAINFRAME_CODEX_BIN` in the env table, `.mainframe\worktrees` for Codex too (also in the Windows long-paths note), the CLAUDE.md line (`project_doc_fallback_filenames = ["CLAUDE.md"]`) and the New task box's note, Codex's trust question on a project's first task, the manager on Codex (resumes the chat it last used a Mainframe tool in; asks before starting a task, so with Codex set never to ask it can't start one; its role text replaces your own `developer_instructions` in the manager), the sync on Codex (runs on your own Codex model, reads only through tools you allowed, connectors set up with `codex mcp add`; the first sync can't stop a tool you set to "approve" in your Codex config, and Mainframe rejects a sync that used one), and that an agent found after setup is ticked by itself. Written in the README's own style, naming no project.

## Tests

- **Unit:** the manager's argv and env (new and resume, the carry-on prompt, the `-c`s, the token only in env), the id recorded from a tool call's `_meta` and ignored without it, the forget-on-early-exit rule (Codex only), the sync's argv for discover (every server `prompt`) and read (`enabled_tools`, `enabled=false` for the rest, the confirmed tools approved), the listing run in the project folder, the listing failing, a confirmed name mapped back through a cleaned server name, quoting of odd names, the strict schema (every object fully required, optionals nullable), `readAnswer` (answer, failure, warning item, a tool outside the list, nulls dropped), `prepare` running while the sync counts as running, and Stop during the listing.
- **e2e:** extend `e2e/fake-codex.cjs`: it records its argv and env for the manager; for `exec` it prints canned JSONL; for `mcp list --json` it prints a server list. Cover the manager starting on Codex and coming back with `resume <id>` after a tool call recorded an id, and a sync on Codex through to cards.
- **Hand check, no account:** the real Codex against `scripts/fake-codex-model.mjs`, extended so it can make one tool call (e.g. `list_sessions`) when the prompt asks for it, to see the id learned in the TUI and the resume after Restart. Owner runs it as the plan says.

## Constraints

- Project-agnostic and multi-project: each project's manager has its own MCP server, token and record; nothing names a project.
- Newest versions only: Codex 0.169.0 stays the floor.
- Codex isn't tried with a real model: the fake model and the e2e fake stand in, and the report says so. The strict-schema rule comes from OpenAI's documentation, not a real call.
- Windows and Linux: unit tests and CI.
- `CHANGELOG.md`: one `New:` line under `## Unreleased` (the manager and the Todo sync run on Codex).

## Left to the builder

- How the id flows from the MCP server to the manager's adapter (a callback on `startMcpServer`/`registerManagerTools`, a method on `ManagerService`), and the file's name.
- How "forget on early exit" is expressed on the adapter.
- The shape of the asynchronous `prepare` in `todoService`.
- Where the strict-schema transform lives, and whether it is generic.
- How the fake model is extended for the hand check.
