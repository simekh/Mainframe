# Mainframe plan 2b, part 1: the manager — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A manager session runs in its own column on the left of the window. It is an ordinary `claude` in the project's main checkout, with an appended role prompt and Mainframe's MCP server.
- It starts with the app and continues its chat after a restart, under the same carry-on rules as tasks.
- It can list the sessions and start a task when the owner asks. A task it starts lands under Working without being selected.

**Architecture:**
- **Main process.**
  - A `ManagerService` sits beside `TaskService` and owns the manager's one session. It launches it, resumes it, records where its turn was, and restarts it.
  - Both services take their carry-on rules from one small shared module.
  - An MCP server runs in main, over Streamable HTTP on `127.0.0.1` with a bearer token. It has two tools, which call `TaskService`.
  - The IPC spawn handler sends each session id to the service that owns it.
- **Renderer.** A `ManagerColumn` holds the manager's header and its terminal, built on the existing `TerminalView`. A resize edge is taken out of `SidePanel` so that both can use it.

**Tech Stack:** Electron 44, electron-vite 6, SolidJS 1.9, TypeScript 5.9, xterm.js 6.1 beta, node-pty 1.1, Vitest 5, Playwright 1.64, plus three new dependencies (Global Constraints).

**Spec:** `docs/superpowers/specs/2026-11-06-mainframe-manager-and-todo-design.md`. This plan covers §3's manager column and §4. It also covers §9's checks for this part, and the first of the two parts §10 suggests. Read the main spec's §2, §7.4 and §11 for context, and the step 1 findings `docs/superpowers/findings/2026-11-05-step1-checks.md` §11.1 (the owner's `auto` mode).

**Design:** `docs/superpowers/mockups/2026-11-06-plan-2b-manager-layout.html`, frame 1 ("Todo hidden"). The Todo button and the edge handle in it belong to part 2; leave them out.

**Facts checked against the current docs on 2026-11-06** (Claude Code v2.1.319 on the owner's machine). A task that relies on one of these cites it.
- **D1. The role prompt is recorded once.** A resumed conversation keeps the system prompt recorded on its first request until it is compacted. Different `--append-system-prompt` text "takes effect once the conversation is compacted or when you start a new conversation" (cli-reference, "System prompt flags in resumed conversations").
- **D2. `--mcp-config` takes several values.** It loads "MCP servers from JSON files or strings (space-separated)". An HTTP entry is `{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}`, and an entry with a `url` but no `type` is a config error (mcp.md).
- **D3. Allow rules must name a server.** `mcp__<server>__*` matches every tool of one server. An unanchored allow glob such as `mcp__*` "is skipped and doesn't auto-approve anything". A `--settings` file can set `permissions.allow`, and lists from several files combine (permissions.md, settings.md).
- **D4. HTTP tool calls time out after 60 s** by default, counted to the server's first response byte. A main-conversation MCP call still running after two minutes moves to a background task (mcp.md, "Time limits on MCP tool calls"). This part's tools answer at once; part 2's Sync tool needs a longer `timeout`.
- **D5. The MCP SDK is v2.** It ships as `@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/node` 2.1.2. Tools are registered with `registerTool(name, { description, inputSchema: z.object(…) }, handler)`, and the variadic `.tool()` is removed. It needs zod ≥ 4.2. `createMcpHandler` plus `toNodeHandler` serve stateless HTTP, with `localhostHostValidation` and `localhostOriginValidation` guards (typescript-sdk `docs/serving/http.md`).

## Global Constraints

- **Paths:** `<root>` = `/Users/simonekholm/Developer/Simmesolo/Mainframe` and `<damela>` = `/Users/simonekholm/Developer/Simmesolo/Damela`. Every command passes absolute paths (`npm --prefix <root> …`, `git -C <dir> …`), and never `cd x && …`.
- **Work on the branch `manager`, made from `main`.**
- **New dependencies, pinned exactly:**
  - `@modelcontextprotocol/server@2.4.0` and `@modelcontextprotocol/node@2.1.2`;
  - `zod`, at the newest 4.x that satisfies the server's peer range.

  Check each with `npm view <pkg>@<version>` before installing. There are no other new dependencies.
- **Manager launch forms.** cwd is always the project's main checkout, and the launch never goes through a shell.
  - First launch: `claude -n <project>-manager --session-id <uuid> --mcp-config <mcp.json> --settings <settings.json> --append-system-prompt <ROLE_PROMPT>`
  - Resume: `claude --resume <uuid> --mcp-config <mcp.json> --settings <settings.json> --append-system-prompt <ROLE_PROMPT> [<carry-on prompt>]`
  - The order is fixed (D2): nothing positional may follow `--mcp-config`, so the carry-on prompt comes last, after the role prompt.
  - No `-w`, no `--permission-mode`, no `--system-prompt-snapshot`.
  - `<project>` is `sessionName(projectDir, 'manager')`.
- **The role prompt is passed on every launch.** Under D1 a resumed chat keeps its first one, so the role prompt says only what the manager is. How each tool is used goes in that tool's description, which is current on every request. The text is exactly:

  ```
  You are the manager in Mainframe, the app the owner uses to run several Claude Code sessions on this project at once, one per task. You run in the project's main checkout; each task runs in a worktree of its own and shows on Mainframe's board.

  The owner talks to you about their to-do list, about the work in progress, and about work that has no task yet. Mainframe's tools (mainframe) let you list the task sessions and start new ones. Start a session only when the owner asks you to.

  You may make small changes yourself, following this repo's CLAUDE.md. Work that needs a branch of its own should become a task, so that it shows on the board.
  ```

- **Mainframe's files** for the manager live in `<dataDir>/managers/<key>/`, with `<key>` = `<slugify(basename(projectDir))>-<first 8 hex of sha256(projectDir)>`:
  - `manager.json` holds `{ "version": 1, "projectDir", "claudeSessionId", "midTurn"?, "askAgain"? }`;
  - `settings.json` holds the SessionStart hook as for tasks, plus `"permissions": { "allow": ["mcp__mainframe__*"] }` (D3; design §4.2, owner);
  - `session-start.json` is written by the hook;
  - `mcp.json` holds `{"mcpServers":{"mainframe":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`, written with mode `0600`.
- **The MCP server** listens on `127.0.0.1`, port `0`, path `/mcp`. A new 32-byte random token, hex, is made each app run.
  - A request without `Authorization: Bearer <token>` gets 401 before the SDK sees it. The comparison is constant-time.
  - The token never appears in an argv.
- **The app never edits the owner's or a repo's settings files** (spec §2, design §4.2).
- **Session state comes only from OSC 7501** (spec §2).
- **UI work** (Task 4) invokes `frontend-design:frontend-design` first. The look is `src/renderer/src/app.css` and the mockup.
- **Motion** respects `prefers-reduced-motion: reduce`.
- **Commit messages** use conventional prefixes and carry no AI attribution of any kind.
- **e2e windows** open on the owner's screen. Tests must not depend on the real mouse staying still. No e2e run reaches the owner's Trello or browser.

## Review Focus

1. **The manager takes the keyboard.** Typing goes where the owner last clicked:
   - no manager terminal mounting, at launch or on Restart, takes the focus by itself;
   - Ctrl+Tab never selects the manager;
   - keys typed into a task's terminal never reach the manager.

   Pinned by the focus e2e in Task 3, and the Ctrl+Tab and Restart e2e tests in Task 4.
2. **Quitting with the manager running is treated as an exit.** Quit must record where its turn was, then resume at the next start: with `Continue where you left off.` if it was mid-turn, and with nothing if it was idle. It must never show Restart at the next start. Pinned by the quit unit tests in Task 1 and the relaunch e2e in Task 3.
3. **The manager's launches break the task tests and the task logic.** e2e helpers that count launches must count only tasks. The manager must never appear on the board, in Needs you, in `list()`, or in `state.json`. Pinned by the `launches` change and the "no task launches" assertion in Task 3.
4. **Something other than the manager reaches the MCP endpoint.** Without the token the answer is 401. A `Host` other than `127.0.0.1`/`localhost` is refused. `mcp.json` is `0600`. Pinned by the server tests in Task 2 and the file-mode assertion in Task 3.
5. **The window is narrow with the manager column and the pinned session panel both showing.** The board keeps its room, the session panel's width clamps with the column's width taken off, and every terminal's `termSize` still equals `stty size` after the column is resized. Pinned by the resize e2e in Task 4.

---

## File structure

```
src/main/tasks/carryOn.ts           RESUME_PROMPT, ASK_AGAIN_PROMPT, inTurn, turnAtEnd, resumePromptFor (moved out of taskService.ts)
src/main/tasks/launch.ts            + managerArgv; hookSettings gains an allow list
src/main/manager/managerService.ts  ManagerService and its manager.json
src/main/manager/rolePrompt.ts      ROLE_PROMPT
src/main/mcp/mcpServer.ts           startMcpServer, mcpConfigJson
src/main/mcp/managerTools.ts        list_sessions, start_task
src/main/tasks/taskService.ts       + reports(); noteStatus keeps the status's msg
src/main/index.ts, ipc.ts, src/preload/index.ts, src/shared/{types,ipc}.ts   wiring
src/renderer/src/manager/managerStore.ts, ManagerColumn.tsx   (Task 3 bare, Task 4 complete)
src/renderer/src/manager/managerPrefs.ts                       the column's width
src/renderer/src/panel/ResizeEdge.tsx   the drag edge, out of SidePanel.tsx
e2e/manager.e2e.ts, e2e/tasks.ts (launches, managerLaunches, mcpCall)
```

---

### Task 1: The manager's session in main

**Files:**
- Create:
  - `src/main/tasks/carryOn.ts` (+ `carryOn.test.ts`);
  - `src/main/manager/rolePrompt.ts`;
  - `src/main/manager/managerService.ts` (+ `managerService.test.ts`).
- Modify:
  - `src/main/tasks/taskService.ts`, to use `carryOn.ts`, with no change in behaviour;
  - `src/main/tasks/launch.ts` (+ `launch.test.ts`).

**Interfaces:**
- **Produces (`carryOn.ts`):**
  - the moved constants `RESUME_PROMPT` and `ASK_AGAIN_PROMPT`, and `inTurn(state: ProgramState | null): boolean`;
  - `turnAtEnd(lastState: ProgramState | null, resumePending: boolean): { midTurn: boolean; askAgain?: boolean }`. It returns `{ midTurn: true, askAgain: lastState === 'blocked' }` in a turn, and `{ midTurn: resumePending }` otherwise; `askAgain` is left as it was;
  - `resumePromptFor(r: { midTurn?: boolean; askAgain?: boolean }): string | undefined`.
- **Produces (`launch.ts`):**
  - `hookSettings(dir: string, allow: string[] = [])`. With a non-empty `allow` it adds `permissions.allow`; the tasks' file stays byte-identical.
  - `managerArgv(o: { claudeBin: string; name: string; claudeSessionId: string; resume: boolean; mcpConfigPath: string; settingsPath: string; rolePrompt: string; prompt?: string }): string[]`. It gives the two forms in Global Constraints, and throws on a non-UUID id when `resume` is set.
- **Produces (`managerService.ts`):**
  - `ManagerView = { session: { id: string; startedWithPrompt: boolean } | null }`, exported from `src/shared/types.ts`;
  - `ManagerServiceDeps = { projectDir; dataDir; claudeBin; mcpConfig: string; kill(sessionId: string): void; onChange(view: ManagerView): void; newId?; warn? }`;
  - `class ManagerService` with:
    - `start(): ManagerView`: launches unless a session runs, and is used at app start and by Restart;
    - `view()`;
    - `owns(sessionId): boolean`;
    - `launchSpec(sessionId): { argv: string[]; cwd: string }`;
    - `noteStatus(sessionId, state: ProgramState | null)`;
    - `onSessionExit(sessionId)`;
    - `beginQuit()`.

**Rules:**
- **`start()`:**
  - It writes `settings.json` and `mcp.json` (`0600`) on every launch, since the port and token change each run.
  - With a recorded `session-start.json` id, it resumes with `prompt: resumePromptFor(record)`. Otherwise it uses the first form with a fresh `claudeSessionId`, as tasks do (plan 2a F1).
  - It then clears `midTurn`, saves `manager.json`, and gives the session `startedWithPrompt` and `resumePending` from whether a carry-on prompt was sent. These are the same rules as `TaskService.reopen`.
  - It ends by sending `onChange(view)`. A window that asked before the start then still learns the session id.
- **Ending:**
  - `noteStatus`, the ending flag and `markEnding` behave as in `TaskService`, through `turnAtEnd`.
  - `onSessionExit` records the id SessionStart last wrote, saves, and sends `onChange` with `session: null`.
  - `beginQuit` marks every session ending, then saves.
  - There is no `open` flag: the manager always starts with the app.
- **A `manager.json` that won't parse** is reported with `warn` and treated as missing, which starts a new chat. A newer `version` is left unread and untouched, and is not overwritten. In that case `start()` throws a clear error and the column shows it (cost if wrong: one new chat).

- [ ] **Step 1: Write the failing tests.**
  - `carryOn.test.ts`: the `turnAtEnd` table for `working`, `blocked`, `idle`, `done`, `error` and `null`, with `resumePending` both ways; `resumePromptFor` for the three cases.
  - `launch.test.ts`:
    - `managerArgv` gives exactly the two Global Constraints forms;
    - the prompt is last and `--mcp-config` is never the element before it;
    - it throws on `resume` with `'not-a-uuid'`;
    - `hookSettings(dir, ['mcp__mainframe__*'])` has `permissions.allow` equal to that list;
    - `hookSettings(dir)` equals plan 2a's output.
  - `managerService.test.ts`, with fake `kill`/`onChange`, a temp `dataDir` and a counting `newId`:
    - the first `start()` gives the first form with cwd `projectDir`, writes the three files, gives `mcp.json` mode `0o600`, and sends `onChange` with the session;
    - a second run's `start()` over an existing `mcp.json` leaves it at `0o600` with the new contents;
    - `start()` while a session runs returns the same view and launches nothing;
    - with `session-start.json` present, `start()` resumes that id;
    - a session ended `working` (exit, then `start()`) resumes with `RESUME_PROMPT`, and one ended `blocked` with `ASK_AGAIN_PROMPT`;
    - `beginQuit` with a `working` session, then a new `ManagerService` on the same folder, then `start()`, gives the resume with `RESUME_PROMPT`;
    - an `idle` one resumes with no prompt;
    - an exit sends `onChange({ session: null })`;
    - a corrupt `manager.json` warns and starts fresh;
    - `owns` is false for task session ids.
  - `taskService.test.ts` is unchanged and still passes.
- [ ] **Step 2: Run them to see them fail.** Run `npm --prefix <root> test -- src/main`.
- [ ] **Step 3: Implement.** Move the carry-on rules out of `TaskService` first and run its tests, then build `ManagerService`. `ROLE_PROMPT` is the Global Constraints text exactly.
- [ ] **Step 4:** Run `npm --prefix <root> test` and `… run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: a manager session that starts with Mainframe and carries on its chat`.

### Task 2: Mainframe's MCP server and the manager's two tools

**Files:**
- Create:
  - `src/main/mcp/mcpServer.ts` (+ `mcpServer.test.ts`);
  - `src/main/mcp/managerTools.ts` (+ `managerTools.test.ts`).
- Modify:
  - `src/main/tasks/taskService.ts` (+ test);
  - `package.json` and the lockfile.

**Interfaces:**
- **Produces (`mcpServer.ts`):**
  - `startMcpServer(register: (server: McpServer) => void): Promise<{ url: string; token: string; close(): Promise<void> }>`;
  - `mcpConfigJson(url: string, token: string): string`.
- **Produces (`taskService.ts`):**
  - `noteStatus(sessionId, state, msg?: string)`, which also keeps the status's `msg`;
  - `reports(): SessionReport[]`, oldest first, where `SessionReport = { taskId, title, branch, worktreePath, claudeSessionId, createdAt, closedAt, running: boolean, state: ProgramState | null, msg: string | null }`.
- **Produces (`managerTools.ts`):** `registerManagerTools(server: McpServer, deps: { reports(): SessionReport[]; start(req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView>; startCheck(): Promise<StartCheck | null> }): void`.
- **`list_sessions`:**
  - no input;
  - description: `Every task session Mainframe runs for this project, with its title, branch, worktree, Claude session id, whether it runs, and its last reported state (working, idle, blocked, done, error; null before the first report) and message. Read a task's worktree and its git history to say what it is doing.`;
  - result: one text block, `JSON.stringify({ sessions })`.
- **`start_task`:**
  - input `z.object({ title: z.string().min(1).max(200), brief: z.string().max(20000), noQuestions: z.boolean().optional() })`;
  - description: `Starts a task session in a worktree of its own; it shows on the board under Working. Only when the owner asks for it. The title names the task; the brief is what the session starts from. noQuestions: the owner said not to ask them questions.`;
  - it runs `startCheck()` first, then `start({ title, description: brief, noQuestions: noQuestions ?? false })`;
  - result: `{ taskId, title, branch, warning? }`. `warning` is present only when `ahead > 0`, worded as `NewTaskDialog` words it: `<branch> has N commit(s) that aren't on <base>. New worktrees start from <base>, so this task won't have it/them.`;
  - a thrown error becomes an `isError` result with its message.
- The model sees the raw OSC 7501 state, not the board's lanes. The lane table stays in the renderer (cost if wrong: the manager may call a task idle in its first seconds, where the board says Starting…).

- [ ] **Step 1: Write the failing tests.**
  - `managerTools.test.ts`, calling the registered handlers through a fake `McpServer` that records `registerTool`:
    - exactly two tools, `list_sessions` and `start_task`, with the descriptions above;
    - `start_task` maps `brief` to `description` and defaults `noQuestions` to false;
    - `warning` appears only when `startCheck` reports `ahead: 2`, as `stage has 2 commits that aren't on origin/stage. New worktrees start from origin/stage, so this task won't have them.`;
    - a `start` that rejects with `A task needs a title` gives `isError`;
    - `list_sessions` returns `reports()` as JSON.
  - `mcpServer.test.ts`:
    - `startMcpServer` listens on `127.0.0.1` with a random port;
    - a POST to `/mcp` without the token gets 401, and with a wrong token 401;
    - with the token, a `tools/list` JSON-RPC request lists what `register` added;
    - a request with `Host: evil.example` is refused;
    - `mcpConfigJson` gives the Global Constraints shape;
    - `close()` frees the port.
  - `taskService.test.ts`: `reports()` gives a running task with the last state and msg, and a closed one with `running: false`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - Install the three pinned packages after checking them with `npm view`.
  - Read the SDK's current `docs/serving/http.md` before writing the server (D5; owner's CLAUDE.md). Use `createMcpHandler` and `toNodeHandler` with the localhost Host and Origin guards, and put the token check in front.
  - Then run `npm --prefix <root> run build` and load the bundle. If `out/main/index.js` can't `require` an ESM-only package, bundle those packages (electron-vite's `build.externalizeDeps.exclude`) and say so in the report.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run build`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Mainframe's MCP server, with list_sessions and start_task for the manager`.

### Task 3: Wiring the manager into the app, with its terminal on screen

A session spawns only when its terminal mounts, so this task already puts the manager's terminal in a bare column at the window's left. Task 4 builds the rest of the column.

**Files:**
- Modify:
  - `src/main/index.ts`;
  - `src/main/ipc.ts`;
  - `src/preload/index.ts`;
  - `src/shared/ipc.ts` and `src/shared/types.ts`;
  - `src/renderer/src/terminal/TerminalView.tsx`;
  - `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts` and `src/renderer/src/app.css`, for the mount and the e2e hooks;
  - `e2e/tasks.ts`, whose `launches` now leaves the manager's out; add `managerLaunches` and `mcpCall`.
- Create:
  - `src/renderer/src/manager/managerStore.ts`;
  - `src/renderer/src/manager/ManagerColumn.tsx`, with only the terminal for now.
- Test: `e2e/manager.e2e.ts`.

**Interfaces:**
- **Bridge:**
  - `getManager(): Promise<ManagerView>` on `manager:get`;
  - `restartManager(): Promise<ManagerView>` on `manager:restart`;
  - `onManager(cb: (view: ManagerView) => void): () => void` on `manager:changed`.
- **ipc.ts:**
  - The spawn handler picks the owner per session id, as `ownerOf(id): Pick<TaskService, 'launchSpec' | 'noteStatus' | 'onSessionExit'>`, which is `manager.owns(id) ? manager : service`.
  - It uses the owner for `launchSpec`, for `noteStatus(id, status?.state ?? null, status?.msg)` and for `onSessionExit`.
  - `ManagerService.noteStatus` takes two parameters, which TypeScript accepts for this type.
- **`TerminalView`** gains `takeFocus?: boolean`, default `true`, which keeps today's behaviour. With `false`, showing never focuses it.
- **`managerStore`:**
  - `manager: ManagerView`, loaded with `getManager` and updated by `onManager`;
  - `managerTerminal: string | null`: the running session's id, or the last one's.
- **`ManagerColumn`** (bare): `data-testid="manager-column"`, at the window's left, full height, 400 px wide. It holds one `TerminalView` for `managerTerminal` with `selected` and `takeFocus={false}`.
- **e2e hooks:** `managerScreen(): string` and `managerTermSize(): { cols; rows } | null`.
- **index.ts:**
  - `start` becomes `async`.
  - Before the window: start the MCP server with `registerManagerTools(server, { reports, start, startCheck })` bound to the `TaskService`. Then create `ManagerService` with `mcpConfig: mcpConfigJson(url, token)`.
  - After the window: `manager.start()`, logged and never thrown. On a failure the column shows Restart.
  - `before-quit`: `service.beginQuit()`, then `manager.beginQuit()`, then `host.killAll()`, with each `beginQuit` logged and never thrown.
- **e2e helpers:**
  - `launches(dataDir)` drops launches whose args include `--append-system-prompt`;
  - `managerLaunches(dataDir)` keeps only those;
  - `mcpCall(dataDir, method, params, { token?: string | null })` reads the manager's `mcp.json` and POSTs one JSON-RPC request, with the token unless `token: null`. It returns `{ status, body }`.

- [ ] **Step 1: Write the failing e2e tests** in `e2e/manager.e2e.ts`.
  - `the manager starts with the app in the main checkout, with Mainframe's tools allowed`:
    - exactly one manager launch, with cwd = `MAINFRAME_PROJECT_DIR` and args in the first form;
    - its `settings.json` allows `mcp__mainframe__*` and has the SessionStart hook;
    - its `mcp.json` is mode `0600` and points at `http://127.0.0.1:`, with a bearer header;
    - `launches()` is empty and the board has no cards.
  - `the manager's tools answer only with the token, and start_task starts a task that isn't selected`:
    - `mcpCall` without the token gives 401;
    - `tools/list` gives `list_sessions` and `start_task`;
    - first start a task with New task, so one is selected. Then `start_task { title: 'From the manager', brief: 'Say hi' }` returns a `taskId` whose card shows under Working;
    - the earlier task is still selected, and its terminal still has the focus;
    - `list_sessions` includes the new task with `running: true`.
  - `quitting resumes the manager's chat at the next start, carrying on a turn it was in`:
    - once `managerScreen()` shows the shell prompt, report `working` in the manager's terminal with `report('working')`, through `window.mainframe.write` to the manager's session;
    - quit, then relaunch on the same data folder;
    - the newest manager launch is the resume form for the same id, ending with `Continue where you left off.`;
    - repeat with `idle`: no prompt.
  - `the manager never takes the focus by itself`:
    - right after launch, the active element is not inside `manager-column`;
    - start a task and type `echo task-only`: the task's screen has it, and `managerScreen()` doesn't;
    - a click on the manager's terminal moves typing there.
  - `the manager's terminal fits its column`: after a click in it, `stty size` typed there equals `managerTermSize()`.
- [ ] **Step 2: Run them to see them fail.** Run `npm --prefix <root> run test:e2e -- manager`.
- [ ] **Step 3: Implement.** Keep plan 2a's order: the service before the window, and nothing that can throw after it. The column needs only enough CSS to sit in the layout; Task 4 styles it.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass, including every earlier e2e file.
- [ ] **Step 5: Commit** `feat: Mainframe starts its manager, and the manager's tools reach the tasks`.

### Task 4: The manager column: header, Restart and width

**Files:**
- Create:
  - `src/renderer/src/manager/managerPrefs.ts` (+ test);
  - `src/renderer/src/panel/ResizeEdge.tsx`.
- Modify:
  - `src/renderer/src/manager/ManagerColumn.tsx` and `managerStore.ts`;
  - `src/renderer/src/App.tsx`;
  - `src/renderer/src/panel/SidePanel.tsx`, which uses `ResizeEdge` and clamps with the column's width taken off;
  - `src/renderer/src/board/lanes.ts`, whose `glyphOf`/`stateLabel` take `Pick<TaskView, 'session'>`;
  - `src/renderer/src/app.css`.
- Test: `e2e/manager.e2e.ts`.

**Interfaces:**
- **`managerPrefs.ts`:**
  - the constants `MANAGER_WIDTH = { default: 400, min: 320, max: 640 }`;
  - `clampManagerWidth(w, windowWidth)`. Its maximum is also capped at `windowWidth − 780`, which leaves the session panel's minimum and the board's room; the minimum wins when the window is too narrow;
  - `loadManagerWidth(storage)` and `saveManagerWidth(storage, w)` on key `mainframe.manager`, with the same fallbacks as `panelPrefs.ts`.
- **`ResizeEdge`:**
  - props `{ width: number; onDrag(w: number): void; onDone(w: number): void; grows: 'left' | 'right'; label: string; testId: string; min: number; max: number }`;
  - pointer capture and arrow keys of 16 px, as `SidePanel` has them today;
  - `SidePanel`'s behaviour and its `panel-resize` test id stay the same.
- **`SidePanel`** gains `besideWidth: number`. It clamps with `clampWidth(w, windowWidth − besideWidth, pinned)`.
- **`managerStore`** gains `restartManager()`, which focuses the new terminal once it is mounted.
- **`ManagerColumn`:**
  - Its width comes from `managerPrefs`.
  - Its top 46 px is a drag region holding the window buttons, so `.topbar` loses its 90 px inset.
  - The header shows `StatusGlyph` with `glyphOf(manager, sessionState)`, the title `Manager` (`manager-title`), the project chip, and the state label (`manager-state`).
  - With `session: null`, it shows `The manager stopped. Restart continues its chat.` and a Restart button (`manager-restart`).
  - Its resize edge is `manager-resize`, on its right side.

- [ ] **Step 1: Write the failing tests.**
  - `managerPrefs.test.ts`: the clamp table at window widths 1400, 1100 and 900; a bad stored value falls back to 400.
  - e2e, in `e2e/manager.e2e.ts`:
    - `the manager column sits left of the board, and its top strip holds the window buttons`:
      - the column's right edge is at or left of the board's left edge;
      - the column's top strip computes `-webkit-app-region: drag`, and nothing that takes clicks starts within its first 90 px;
      - `.topbar`'s left padding is no longer 90 px.

      The native buttons can't be captured from the page, so the owner checks their padding in Task 5 (plan 2a Task 5 ruling).
    - `Ctrl+Tab skips the manager`: report `blocked` in the manager's terminal with no task waiting. Ctrl+Tab selects nothing, and the manager's header shows `Needs input`.
    - `Restart continues the manager's chat after it exits`:
      - `exit` in its terminal shows `manager-restart` and the stopped note;
      - clicking it gives a new manager launch in the resume form for the same id;
      - its terminal then has the focus.
    - `dragging the manager's edge resizes it, keeps the width, and its terminal fits`:
      - drag `manager-resize` by +80 px, then press ArrowRight once: width 400 + 80 + 16;
      - a relaunch on the same data folder keeps it;
      - `stty size` equals `managerTermSize()`;
      - a selected task's `termSize` still equals its `stty size`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - Invoke `frontend-design:frontend-design` first, and build to the mockup's frame 1.
  - The column uses the panel's surfaces: `--task-container-bg`, `--island-border`, `--radius-lg`, and the 8 px margin.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the manager's column on the left of the window`.

### After Task 4: simplify, then the final review

- Run `/simplify` on the branch's diff (project CLAUDE.md). Then run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`.
- Then run the final whole-branch review. Task 5 runs afterwards with the owner, and its fixes get their own review (plan 2a, Ruling 3).

### Task 5: Acceptance with the owner

The owner is at the keyboard with real Claude Code in Damela.

**Files:**
- Create: `docs/superpowers/findings/<date>-plan-2b-manager-acceptance.md`, with one row per check (check, seen, pass/fail, note), in the style of `docs/superpowers/findings/2026-11-06-plan-2a-acceptance.md`.

- [ ] **Step 1: Run the checks with the owner.**
  1. **The manager starts with the app.** Asked what it can do, it names listing and starting sessions.
  2. **"What's running?"** It calls `list_sessions` with no permission prompt. Record whether the `--mcp-config` server asked for approval at launch (D2 left this open).
  3. **"Start a task to …"**
     - the card appears under Working, unselected, and typing stays in the manager;
     - the task's opening prompt carries the brief;
     - a start-check warning, if the main checkout is ahead, reaches the manager.
  4. **Quit and start again:**
     - with the manager mid-turn, it carries on;
     - with it idle, it waits.
  5. **`/clear` in the manager, then restart the app:** the cleared chat continues (design §4.1).
  6. **`/exit`, then Restart:** the same chat continues.
  7. **Feel:**
     - typing, paste and scrolling in the manager's terminal compared with iTerm2;
     - dragging the column;
     - the board's room on the laptop screen with the session panel pinned.
  8. **The name:** the manager shows as `damela-manager` in `claude --resume`.
  9. **The window buttons:** their padding in the manager column's top strip.
- [ ] **Step 2: Fix what failed** as plan 2a Task 10 did: a test where one can pin it, the fix, the full test runs, and the owner re-checks that row. Anything else goes in the file as open.
- [ ] **Step 3: Commit** `docs: plan 2b part 1 acceptance findings`.

---

## After this plan: part 2, the Todo panel

Written once this part is built, from design §5–§7, on top of this plan's MCP server and column. These facts were checked on 2026-11-06 and shape it:

- **The background sync run:** `claude -p` in the main checkout. Connectors load there as in an interactive session, but only with a claude.ai subscription login (mcp.md, "Use MCP servers from claude.ai"; headless.md).
- **The run may call only the confirmed read tools of the to-do connector and `set_todo_list`** (design §5.3). Never `bypassPermissions`: it would let the run use every connector the owner has, including Google Drive's and Notion's write and delete tools, and the run reads card text that anyone on the board can write.
  - The first sync names the read tools, and the owner confirms them.
  - To verify while planning part 2:
    - that `--tools ""` plus `--permission-mode dontAsk` plus `--allowedTools <confirmed names>` denies everything else in `-p`;
    - that the owner's own `permissions.allow` rules can be kept out of the run, since `dontAsk` still runs what they allow (`--setting-sources` or similar);
    - that a claude.ai connector's tools can be named in `--allowedTools`.
- **More flags for the run:**
  - `--model haiku`;
  - `--no-session-persistence`, which keeps the run out of `--resume`;
  - `--output-format json` (`result`, `subtype`, `is_error`, `errors`);
  - a sync-only `--mcp-config` that holds just `set_todo_list`.
- **The manager's Sync tool** waits for the run. Its server entry in the manager's `mcp.json` needs `"timeout": 300000`, because of the 60 s per-request limit (D4). A wait over two minutes moves to a background task in the manager's chat, which is acceptable.
- **Since a resumed manager keeps its first role prompt** (D1), everything about Sync goes in the tool's description, and nothing in the role prompt.
