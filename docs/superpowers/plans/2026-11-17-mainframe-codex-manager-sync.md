# The manager and the Todo sync on Codex: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex runs Mainframe's manager and Todo sync, as Claude Code and OpenCode do, so a friend with only Codex gets all of Mainframe.

**Architecture:** Codex's adapter (`src/main/agents/codex.ts`) gets a real `managerLaunch` (`codex [resume <id>] -c …`, the MCP token in the launch env) and a real sync (`codex exec --json --ephemeral -s read-only --output-schema`, in a new `codexSync.ts`). The manager's chat id comes from `_meta.sessionId` on Mainframe's own MCP tool calls: `registerManagerTools` hands it to `ManagerService`, which hands it to the adapter, which keeps it in the manager's folder. The sync lists the user's MCP servers first (`codex mcp list --json`), so `SyncAdapter.prepare` may now return a promise.

**Tech Stack:** TypeScript, Electron main process, vitest, Playwright e2e, `@modelcontextprotocol/server` 2.4.0, Codex CLI 0.169.0.

**Spec:** `docs/superpowers/specs/2026-11-17-mainframe-codex-manager-sync-design.md`. Evidence: `docs/superpowers/findings/2026-11-17-codex-manager-sync-checks.md`.

## Global Constraints

- Project-agnostic: nothing in `src/` or `e2e/` names a project, path, branch, language or the owner's tools (`CLAUDE.md`).
- Multi-project: each project has its own MCP server, token, manager folder and Todo folder; nothing global (`CLAUDE.md`).
- Claude Code's and OpenCode's manager and sync behave exactly as before. Their existing tests pass unchanged.
- Codex 0.169.0 is the floor; no workarounds for older versions.
- Never read `$CODEX_HOME/sessions` or Codex's SQLite files; no hooks; no `--dangerously-*` flag in anything Mainframe runs.
- Every program runs with no shell (`execFile`/`spawn` with an argv).
- Bash: absolute paths, never chain `cd`; e2e only after asking the owner to quit their own Mainframe (memory note).
- Commits name no AI. Each task: `npm test`, `npm run typecheck` pass before its commit.

## Review Focus

1. **A user's own Codex settings must not break the manager's launch.** A user's own `[mcp_servers.mainframe]` in their config merges with Mainframe's `-c` keys. Mainframe sets `url`, `bearer_token_env_var`, `tool_timeout_sec` and the four tools' approvals itself, and the e2e checks the launch argv carries all of them. *Test in Task 4:* `codexManagerArgv` sets every key, and none comes from defaults.
2. **A Stop or a project close while `codex mcp list` runs must start no run.** *Test in Task 2.*
3. **A sync on a machine where `codex mcp list` prints nothing usable** (not JSON, an object instead of an array, entries without a string `name`) refuses with "Codex could not list its MCP servers: …", and never runs unguarded. *Test in Task 3.*
4. **A quit or project close right after a resumed Codex manager starts** must not forget its chat, even though it exited before its first report. *Test in Task 5.*
5. **An odd id arriving in `_meta.sessionId`** (not a string, empty, starting with `-`, not UUID-shaped) is never kept and so never reaches an argv. *Test in Task 4.*

---

### Task 1: The Codex sync's schema and answer

**Files:**
- Create: `src/main/agents/codexSync.ts`
- Test: `src/main/agents/codexSync.test.ts`

**Interfaces:**
- Produces:
  - `strictJsonSchema(schema: unknown): unknown`: for every JSON-Schema object node with `properties`, `required` lists all its property names, a property not in the original `required` becomes `{ anyOf: [<its schema, made strict>, { type: 'null' }] }`, and `additionalProperties: false` is set. It recurses into `properties`, `items` and `anyOf`. It never mutates its input.
  - `CODEX_SYNC_SCHEMA_JSON: string` = `JSON.stringify(strictJsonSchema(JSON.parse(SYNC_ANSWER_JSON)))`.
  - `codexNamespace(server: string): string`: every character outside `[A-Za-z0-9_]` turned into `_`.
  - `readCodexAnswer(stdout: string, tools: string[]): SyncAnswer`.

- [ ] **Step 1: Write the failing tests** in `codexSync.test.ts`:
  - `strictJsonSchema`: on `{type:'object', properties:{a:{type:'string'}, b:{type:'string'}}, required:['a']}` it gives `required: ['a','b']`, `b: {anyOf:[{type:'string'},{type:'null'}]}`, `a` unchanged, `additionalProperties: false`. A nested object inside `items` is made strict too, and the input object is deep-equal to its copy taken before the call.
  - `CODEX_SYNC_SCHEMA_JSON`: every object node in it lists all its properties in `required` and has `additionalProperties: false` (walk it). `message` is `anyOf [string, null]`.
  - `codexNamespace('my-trk')` → `'my_trk'`, `codexNamespace('a_b9')` → `'a_b9'`.
  - `readCodexAnswer`, from JSONL:
    - `thread.started`, `item.completed {type:'error', message:'Model metadata…'}`, `item.completed {type:'agent_message', text:'{"kind":"none","message":"No tracker","connector":null,"readTools":null,"lists":null,"source":null,"cards":null}'}`, `turn.completed` → `{kind:'none', message:'No tracker'}` (nulls dropped, so no `connector` key).
    - The last of two `agent_message` items is the one read.
    - `{"type":"turn.failed","error":{"message":"rate limited"}}` → throws `The sync run failed: rate limited`. A top-level `{"type":"error","message":"boom"}` → throws `The sync run failed: boom`.
    - An `item.completed` `mcp_tool_call` `{server:'my-trk', tool:'create_card', status:'completed'}` with `tools = ['mcp__my_trk__get_card']` → throws `The sync used a tool that wasn't allowed: mcp__my_trk__create_card`. With status `failed` → no throw.
    - No `agent_message` → throws `The sync run ended without an answer`. Text not JSON → throws `The sync run's answer wasn't JSON`. JSON of the wrong shape → `parseSyncAnswer`'s message.

- [ ] **Step 2: Run** `npx vitest run src/main/agents/codexSync.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the four exports in `codexSync.ts`. `readCodexAnswer` drops only top-level `null` values before `parseSyncAnswer`. Non-JSON lines are skipped (as `opencodeSync.ts`'s `events` does).

- [ ] **Step 4: Run** the test file. Expected: PASS. Then `npm test` and `npm run typecheck`.

- [ ] **Step 5: Commit**: `git add src/main/agents/codexSync.ts src/main/agents/codexSync.test.ts`, then `git commit -m "feat: the Codex sync's strict answer schema and its answer from codex exec's events"`.

---

### Task 2: `prepare` may return a promise

**Files:**
- Modify: `src/main/agents/agent.ts` (`SyncAdapter.prepare`)
- Modify: `src/main/todo/todoService.ts` (`launch`, ~line 349)
- Test: `src/main/todo/todoService.test.ts`

**Interfaces:**
- Produces: `SyncAdapter.prepare(o): SyncRunSpec | Promise<SyncRunSpec>`. The doc comment says a promise is for a run that must ask the agent something first, and that it rejects with an Error whose message is for the panel.

- [ ] **Step 1: Write the failing tests** with a Claude adapter whose `sync.prepare` returns a promise the test controls (built as the file's existing `{ ...ADAPTERS.claude, sync: { ...ADAPTERS.claude.sync, prepare } }`):
  - `a prepare that resolves later runs then, and the sync counts as running meanwhile`: after `sync()`, `view().syncing` is true and the fake `run` hasn't been called. After the test resolves with a spec, `run` is called with that spec and the outcome is the run's.
  - `a second Sync while prepare runs joins it`: two `sync()` calls give the same promise, and `run` is called once.
  - `Stop while prepare runs ends the sync and no run starts` (Review Focus 2): `cancel()`, then resolve the prepare. Outcome `{ error: SYNC_STOPPED }`, and `run` is never called. The same holds for `close()`.
  - `a prepare that rejects says why in the view`: rejecting with `Error('Codex could not list its MCP servers: x')` gives that error as the outcome and as `view().error`, with `syncing` false.

- [ ] **Step 2: Run** `npx vitest run src/main/todo/todoService.test.ts`. Expected: the four new tests FAIL.

- [ ] **Step 3: Implement.** A non-promise result keeps today's path exactly, including its synchronous refusal. A promise goes through the pattern `withModel` uses: `begin(() => {})`, and on resolve, if `this.running` is still that run, start the run on it. Extract the part that starts `runSync` and wires `done` into one private method used by both paths, so it isn't written twice. The started run's `cancel` must be the one `cancel()` calls (make `Running.cancel` assignable).

- [ ] **Step 4: Run** the file, then `npm test` and `npm run typecheck`. Expected: PASS, with every earlier todoService test unchanged.

- [ ] **Step 5: Commit**: `git commit -m "refactor: a sync's prepare may ask the agent first, with the sync counted as running"`, after adding the three files.

---

### Task 3: The Codex sync adapter

**Files:**
- Modify: `src/main/agents/codexSync.ts`
- Modify: `src/main/agents/codexInstructions.ts` (export `runCodex` and its `Run` type)
- Modify: `src/main/agents/codex.ts` (replace the `codexSync` stub and `noSync`)
- Test: `src/main/agents/codexSync.test.ts`, `src/main/agents/codex.test.ts` (drop the stub's "doesn't run on Codex yet" sync test)

**Interfaces:**
- Consumes: Task 1's exports, Task 2's promise `prepare`, `runCodex` (`(argv, {cwd, env}) => Promise<string>`), `isMcpToolName` from `claudeSync.ts`, `syncPrompt` and `agentsMdInstructions`.
- Produces:
  - `listCodexServers(o: { bin: string; projectDir: string; env: Record<string, string>; run?: Run }): Promise<string[]>`: runs `[bin, 'mcp', 'list', '--json']` with `cwd: projectDir` (not `-C`), and returns each entry's `name`. Any failure throws `Codex could not list its MCP servers: <reason>`.
  - `codexSyncConfig(step: SyncStep, tools: string[], servers: string[]): string[]`: the `-c` values in order.
  - `codexSyncArgv(o: { bin: string; projectDir: string; schemaFile: string; config: string[] }): string[]`.
  - `makeCodexSync({ run }: { run?: Run } = {}): SyncAdapter`, and `codexAgent.sync = makeCodexSync()`.

- [ ] **Step 1: Write the failing tests:**
  - `codexSyncConfig({kind:'discover'}, [], ['trk','my-trk'])` equals:
    ```
    ['features.shell_tool=false', 'web_search="disabled"', 'features.multi_agent=false', 'features.apps=false', 'features.goals=false',
     'mcp_servers.trk.default_tools_approval_mode="prompt"', 'mcp_servers.my-trk.default_tools_approval_mode="prompt"']
    ```
  - Read with `tools = ['mcp__my_trk__get_card','mcp__my_trk__list_cards']` and servers `['trk','my-trk']` gives the five feature switches, then:
    ```
    'mcp_servers.trk.enabled=false',
    'mcp_servers.my-trk.enabled_tools=["get_card","list_cards"]',
    'mcp_servers.my-trk.default_tools_approval_mode="prompt"',
    'mcp_servers.my-trk.tools.get_card.approval_mode="approve"',
    'mcp_servers.my-trk.tools.list_cards.approval_mode="approve"'
    ```
  - Refusals, each a thrown Error whose message names the thing:
    - a listed server `a.b` → `Codex's MCP server "a.b" has a name Mainframe can't pass to Codex`;
    - a confirmed tool matching no server, or two (servers `a_b` and `a-b` both clean to `a_b`) → `Sync again to find the tools: "<name>" doesn't match one of Codex's MCP servers`;
    - a tool part outside `[A-Za-z0-9_-]` → the same refusal as an odd server name, naming the tool.
  - `codexSyncArgv` → `[bin, 'exec', '--json', '--ephemeral', '-s', 'read-only', '-C', projectDir, '--output-schema', schemaFile, '-c', c1, '-c', c2, …, '-']`.
  - `listCodexServers` with a fake run: it is called with `[bin,'mcp','list','--json']` and `cwd: projectDir`, and `'[{"name":"trk","enabled":true}]'` → `['trk']`. Review Focus 3: `'not json'`, `'{}'`, `'[{"enabled":true}]'` and a rejecting run each throw `Codex could not list its MCP servers: …`.
  - `makeCodexSync({run}).prepare(...)` resolves to `{ argv, cwd: projectDir, env }`, with `codex-sync-schema.json` written in `dir` holding `CODEX_SYNC_SCHEMA_JSON`, and `argv` from the config above. With the listing failing, it rejects with that message.
  - `words`: `noConnector` is exactly `Mainframe looked in Codex's MCP servers: set your tracker up there (codex mcp add), then sync again.`, and `toolNames` is `(as mcp__<server>__<tool>, such as mcp__tracker__get_card)`. `prompt(step)` equals `syncPrompt(step, words)`. `isToolName('mcp__trk__get_card')` is true and `isToolName('get_card')` is false. `afterRun` does nothing.

- [ ] **Step 2: Run** `npx vitest run src/main/agents/codexSync.test.ts src/main/agents/codex.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** A name is passable when it matches `/^[A-Za-z0-9_-]+$/`. TOML values come from `JSON.stringify` (a string, or an array of strings). A confirmed tool maps to server `s` when it starts with `mcp__${codexNamespace(s)}__`, and the rest is the tool. The dot check covers every listed server, also in a read (so a renamed server can't slip past).

- [ ] **Step 4: Run** the two files, then `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat: the Todo sync runs on Codex: codex exec, read-only, with every MCP server set to ask and only the confirmed tools allowed"`.

---

### Task 4: The Codex manager's launch and its chat record

**Files:**
- Modify: `src/main/agents/agent.ts` (two optional adapter members)
- Modify: `src/main/agents/codex.ts`
- Test: `src/main/agents/codex.test.ts`

**Interfaces:**
- Consumes: `ManagerLaunch` (as today), `SYNC_TIMEOUT_MS`, `writeJsonAtomic` from `tasks/taskStore`.
- Produces:
  - On `AgentAdapter`: `noteManagerChat?(dir: string, sessionId: string): void` (an id the agent sent with a Mainframe tool call, kept as the chat to resume; only Codex has it) and `forgetManagerChat?(dir: string): void`.
  - `CODEX_TOKEN_ENV = 'MAINFRAME_MCP_TOKEN'`, `CODEX_CHAT_FILE = 'codex-chat.json'` (holds `{"sessionId": "<id>"}`), `CODEX_FIRST_CALL = 'Before your first answer in a chat, call list_sessions.'`.
  - `codexManagerArgv(o: { codexBin: string; url: string; rolePrompt: string; resume: string | null; prompt?: string }): string[]`.
  - `codexAgent.managerChat(dir)` reads `CODEX_CHAT_FILE` and ignores `saved`. `managerLaunch` returns `{ argv: codexManagerArgv(...), env: { [CODEX_TOKEN_ENV]: o.mcp.token } }`, with `resume: o.resume ? o.chat : null`.

- [ ] **Step 1: Write the failing tests:**
  - `codexManagerArgv({codexBin:'codex', url:'http://127.0.0.1:5/mcp', rolePrompt:'Role.', resume:null})` equals:
    ```
    ['codex',
     '-c', 'mcp_servers.mainframe.url="http://127.0.0.1:5/mcp"',
     '-c', 'mcp_servers.mainframe.bearer_token_env_var="MAINFRAME_MCP_TOKEN"',
     '-c', 'mcp_servers.mainframe.tool_timeout_sec=360',
     '-c', 'mcp_servers.mainframe.tools.list_sessions.approval_mode="approve"',
     '-c', 'mcp_servers.mainframe.tools.sync_todo.approval_mode="approve"',
     '-c', 'mcp_servers.mainframe.tools.close_session.approval_mode="approve"',
     '-c', 'mcp_servers.mainframe.tools.start_task.approval_mode="prompt"',
     '-c', 'developer_instructions="Role.\\n\\nBefore your first answer in a chat, call list_sessions."']
    ```
    (Review Focus 1: every key is set.) 360 is `(SYNC_TIMEOUT_MS + 60_000) / 1000`, computed, not typed.
  - With `resume: '01a1e9f7-dc3e-7483-81d3-5c390b1a5b42'` and `prompt: 'Continue where you left off.'`: `['codex', 'resume', <the nine -c pairs>, '01a1e9f7-…', 'Continue where you left off.']`.
  - A role prompt holding `"`, `\`, a newline and U+007F comes out as a TOML basic string: `JSON.stringify`'s escapes, plus `\u007f`.
  - `managerLaunch` with a `ManagerLaunch` whose token is `tok`: `env` is exactly `{ MAINFRAME_MCP_TOKEN: 'tok' }`, and `tok` appears in no argv element. With `resume: false` there's no `resume` in the argv, even with `chat` set.
  - `noteManagerChat(dir, id)` then `managerChat(dir, 'saved-ignored')` → `id`. A later note replaces it. `forgetManagerChat(dir)` → `managerChat` is null. Calling it with no file throws nothing.
  - Review Focus 5: `noteManagerChat` ignores `''`, `'-x'`, `'not-a-uuid'` and `'01a1e9f7-dc3e-7483-81d3-5c390b1a5b42 --x'`: `managerChat` stays as it was. A hand-edited file holding such a value reads as null. Accepted: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
  - Drop the stub's "The manager doesn't run on Codex yet." test.

- [ ] **Step 2: Run** `npx vitest run src/main/agents/codex.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** in `codex.ts`. The `-c` pairs come before the positionals. `noteManagerChat` makes `dir` if needed and writes with `writeJsonAtomic`.

- [ ] **Step 4: Run** the file, then `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat: the manager runs on Codex, with Mainframe's server, its tools' approvals and its role, and resumes the chat Codex named"`.

---

### Task 5: The manager learns its chat from tool calls

**Files:**
- Modify: `src/main/mcp/managerTools.ts`
- Modify: `src/main/manager/managerService.ts`
- Modify: `src/main/index.ts` (~line 345)
- Modify: `src/main/pty/spawnEnv.ts` (drop `MAINFRAME_MCP_TOKEN` from what sessions inherit)
- Test: `src/main/mcp/managerTools.test.ts`, `src/main/mcp/mcpServer.test.ts`, `src/main/manager/managerService.test.ts`, `src/main/pty/spawnEnv.test.ts`

**Interfaces:**
- Consumes: Task 4's `noteManagerChat` and `forgetManagerChat`.
- Produces:
  - `registerManagerTools(server, tasks, todo, onCall?: (sessionId: string) => void)`. Every tool's handler first passes on `ctx.mcpReq._meta.sessionId` when it is a string (the context is a no-input tool's first argument and an input tool's second). It is read defensively: tests call handlers with no context.
  - `ManagerService.noteToolCall(sessionId: string): void`.

- [ ] **Step 1: Write the failing tests:**
  - managerTools: a handler called with a context `{ mcpReq: { _meta: { sessionId: 'S1' } } }` calls `onCall('S1')`, for `list_sessions` (first argument) and for `close_session` (second argument). With no context, or a non-string `sessionId`, `onCall` isn't called.
  - mcpServer: an end-to-end POST of `tools/call` for a registered tool, with `params._meta.sessionId`, reaches `onCall` with that id. This proves the SDK hands `_meta` over in `ctx.mcpReq._meta`.
  - managerService, with a Codex `AgentInUse` (`{ adapter: ADAPTERS.codex, bin: 'codex', setting: {} }`):
    - `noteToolCall(id)` while the manager runs writes `codex-chat.json` in the manager's folder. The next start's launch argv has `resume` and that id. A start with nothing noted has no `resume`.
    - A resumed Codex manager that exits with no status report forgets the id, so the next start has no `resume`. One that reported `idle` first keeps it.
    - Review Focus 4: a resumed Codex manager whose exit follows `beginQuit()` keeps the id, even with no report.
    - The same early exit on a Claude Code manager leaves its `session-start.json` in place (Claude Code has no `forgetManagerChat`).
    - `noteToolCall` with no manager running does nothing and throws nothing.
  - spawnEnv: `MAINFRAME_MCP_TOKEN` in the app's environment doesn't reach a session.

- [ ] **Step 2: Run** the four files with `npx vitest run`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** `Session` keeps its `adapter`, whether it was `resumed` (`chat !== null`), and whether it has `reported` (any non-null state in `noteStatus`). `onSessionExit` calls `adapter.forgetManagerChat?.(dir)` when it was resumed, never reported, and `!this.quitting`. In `index.ts`, pass `(id) => manager.noteToolCall(id)` to `registerManagerTools`. The closure runs only after `manager` exists.

- [ ] **Step 4: Run** the files, then `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat: the manager keeps the chat Codex names in its tool calls, and forgets one Codex no longer has"`.

---

### Task 6: e2e for the manager and the sync on Codex

**Files:**
- Modify: `e2e/fake-claude.cjs` (its Codex mode)
- Modify: `e2e/codex.e2e.ts`
- Read for patterns: `e2e/agents.e2e.ts:120` (manager on OpenCode) and `:160` (sync on OpenCode), `e2e/manager.e2e.ts:149` (quit and resume)

**Interfaces:**
- The fake, as Codex:
  - `mcp list --json`: prints `codex-mcp-list.json` from the log folder if the test wrote one, else `[]`. Not recorded (like `debug prompt-input`).
  - `exec …`: the existing `sync()` (it reads stdin and prints `sync-reply.json`, here JSONL in Codex's event shape).
  - A launch records `MAINFRAME_MCP_TOKEN` in `<pid>.env`, as the OpenCode mode records its keys.
  - With `FAKE_CODEX_SESSION_ID` set, a session launch whose argv has `mcp_servers.mainframe.url="…"` POSTs one `tools/call` of `list_sessions` there, with `Authorization: Bearer $MAINFRAME_MCP_TOKEN` and `params._meta.sessionId` set to that value. It writes `<pid>.called` once answered, then runs the shell as before. Use built-ins only (`node:http`), as the file's header requires.

- [ ] **Step 1: Write the e2e tests** in `codex.e2e.ts`, with settings `{ welcomeSeen: true, defaultAgent: 'codex' }`:
  - `the manager starts on Codex with Mainframe's server, its tools' approvals and its role, the token only in its environment`: the manager's launch runs in the main checkout, its args start with `-c` (no `resume`), and they contain `mcp_servers.mainframe.url="http://127.0.0.1:`, `mcp_servers.mainframe.tools.start_task.approval_mode="prompt"` and a `developer_instructions=` holding `call list_sessions`. Its `<pid>.env` has a 64-hex `MAINFRAME_MCP_TOKEN` that no arg contains.
  - `after a tool call names the chat, the next start resumes it`: launch with `FAKE_CODEX_SESSION_ID=01a1e9f7-dc3e-7483-81d3-5c390b1a5b42`, wait for `<pid>.called`, quit, relaunch on the same data folder. The second manager launch's args start `['resume', '-c', …]` and contain the id.
  - `a sync on Codex finds the connector, then reads with only the confirmed tools`: write `codex-mcp-list.json` as `[{"name":"tracker","enabled":true}]`. The discover reply is a JSONL `agent_message` whose text answers kind `tools` with `readTools: ["mcp__tracker__get_cards"]`; its args contain `mcp_servers.tracker.default_tools_approval_mode="prompt"` and `--output-schema`. After Allow, the read reply answers kind `cards` with one card, the card shows in the Todo panel, and the read's args contain `mcp_servers.tracker.enabled_tools=["get_cards"]` and `mcp_servers.tracker.tools.get_cards.approval_mode="approve"`.

- [ ] **Step 2: Ask the owner to quit their own Mainframe**, then run `npm run test:e2e -- e2e/codex.e2e.ts`. Expected: the new tests FAIL (the fake doesn't do these yet).

- [ ] **Step 3: Implement** the fake's Codex additions above.

- [ ] **Step 4: Run** `npm run test:e2e -- e2e/codex.e2e.ts e2e/manager.e2e.ts e2e/todo.e2e.ts e2e/agents.e2e.ts`. Expected: PASS. Then the full `npm run test:e2e`.

- [ ] **Step 5: Commit**: `git commit -m "test: e2e for the manager and the Todo sync on Codex"`.

---

### Task 7: README, release note, and the hand check's fake model

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/fake-codex-model.mjs`

- [ ] **Step 1: The fake model makes one tool call.** When a request offers a namespace `mcp__mainframe` with `list_sessions`, and its input's last item is a user message (not a `function_call_output`), it answers with one `function_call` (`namespace: 'mcp__mainframe'`, `name: 'list_sessions'`, `arguments: '{}'`). Otherwise it answers as today. Shape as in the findings file. Its start line also says: make Codex the default in Settings, type in the manager, Quit, start again, and the manager comes back in the same chat.

- [ ] **Step 2: README**, in its own style, naming no project:
  - Codex in the intro, the agent lists and the requirements table: its installer (`~/.local/bin`; `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` on Windows), Homebrew's cask, or PATH. npm's `codex.cmd` isn't run on Windows.
  - `MAINFRAME_CODEX_BIN` in the env table.
  - `.mainframe/worktrees` for Codex's tasks, in the board bullet and the Windows long-paths note.
  - The CLAUDE.md line `project_doc_fallback_filenames = ["CLAUDE.md"]` and the New task box's note.
  - Codex's trust question on a project's first task.
  - The manager on Codex: it resumes the chat it last used a Mainframe tool in; it asks before starting a task, so with Codex set never to ask it can't start one; its role replaces your own `developer_instructions` in the manager.
  - The sync on Codex: it runs on your own Codex model, sets connectors up with `codex mcp add`, and reads only through tools you allowed. The first sync can't stop a tool you set to "approve" in your Codex config, and Mainframe rejects a sync that used one.
  - The setup screen's Find codex… button, and an agent found after setup being ticked by itself.

- [ ] **Step 3: CHANGELOG.md**: directly under `## Unreleased`, above the lines there: `New: The manager and the Todo sync run on Codex too.`

- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "docs: README and release note for the manager and the Todo sync on Codex; the fake model makes a tool call"`.

---

## After the last task

Follow `CLAUDE.md`: `/simplify` on `main...HEAD`, the final whole-branch review, then `/code-review high` on `main...HEAD`, the three suites, and the tips recorded. The owner's hand check follows `scripts/fake-codex-model.mjs`'s start line: the manager on Codex learns its chat and resumes it after Quit, and asks before starting a task. A real model's behaviour stays untested (no account), and the report says so.
