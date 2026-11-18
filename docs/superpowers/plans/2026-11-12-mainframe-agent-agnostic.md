# Mainframe Without a Required Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code becomes optional. The first start asks which agents to use and which one is the default, a Settings dialog changes that later, and the manager, the Todo sync and new tasks all run on the default agent, whether that is Claude Code or OpenCode.

**Architecture:** One adapter per agent sits in `src/main/agents/` (`claude.ts` and `opencode.ts`, with their sync halves in `claudeSync.ts` and `opencodeSync.ts`), behind `AgentAdapter` in `agent.ts`. The adapters hold every flag, config key and file layout of the two agents. `TaskService`, `ManagerService` and `TodoService` ask an adapter for launches, for the words their prompts use, and for the sync's run and how to read its answer. `settings.json` version 2 keeps each agent's tick, its path and its options. An `AgentsInUse` object, made at start and shared by every open project, says which agent to run and from which path. The Settings dialog changes what it holds. The OpenCode manager gets Mainframe's MCP server, its rules and its role prompt through `OPENCODE_CONFIG_CONTENT`. The OpenCode sync is an `opencode run`, and Mainframe reads its answer from the run's JSON events.

**Tech Stack:** Electron, TypeScript, Solid, node-pty, zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-mainframe-agent-agnostic-design.md`. The OpenCode facts are in `docs/superpowers/findings/2026-11-12-opencode-manager-and-sync.md`: trust its "Checked by hand" section. OpenCode 2.2.7's source, read-only and untrusted, is at `/private/tmp/claude-501/-Users-simonekholm-Developer-Simmesolo-Mainframe/d4d15e14-2045-46a5-802a-27aa7894f0da/scratchpad/src/opencode`. Below it is called `<oc>`.

## Global Constraints

- `AgentName` (`'claude' | 'opencode'`) stays the key everywhere: in records, IPC, settings and the renderer. `AGENT_ORDER = ['claude', 'opencode']` sets the order in which lists show them, and Claude Code is first wherever a choice starts.
- **A Claude Code launch stays byte for byte as it is today** (task, reopen, manager, sync). The existing tests prove it, and they may change only in imports, call sites and deps.
- **Nothing outside `src/main/agents/` names a CLI flag, a config key or a file layout of either agent.** Other code may branch on an `AgentName` or on an adapter field.
- **Every OpenCode launch passes `--standalone`:** tasks, the manager, `run`, `api …` and `session delete`. `opencode run` never gets `--auto`.
- The minimum versions stay as they are: Claude Code `2.1.295` (`MIN_CLAUDE_VERSION`) and OpenCode `2.1.0` (`MIN_OPENCODE_VERSION`).
- **The output of `opencode api model.list` and `opencode api agent.list` can hold API keys** (a model's `settings`, an agent's `request.headers`). Mainframe never logs it, saves it or sends it to the renderer whole. From a model it keeps the id, name, status and price. From an agent it keeps the id and whether it is a primary agent.
- `settings.json` goes to version 2. Version 1 is read and turned into version 2, and a newer version is refused. `manager.json` and `todo.json` stay at version 1 and gain optional fields only. `state.json` doesn't change.
- Every task, manager and Todo IPC call names its project by its folder. The Settings calls are app-wide and name no project. Settings apply to every open project at once.
- The product names no project, path, branch, language or tool of the owner's. The prompts name the repo's instructions only through the adapter's words.
- No package version changes (parent `CLAUDE.md`).
- The long-sync line reads exactly `Still syncing (2 min). Large syncs can use a lot of tokens.` It shows at 120 000 ms, with **Stop** and **Keep going**. `SYNC_TIMEOUT_MS` stays at 5 minutes. A Claude Code sync keeps `--max-budget-usd 1`.
- The cog is a toothed cogwheel: the `<path>` and `<circle>` of `docs/superpowers/mockups/2026-11-12-agent-agnostic-settings-cog.html`, in the stroke style of the top row's other icons. Its tooltip is `Settings`.
- Commands: `npx vitest run <files>`, `npm test`, `npm run typecheck`, `npm run test:e2e` (it builds first). **Before any e2e run, ask the owner to quit their own Mainframe (Cmd+Q).** It once quit during a run.
- Frontend work invokes the `frontend-design:frontend-design` skill (global `CLAUDE.md`) and stays within the mockups and the tokens of `app.css`.
- Commit messages follow the repo's style (`feat: …`, `fix: …`, `test: …`, `refactor: …`) and carry no AI attribution. Run `git add` and `git commit` as separate commands.

## Review Focus

1. **Two projects open side by side when the default changes in Settings.** In each project the next new task takes the new default. Each manager switches only at its own next start, and each sync only at its own next run. (Task 5 test `two projects share one AgentsInUse`, Task 6 test `the manager switches agent only at its next start`.)
2. **The saved sync model has gone from OpenCode** (the user removed its provider). The next sync asks for a model again instead of failing with OpenCode's error. (Task 8 test `a saved model that is gone asks again`.)
3. **An agent is unticked while it has tasks.** Its cards stay, and they reopen while the program works. A new task on it is refused with a message that says why. (Task 5 test `an unticked agent's task still reopens; a new task on it is refused`.)
4. **Settings is opened with no project open, or while a terminal has the focus.** The dialog opens, and the key (Ctrl+, or ⌘,) never reaches the terminal. (Task 10 `windowKeys` tests, Task 12 e2e `with no project open the cog still opens Settings` and `Ctrl+, opens Settings over a focused terminal`.)
5. **OpenCode's lists hold API keys.** No part of `api model.list` or `api agent.list` beyond the kept fields reaches the renderer, a log or `settings.json`. (Task 6 and Task 8 tests assert that the secret string is absent, and the Task 12 e2e checks the page and `settings.json`.)

---

### Task 1: The agent adapter, as a move (tasks, finding, environment, prompt words)

**Files:**
- Create: `src/main/agents/agent.ts`, `src/main/agents/adapters.ts`, `src/main/agents/adapters.test.ts`
- Move (`git mv`): `src/main/tasks/launch.ts` → `src/main/agents/claude.ts`, `src/main/tasks/launch.test.ts` → `src/main/agents/claude.test.ts`, `src/main/tasks/opencode.ts` → `src/main/agents/opencode.ts`, `src/main/tasks/opencode.test.ts` → `src/main/agents/opencode.test.ts`
- Modify: `src/main/setup/programChecks.ts` (keep `runVersion`, `isAtLeast`, `checkGit`, and export `checkProgram`; move `parseClaudeVersion`, `claudePlaces`, `checkClaude`, `findClaude` into `claude.ts` and the OpenCode four into `opencode.ts`, with their tests), `src/main/pty/spawnEnv.ts`, `src/main/tasks/openingPrompt.ts`, `src/main/tasks/taskService.ts`, `src/main/index.ts`, `src/main/setup/setupFlow.ts`, `src/main/manager/managerService.ts`, `src/main/manager/resumableChat.ts` (import path only), `src/shared/types.ts`
- Test: the moved tests, plus `src/main/tasks/taskService.test.ts`, `src/main/manager/managerService.test.ts`, `src/main/manager/resumableChat.test.ts` and `src/main/setup/setupFlow.test.ts` (import paths only)

**Interfaces:**
- Produces, in `src/shared/types.ts`: `export const MIN_AGENT_VERSION: Record<AgentName, string> = { claude: MIN_CLAUDE_VERSION, opencode: MIN_OPENCODE_VERSION };`
- Produces, in `src/main/agents/agent.ts`:
  ```ts
  /** How a prompt names the repo's instructions: the first mention in full, later ones short. */
  export interface Instructions { first: string; again: string; requires: string; integrates: string }
  /** What a launch adds to the session host's own environment. */
  export interface LaunchArgs { argv: string[]; env?: Record<string, string> }
  export interface TaskStart { bin: string; nodeBin: string; taskDir: string; slug: string; name: string; sessionId: string; prompt: string; addDir?: string }
  export interface TaskReopen { bin: string; nodeBin: string; taskDir: string; slug: string; sessionId: string; branchExists: boolean; prompt?: string }
  export interface AgentAdapter {
    readonly name: AgentName;
    /** MAINFRAME_CLAUDE_BIN or MAINFRAME_OPENCODE_BIN. */
    readonly envVar: string;
    find(o: { fromEnv?: string; saved?: string[]; lookup: ExecutableLookup; run: VersionRunner }): Promise<ProgramCheck>;
    check(path: string, run: VersionRunner, files: ExecutableFiles): Promise<ProgramCheck>;
    /** Keys this agent sets in the shells it runs, which a session must not inherit. */
    readonly droppedEnv: readonly string[];
    readonly instructions: Instructions;
    /** The opening prompt's note on where the session runs. */
    worktreeNote(o: { branch: string; worktreePath: string; projectDir: string }): string;
    /** True: Mainframe adds the task's worktree and runs the agent in it. False: the agent's own flag makes it, from the project folder. */
    readonly makesWorktree: boolean;
    /** A new conversation id; Claude Code's comes from `uuid`, so tests can name it. */
    newSessionId(uuid: () => string): string;
    taskStart(o: TaskStart): LaunchArgs;
    taskReopen(o: TaskReopen): LaunchArgs;
    /** The conversation the agent last recorded in the task's folder (Claude Code's SessionStart hook); null when there is none, and always for OpenCode. */
    recordedSession(taskDir: string): string | null;
  }
  ```
- Produces, in `src/main/agents/adapters.ts`: `export const ADAPTERS: Record<AgentName, AgentAdapter> = { claude: claudeAgent, opencode: opencodeAgent };`
- `claude.ts` keeps its current exports (`startArgv`, `reopenArgv`, `managerArgv`, `hookSettings`, `writeHookSettings`, `readSessionStart`, `readRecordedStart`, `readRecordedSession`, `SESSION_START_FILE`, `isUuid`) and adds `claudeAgent`, `parseClaudeVersion`, `claudePlaces`, `checkClaude` and `findClaude`. Its `taskStart` and `taskReopen` write the hook settings into `taskDir` and return `startArgv` and `reopenArgv` with no `env`. Its `droppedEnv` is today's `CLAUDE*` keys from `spawnEnv.ts`.
- `opencode.ts` keeps its current exports and adds `opencodeAgent`, `parseOpencodeVersion`, `opencodePlaces` and `findOpencode`. Its `taskStart` and `taskReopen` return `opencodeStartArgv` and `opencodeReopenArgv` with `env: OPENCODE_ENV`. Its `droppedEnv` is `['OPENCODE_TERMINAL', 'OPENCODE_PTY_HANDOFF']`.
- `openingPrompt` keeps its signature. It takes the instructions and the worktree note from `ADAPTERS[t.agent]`, and the two `Instructions` constants move into the adapters.
- `TaskService` keeps its deps (`claudeBin` and `opencodeBin`, until Task 5) and keeps its two flows, now keyed on `adapter.makesWorktree` rather than on `agent === 'opencode'`. Each flow calls `adapter.taskStart`, `adapter.taskReopen` and `adapter.recordedSession`. Its `cwd` is the worktree when `makesWorktree` is true, and `projectDir` otherwise.
- `spawnEnv.ts` drops `Object.values(ADAPTERS).flatMap((a) => a.droppedEnv)` together with its own terminal keys.

- [ ] **Step 1: Write the failing tests** in `src/main/agents/adapters.test.ts`:

```ts
it('each adapter is filed under its own name', () => {
  for (const name of Object.keys(AGENT_NAMES) as AgentName[]) expect(ADAPTERS[name].name).toBe(name);
});
it('Claude Code makes its own worktree, and Mainframe makes OpenCode its worktree', () => {
  expect(ADAPTERS.claude.makesWorktree).toBe(false);
  expect(ADAPTERS.opencode.makesWorktree).toBe(true);
});
it("a Claude task's start is today's argv, with no env", () => {
  const o = { bin: 'claude', nodeBin: 'node', taskDir: dir, slug: 's', name: 'p-s', sessionId: UUID_1, prompt: 'P' };
  expect(ADAPTERS.claude.taskStart(o)).toEqual({
    argv: startArgv({ claudeBin: 'claude', slug: 's', name: 'p-s', claudeSessionId: UUID_1, settingsPath: join(dir, 'settings.json'), prompt: 'P' }),
  });
});
it("an OpenCode task's start carries the tabs-off env", () => {
  expect(ADAPTERS.opencode.taskStart({ ...o, bin: 'oc', sessionId: 'ses_' + 'a'.repeat(28) }).env).toEqual(OPENCODE_ENV);
});
it('a session drops every key an adapter names, and keeps the rest', () => {
  for (const key of Object.values(ADAPTERS).flatMap((a) => a.droppedEnv)) {
    const env = buildSpawnEnv({ [key]: '1', KEEP: '1' }, 'darwin');
    expect(env).not.toHaveProperty(key);
    expect(env.KEEP).toBe('1');
  }
});
```

- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run src/main/agents/adapters.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement the move and the interfaces above.** Fix the imports in every file listed. The moved tests change in their import paths only.

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main src/shared
git commit -m "refactor: one adapter per agent in src/main/agents holds how each is found, the env it sets, its prompt words and its task launches; a Claude task launches exactly as before"
```

---

### Task 2: The manager through the adapter

**Files:**
- Move (`git mv`): `src/main/manager/resumableChat.ts` → `src/main/agents/claudeChat.ts`, and its test likewise
- Modify: `src/main/agents/agent.ts`, `src/main/agents/claude.ts`, `src/main/agents/opencode.ts` (`managerChat` and `managerLaunch` stubs that throw `The manager does not run on OpenCode yet`; Task 6 replaces them), `src/main/manager/managerService.ts`, `src/main/manager/rolePrompt.ts`, `src/main/mcp/mcpServer.ts` (`mcpConfigJson` and `TOOL_TIMEOUT_MS` move to `claude.ts`), `src/main/index.ts`, `e2e/manager.e2e.ts` (imports only)
- Test: `src/main/manager/managerService.test.ts`, `src/main/agents/claude.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces, in `agent.ts`:
  ```ts
  /** What settings.json keeps of one agent (Task 4 saves it). */
  export interface AgentSetting { enabled?: boolean; bin?: string; managerAgent?: string; syncModel?: string }
  /** The agent a service runs now, where it is, and its settings. */
  export interface AgentInUse { adapter: AgentAdapter; bin: string; setting: AgentSetting }
  export interface ManagerLaunch {
    bin: string; nodeBin: string; env: Record<string, string>;
    /** The manager's folder in the data folder: the adapter writes what the launch reads there. */
    dir: string; projectDir: string; name: string;
    mcp: { url: string; token: string }; rolePrompt: string;
    chat: string; resume: boolean; prompt?: string; setting: AgentSetting;
  }
  // on AgentAdapter:
  /** The chat to carry on: Claude Code's from its SessionStart record, OpenCode's the id manager.json saved. Null starts a new one. */
  managerChat(dir: string, saved: string | undefined): string | null;
  managerLaunch(o: ManagerLaunch): Promise<LaunchArgs>;
  ```
- Claude's `managerLaunch` writes `settings.json` (hooks plus today's allow list) and `mcp.json` (mode `0o600`, made anew) into `dir`, exactly as `ManagerService.start` does today, and returns `managerArgv(...)`. Its `managerChat` is `readResumableSession(dir)`.
- `rolePrompt(i: Instructions): string`. It replaces `ROLE_PROMPT`. With `ADAPTERS.claude.instructions` its text is byte for byte today's `ROLE_PROMPT`: "following this repo's CLAUDE.md" becomes `following ${i.first}`.
- `ManagerServiceDeps` becomes `{ projectDir; dataDir; nodeBin: string; env: Record<string, string>; mcp: { url: string; token: string }; agent(): AgentInUse; onChange; newId?; warn? }`. `index.ts` passes `agent: () => ({ adapter: ADAPTERS.claude, bin: programs.claudeBin, setting: {} })` until Task 5.
- `ManagerService.start(): Promise<ManagerView>`. A second call while one is awaiting returns that call's promise. `index.ts` and `ipc.ts` await it or log its rejection.
- `manager.json` stays at version 1 and gains `agent?: AgentName` (the agent of the last session; absent means Claude Code) and `chats?: Partial<Record<AgentName, string>>`. A start:
  1. reads the record;
  2. sets `chat = adapter.managerChat(dir, record.chats?.[name])`;
  3. gives a carry-on prompt only when `chat !== null` and `(record.agent ?? 'claude') === name`;
  4. uses `chat ?? adapter.newSessionId(newId)` as the chat;
  5. saves `{ version: 1, midTurn: false, askAgain: <kept only for the same agent>, agent: name, chats: { ...record.chats, [name]: id } }` before it launches.
- `launchSpec(id)` returns `{ argv, cwd: projectDir, env }`, so the session host lays OpenCode's env over its own.

- [ ] **Step 1: Write the failing tests** in `managerService.test.ts`. First move the existing tests onto the new deps (`agent` returns the Claude adapter with bin `'claude'`; `mcp: { url, token }`; `mcp.json`'s expected content is `mcpConfigJson(url, token)`), then add:
  - **`a manager.json from before this branch resumes its Claude chat`**: write `{ version: 1, midTurn: true }` and a `session-start.json` with `source: 'resume'` for `UUID_1`. Expect `await start()` to give argv `managerArgv({ ..., claudeSessionId: UUID_1, resume: true, rolePrompt: rolePrompt(ADAPTERS.claude.instructions), prompt: 'Continue where you left off.' })`.
  - **`manager.json keeps the chat of the agent it ran`**: after a first start, the record has `agent: 'claude'` and `chats.claude` equal to the id in argv.
  - **`two starts at once launch one session`**: `Promise.all([start(), start()])` gives two views with the same `session.id`, and `onChange` was called once.
  - **`a carry-on prompt is the same agent's only`**: a record `{ version: 1, midTurn: true, agent: 'opencode' }` plus a recorded Claude chat gives a Claude resume with no prompt.
  - In `claude.test.ts`: **`rolePrompt with Claude's words is today's role prompt`**. Paste today's `ROLE_PROMPT` text into the test as the expected string.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/main/manager src/main/agents`. Expected: FAIL (new deps, `rolePrompt`, the new fields).

- [ ] **Step 3: Implement the interfaces above.** In `e2e/manager.e2e.ts`, replace `ROLE_PROMPT` with `rolePrompt(ADAPTERS.claude.instructions)`.

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main e2e/manager.e2e.ts
git commit -m "refactor: the manager launches through its agent's adapter and manager.json keeps the agent of each chat; a Claude manager launches and resumes exactly as before"
```

---

### Task 3: The Todo sync through the adapter

**Files:**
- Create: `src/main/agents/claudeSync.ts`, `src/main/agents/claudeSync.test.ts`
- Modify: `src/main/agents/agent.ts`, `src/main/agents/claude.ts`, `src/main/agents/opencode.ts` (a `sync` stub whose `prepare` throws `The sync does not run on OpenCode yet`; Task 7 replaces it), `src/main/todo/syncRun.ts`, `src/main/todo/syncRun.test.ts`, `src/main/todo/todoService.ts`, `src/main/todo/todoService.test.ts`, `src/main/todo/todoFile.ts`, `src/main/index.ts`
- Move from `syncRun.ts` to `claudeSync.ts`, with their tests: `syncArgv`, `syncSettings`, `escapeRegExp`, `readSyncAnswer`, `isMcpToolName`

**Interfaces:**
- Produces, in `agent.ts`:
  ```ts
  /** The words the sync prompts use for this agent. */
  export interface SyncWords {
    /** "Claude Code sessions" or "coding agent sessions". */ sessions: string;
    instructions: Instructions;
    /** How discover asks for tool names: "(mcp__…)" for Claude Code. */ toolNames: string;
    /** Added to discover's "none": where to set the tracker up; '' adds nothing. */ noConnector: string;
  }
  export interface SyncRunSpec { argv: string[]; cwd: string; env: Record<string, string> }
  export interface SyncAdapter {
    readonly words: SyncWords;
    /** Writes what the run reads into `dir` (the project's Todo folder) and returns the run. Throws when it can't. */
    prepare(o: { bin: string; nodeBin: string; dir: string; projectDir: string; env: Record<string, string>; step: SyncStep; tools: string[]; setting: AgentSetting }): SyncRunSpec;
    prompt(step: SyncStep): string;
    /** The run's answer from what it printed; throws an Error whose message is for the panel. */
    readAnswer(stdout: string, tools: string[]): SyncAnswer;
    isToolName(name: string): boolean;
    /** Tidies up after a run, from what it printed. Never throws. */
    afterRun(o: { bin: string; dir: string; env: Record<string, string>; stdout: string }): void;
  }
  // on AgentAdapter: readonly sync: SyncAdapter;
  ```
- Claude's `prepare` writes `sync-settings.json` and returns `{ argv: syncArgv(bin, settingsPath), cwd: projectDir, env }`. Its `readAnswer` is `readSyncAnswer`, its `isToolName` is `isMcpToolName`, and its `afterRun` does nothing.
- `syncRun.ts` keeps `SYNC_TIMEOUT_MS`, `SYNC_STOPPED` and `SyncStep`. It renames `runClaude` to `runSync`, and the message for a run that printed nothing names `basename(argv[0])` instead of `claude`. It turns `syncPrompt` into `syncPrompt(step: SyncStep, words: SyncWords): string`. With Claude's words the text is today's, byte for byte.
- `todo.json` `readTools` gains `agent?: AgentName`; absent means Claude Code. `TodoService.sync()` reads at the read step only when `(readTools.agent ?? 'claude') === agent().adapter.name`, and otherwise at discover. The cards, notes and `pickedList` stay. `confirmTools` saves the agent. The discover check uses `adapter.sync.isToolName`.
- `TodoServiceDeps` becomes `{ projectDir; dataDir; nodeBin: string; env; agent(): AgentInUse; startTask; onChange; run?: typeof runSync; newId?; now?; warn? }`.

- [ ] **Step 1: Write the failing tests**
  - `todoService.test.ts`: move the existing tests onto the new deps (a fake `agent()` returning the Claude adapter). The argv and settings each run gets must stay as they are. Then add:
    - **`confirmed tools saved without an agent are Claude Code's`**: write a version 1 `todo.json` with `readTools` and no `agent`. A sync runs the read step with those tools allowed.
    - **`a switch of agent syncs at discover again and keeps the cards and notes`**: a record whose `readTools.agent` is `'claude'`, with `agent()` returning `{ adapter: { ...ADAPTERS.claude, name: 'opencode' }, … }`. The run's prompt is the discover prompt, and `view().cards` and `view().notes` are unchanged.
    - **`confirming saves the agent with the tools`**: after `confirmTools()`, `todo.json` has `readTools.agent === 'claude'`.
  - `claudeSync.test.ts`: the moved `syncArgv`, `syncSettings`, `isMcpToolName` and `readSyncAnswer` tests, unchanged. `syncRun.test.ts` keeps the `syncPrompt` tests, which now pass `ADAPTERS.claude.sync.words` and expect the same strings, and the `runClaude` tests renamed to `runSync`.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/main/todo src/main/agents`. Expected: FAIL.

- [ ] **Step 3: Implement the interfaces above.** `index.ts` passes `agent: () => ({ adapter: ADAPTERS.claude, bin: programs.claudeBin, setting: {} })` until Task 5.

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main
git commit -m "refactor: the Todo sync runs, prompts and reads its answer through its agent's adapter, and todo.json saves the agent its tools were confirmed on; a Claude sync runs exactly as before"
```

---

### Task 4: settings.json version 2

**Files:**
- Create: `src/main/setup/agentChoice.ts`, `src/main/setup/agentChoice.test.ts`
- Modify: `src/main/setup/settings.ts`, `src/main/setup/settings.test.ts`, `src/main/setup/setupFlow.ts`, `src/main/setup/setupFlow.test.ts`, `src/shared/types.ts`, `e2e/setup.e2e.ts` (the saved shapes; this file runs in Task 12)

**Interfaces:**
- Consumes: `AgentSetting` (Task 2).
- Produces, in `src/shared/types.ts`: `export const AGENT_ORDER: readonly AgentName[] = ['claude', 'opencode'];`
- Produces, in `settings.ts` (`VERSION = 2`, checked with zod; unknown agent names fail the check):
  ```ts
  export interface AppSettings { agents?: Partial<Record<AgentName, AgentSetting>>; defaultAgent?: AgentName; welcomeSeen?: boolean }
  ```
  `readSettings` and `writeSettings` keep their signatures. Version 1 `{ claudeBin?, welcomeSeen? }` reads as `{ agents: { claude: { enabled: true, bin? } }, defaultAgent: 'claude', welcomeSeen? }`. The file is not rewritten until the next save.
- Produces, in `agentChoice.ts`:
  - `tickedAgents(settings: AppSettings, checks: Record<AgentName, ProgramCheck>): AgentName[]`: in `AGENT_ORDER`, the agents whose `enabled` is true, plus those with no saved `enabled` whose check is `found`. "No saved choice" means ticked once it works. This keeps an upgrader's OpenCode as it is today: shown whenever it is found.
  - `runDefault(settings, checks): { agent: AgentName; fellBack: boolean } | null`:
    - the saved `defaultAgent` (or else the first ticked agent) when it is ticked and found, with `fellBack: false`;
    - otherwise the first ticked agent that is found, with `fellBack: settings.defaultAgent !== undefined`;
    - `null` when no ticked agent is found.
- `SetupFlow` reads and saves Claude Code's path as `agents.claude.bin` in place of `claudeBin`. Nothing else in it changes yet.

- [ ] **Step 1: Write the failing tests**
  - `settings.test.ts`:
    - **`a version 1 file reads as version 2`**: `{ version: 1, claudeBin: '/x/claude', welcomeSeen: true }` reads as `{ agents: { claude: { enabled: true, bin: '/x/claude' } }, defaultAgent: 'claude', welcomeSeen: true }`.
    - **`a version 1 file without claudeBin`** (MAINFRAME_CLAUDE_BIN was set) reads as `{ agents: { claude: { enabled: true } }, defaultAgent: 'claude' }`.
    - **`version 2 round-trips`** with `agents: { claude: { enabled: false }, opencode: { enabled: true, bin: '/o', managerAgent: 'build', syncModel: 'p/m' } }, defaultAgent: 'opencode'`. The file on disk has `version: 2`.
    - **`a newer file is refused`**: version 3 throws today's message.
    - **`an unknown agent sets the file aside as missing`**: `agents: { gemini: {} }` or `defaultAgent: 'gemini'` warns and gives `{}`.
  - `agentChoice.test.ts`:
    - an agent with no saved choice is ticked only when found;
    - `enabled: false` is never ticked;
    - `enabled: true` is ticked even when broken;
    - a saved default that works wins (`fellBack: false`);
    - a saved default that is broken gives the other ticked, found agent (`fellBack: true`);
    - nothing ticked found gives `null`;
    - with no saved default, both found gives `{ agent: 'claude', fellBack: false }`.
  - `setupFlow.test.ts`: the existing expectations of `claudeBin` become `agents: { claude: { bin } }`.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/main/setup`. Expected: FAIL.

- [ ] **Step 3: Implement the interfaces above.** In `e2e/setup.e2e.ts`, change every `claudeBin: x` in `settings:` options and `savedSettings` expectations to `agents: { claude: { bin: x } }`.

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/setup src/shared e2e/setup.e2e.ts
git commit -m "feat: settings.json version 2 keeps each agent's tick, path and options and the default agent; a version 1 file reads as Claude Code ticked and the default, with its path kept"
```

---

### Task 5: Setup and start with any one agent (main and the setup screen)

**Files:**
- Create: `src/main/setup/agentsInUse.ts`, `src/main/setup/agentsInUse.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/agents/agent.ts`, `src/main/agents/claude.ts`, `src/main/agents/claude.test.ts`, `src/main/agents/opencode.ts`, `src/main/agents/claudeSync.ts`, `src/main/manager/managerService.ts`, `src/main/todo/todoService.ts`, `src/main/setup/setupFlow.ts`, `src/main/setup/setupFlow.test.ts`, `src/main/index.ts`, `src/main/tasks/taskService.ts`, `src/main/tasks/taskService.test.ts`, `src/renderer/src/setup/setupCopy.ts`, `src/renderer/src/setup/setupCopy.test.ts`, `src/renderer/src/setup/setupStore.ts`, `src/renderer/src/setup/SetupScreen.tsx`, `src/renderer/src/app.css`, `e2e/setup.e2e.ts` (runs in Task 12)

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces, in `src/shared/types.ts` (`claude` and `claudeFromEnv` leave `SetupView`, and `askProject` becomes `ask`):
  ```ts
  export interface AgentChoice { ticked: AgentName[]; defaultAgent: AgentName }
  export interface SetupView {
    intro: 'welcome' | 'moved';
    git: ProgramCheck;
    agents: Record<AgentName, { check: ProgramCheck; fromEnv: boolean }>;
    lookedAgain: boolean;
    /** Everything needed is found at a first start: the agents step and the project question, starting from this choice. */
    ask: AgentChoice | null;
  }
  ```
- IPC: `setupFindAgent(name: AgentName)` (channel `setup:find-agent`) replaces `setupFindClaude`. `setupChooseProject(choice: AgentChoice)` carries the choice. Main passes on only names in `AGENT_ORDER`. `startTask` passes on its `agent` only when it is in `AGENT_ORDER`, and otherwise leaves it out, so the task gets the default.
- `findOpencode` takes `saved` as `findClaude` does.
- `nodeBin` becomes `string | null` in `TaskStart`, `TaskReopen`, `ManagerLaunch`, the sync's `prepare`, and the deps of the three services. Today's Node.js message moves to `claude.ts` as `NODE_NEEDED`. Claude Code's adapter throws it when `nodeBin` is null, and OpenCode's ignores `nodeBin`.
- `SetupDeps`:
  - `envBins: Partial<Record<AgentName, string>>`;
  - `pickAgent(name): Promise<string | undefined>` (the dialog is titled `Find ${AGENT_NAMES[name]}`);
  - `start(found: { settings: AppSettings; checks: Record<AgentName, ProgramCheck> }, projectDirs: string[]): Promise<void>`;
  - the rest as today.
- `SetupFlow` rules:
  - It checks git and each agent (`ADAPTERS[name].find` with its env var's path, the path it found last time, and the saved `bin`).
  - It is ready when git is found and `runDefault` is not null.
  - At a first start that is ready, `ask` is `{ ticked: <the found agents>, defaultAgent: runDefault.agent }`.
  - `chooseProject(choice)` refuses a choice that ticks none, ticks an agent that isn't found, or picks a default it doesn't tick, with `Error('That choice of agents can't be used')`. It saves `welcomeSeen: true`, `defaultAgent`, and `enabled` for each found agent (an agent that wasn't found keeps no `enabled`), plus each found agent's `bin` unless its env var names it.
- Produces, in `agentsInUse.ts`:
  ```ts
  export class AgentsInUse {
    constructor(deps: { dataDir: string; settings: AppSettings; checks: Record<AgentName, ProgramCheck>; envBins: Partial<Record<AgentName, string>> });
    /** The default this run uses: `runDefault`'s agent. */
    defaultAgent(): AgentName;
    /** The saved default didn't work at start, so another ticked agent stands in. */
    fellBack(): boolean;
    /** Ticked and found, in AGENT_ORDER. */
    ticked(): AgentName[];
    /** The path of a found agent, ticked or not; null when it isn't found. */
    bin(name: AgentName): string | null;
    /** The default agent with its adapter, path and setting. */
    inUse(): AgentInUse;
  }
  ```
- `TaskServiceDeps`: `claudeBin` and `opencodeBin` give way to `agents: Pick<AgentsInUse, 'bin' | 'defaultAgent' | 'ticked'>`, and `nodeBin` becomes `string | null`.
  - `start(req)` without `agent` runs on `agents.defaultAgent()`. That covers the tasks the manager starts and those started from a Todo card.
  - A start on an agent that isn't found throws `${AGENT_NAMES[agent]} ${MIN_AGENT_VERSION[agent]} or later is not installed`. Update the one existing test that expects `OpenCode 2.1 or later is not installed`.
  - A start on an agent that is found but not ticked throws `${AGENT_NAMES[agent]} is turned off in Settings`.
  - A reopen needs only `bin(agent)`.
- `index.ts`:
  - `findPrograms()` returns `{ env; nodeBin: string | null }` and no longer throws.
  - `start(config, programs, agents: AgentsInUse, dirs, win)` throws `NODE_NEEDED` when `agents.ticked().includes('claude')` and `nodeBin === null`.
  - The manager and the sync get `agent: () => agents.inUse()`.
  - `envBins` is `{ claude: config.claudeBin, opencode: config.opencodeBin }`.
  - The `agentChecks` promise now answers from `agents` (OpenCode's check) until Task 11 removes it.
- **The setup screen** (invoke `frontend-design:frontend-design`, and follow the first-start mockup):
  - `setupCopy.ts`:
    - `intro` says `coding agent sessions` in place of `Claude Code sessions`.
    - `checkLine(name: 'git' | AgentName, check, quiet: boolean)`. While another agent works, a failing agent's line is quiet: `not found`, `v1.18.35, too old` or `doesn't run`, with no `✗`, at `data-state` as today and with a dim tone.
    - `explanations` gives an agents block only when no agent works. Its first line is `I need a coding agent to run your tasks, Claude Code or OpenCode, and I couldn't use either.`, followed by each agent's reason (today's Claude lines, and their OpenCode twins: `I looked on your PATH and in ~/.opencode/bin, and OpenCode wasn't in either.`, `%USERPROFILE%\.opencode\bin` on Windows; too old: `This OpenCode is v${v}, and I need v${MIN_OPENCODE_VERSION} or newer. Run opencode upgrade in a terminal, then I'll look again.`; MAINFRAME_OPENCODE_BIN: as Claude's). Its buttons are `find-claude, install-claude, find-opencode, install-opencode, look-again`, with an agent's `find-` left out while its env var names it.
    - `agentStep(view, choice)` gives one row per agent: `{ name, works, ticked, version?, buttons }`. A row that doesn't work has `buttons: ['install-<name>', 'find-<name>']` (no `find-` under its env var) and can't be ticked. It also gives `showDefault: choice.ticked.length > 1` and the hint line:
      - two ticked: `You can still pick the other one for a single task in the New task box. All of this can be changed in Settings later.`
      - one ticked: `${AGENT_NAMES[x]} runs everything: the manager, the Todo sync and your tasks. Settings can change this later.`
    - The project question keeps today's copy.
  - `SetupButton` gains `find-opencode` and `install-opencode`. `install-opencode` opens `https://opencode.ai/`.
  - The screen shows a check line per agent (`setup-claude`, `setup-opencode`). While `ask` is set it shows `Which agents should I use?` with tick boxes (`setup-tick-<name>`, disabled when the agent doesn't work), then, while two are ticked, `Which one runs the manager, the Todo sync and new tasks?` with a two-way choice (`setup-default-<name>`), then the hint, then the project question.
  - `setupStore` keeps the choice and sends it with `chooseProject`. Unticking the default moves the default to the other ticked agent. The last tick can't be cleared.

- [ ] **Step 1: Write the failing tests**
  - `setupFlow.test.ts`:
    - **`an OpenCode-only first start asks with OpenCode ticked and the default`**: Claude Code's check is `missing` and `view().ask` is `{ ticked: ['opencode'], defaultAgent: 'opencode' }`.
    - **`with both found both start ticked, and Claude Code is the default`**.
    - **`with no agent working the screen shows and nothing starts`**: `ask` is null and `start` was not called.
    - **`choosing a project saves the choice`**: with both found and choice `{ ticked: ['opencode'], defaultAgent: 'opencode' }`, the saved settings are `{ welcomeSeen: true, defaultAgent: 'opencode', agents: { claude: { enabled: false, bin: C }, opencode: { enabled: true, bin: O } } }`.
    - **`a choice that can't be used is refused`**: one with no tick, one that ticks a missing agent, and one whose default is unticked.
    - **`an upgrade starts at once`**: a version 1 settings file plus `projects.json`. `start` gets the checks, and `tickedAgents` of what it got is `['claude', 'opencode']` when both are found.
    - **`a later start with no ticked agent working shows Something moved`**.
    - **`MAINFRAME_OPENCODE_BIN is the only opencode looked at, and its path is not saved`**.
  - `claude.test.ts`, **`Claude Code needs Node`**: `taskStart`, `managerLaunch` and `sync.prepare` with `nodeBin: null` throw `NODE_NEEDED`.
  - `agentsInUse.test.ts`: `defaultAgent` and `fellBack` follow `runDefault`; `ticked()` leaves out an agent that isn't found; `bin()` is the found path, and null otherwise.
  - `taskService.test.ts` (with a mutable fake `agents`):
    - **`a start without an agent runs on the default agent`**: with the default `'opencode'`, the launch is OpenCode's.
    - **`two projects share one AgentsInUse`**: two services, one fake. Change its default, and both services' next starts take it.
    - **`an unticked agent's task still reopens; a new task on it is refused`**: OpenCode is found but not in `ticked()`. Reopening an existing OpenCode task launches it, and `start({ agent: 'opencode' })` rejects with `OpenCode is turned off in Settings`.
    - **`a start on an agent that isn't installed says so`**: `OpenCode 2.1.0 or later is not installed`.
  - `setupCopy.test.ts`:
    - the welcome contains `coding agent sessions` and not `Claude Code`;
    - `checkLine('claude', { state: 'missing' }, true)` is `not found`, and with `false` it is `not found  ✗`;
    - with no agent working, `explanations` has one agents block with the five buttons in the order above;
    - the agent step gives the two hint lines above, `showDefault` true only with two ticked, and the buttons above on a row that doesn't work.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/main/setup src/main/tasks src/renderer/src/setup`. Expected: FAIL.

- [ ] **Step 3: Implement the interfaces, the screen and the wiring above.** Then update `e2e/setup.e2e.ts`:
  - The first-start saves gain `enabled: true` and `defaultAgent: 'claude'` for Claude Code.
  - The "claude missing" test is now the no-agent-works case: it also expects `setup-install-opencode` to be visible.
  - The `MAINFRAME_CLAUDE_BIN` save is `{ welcomeSeen: true, defaultAgent: 'claude', agents: { claude: { enabled: true } } }`.

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src e2e/setup.e2e.ts
git commit -m "feat: Mainframe starts with any one working agent: the first start asks which agents to use and which one is the default, an agent that is missing is no error while another works, Node is needed only with Claude Code, and new tasks, the manager's and the Todo cards' run on the default"
```

---

### Task 6: The manager on OpenCode

**Files:**
- Modify: `src/main/agents/opencode.ts`, `src/main/agents/opencode.test.ts`, `src/main/agents/agent.ts` (only if outcome B below), `src/main/manager/managerService.test.ts`

**Interfaces:**
- Consumes: Task 2's `ManagerLaunch`, `rolePrompt`, `AgentSetting`.
- Produces, in `opencode.ts`:
  - `runOpencode(argv: string[], o: { cwd: string; env: Record<string, string> }): Promise<string>`. It runs the program with no shell (`execFile`, `windowsHide`, a 60 s timeout) and resolves with stdout. It rejects with `Error(<the last line of stderr, or "opencode exited with code N">)`. It never logs stdout.
  - `opencodeAgents(o: { bin: string; cwd: string; env: Record<string, string>; run?: typeof runOpencode }): Promise<{ id: string; primary: boolean }[]>`.
    - It runs `[bin, '--standalone', 'api', 'agent.list']` in `cwd`, with `PWD = cwd`, and reads the body's `data` array.
    - It keeps `id`, and `primary = mode !== 'subagent' && !hidden`, in OpenCode's order, which puts its default first (`<oc>/packages/core/src/agent.ts`, `list`). Use `api agent.list`, not `debug agents`, which sorts by id and loses the default.
    - A failure rejects with `OpenCode could not list its agents: ${message}`.
  - `managerConfig(o: { url: string; token: string; rolesFile: string; agentId: string; setDefault: boolean }): string` is the JSON text of:
    ```ts
    const RULES = [
      { action: 'mainframe_list_sessions', resource: '*', effect: 'allow' },
      { action: 'mainframe_sync_todo', resource: '*', effect: 'allow' },
      { action: 'mainframe_start_task', resource: '*', effect: 'ask' },
    ];
    ({
      mcp: { servers: { mainframe: { type: 'remote', url, headers: { Authorization: `Bearer ${token}` }, oauth: false } } },
      permissions: RULES,
      agents: { [agentId]: { permissions: RULES } },
      instructions: [rolesFile],
      ...(setDefault && { default_agent: agentId }),
    })
    ```
  - `opencodeAgent.managerChat(dir, saved)` is `saved ?? null`.
  - `opencodeAgent.managerLaunch(o)`:
    1. writes `rolePrompt(OPENCODE_INSTRUCTIONS)` to `<dir>/role-prompt.md`;
    2. takes `agentId = o.setting.managerAgent ?? (await opencodeAgents({ bin, cwd: projectDir, env })).find((a) => a.primary)!.id`;
    3. returns `{ argv: [bin, '--standalone', '-s', chat, ...(prompt ? ['--prompt', prompt] : [])], env: { ...OPENCODE_ENV, OPENCODE_CONFIG_CONTENT: managerConfig({ ..., setDefault: o.setting.managerAgent !== undefined }) } }`.

    A failed lookup fails the start, and the manager column shows its Restart with the message.
  - Its `newSessionId` is `newOpencodeSessionId`. With `-s`, no SessionStart hook and no `readResumableSession` are involved.

- [ ] **Step 1: Find out whether OpenCode's config can choose the TUI's starting agent.**
  - Read `default_agent` in `<oc>/packages/schema/src/config.ts`.
  - See how `<oc>/packages/core/src/config/plugin/agent.ts` applies it (`editor.default(...)`, and `Config.latest`, so the last document, `OPENCODE_CONFIG_CONTENT`, wins).
  - Check where the TUI picks the agent for a new session started with `-s` (`<oc>/packages/tui/src` and `<oc>/packages/cli/src/commands/handlers/default.ts`).

  The planner's look: the key exists in 2.2.7, and `agent.list` puts the configured default first. Write the outcome into the commit message. **Either way, OpenCode's default model is the user's own: the config sets no `model`.**
  - **Outcome A (expected): the TUI starts on `default_agent`.**
    - `AgentSetting.managerAgent` stays.
    - The config sets `default_agent` only when the setting names an agent.
    - The rules go under `setting.managerAgent`, or under the first agent `agent.list` gives.
    - Settings shows the "Manager's agent" row (Task 10).
  - **Outcome B: no key, or the TUI ignores it.**
    - Remove `managerAgent` from `AgentSetting` and from Task 4's schema and tests.
    - `managerConfig` loses `setDefault`.
    - The rules go under the first agent `agent.list` gives.
    - Task 10 shows no "Manager's agent" row.
    - The user switches agents inside the terminal (the owner said that is fine).

- [ ] **Step 2: Write the failing tests**
  - `opencode.test.ts`:
    - **`managerConfig is Mainframe's server, its rules in both places, and the role prompt's file`**: an exact `toEqual` on `JSON.parse(...)` for `setDefault: false`. With `true` (outcome A only), `default_agent` is the agent's id.
    - **`opencodeAgents keeps only ids, default first, and no secrets`**: a fixture body `{ location: {...}, data: [{ id: 'build', mode: 'primary', hidden: false, request: { headers: { Authorization: 'Bearer SECRET-1' } } }, { id: 'plan', mode: 'all', hidden: false }, { id: 'general', mode: 'subagent', hidden: false }, { id: 'title', mode: 'primary', hidden: true }] }` gives `[{ id: 'build', primary: true }, { id: 'plan', primary: true }, { id: 'general', primary: false }, { id: 'title', primary: false }]`, and `JSON.stringify(result)` doesn't contain `SECRET-1`. The run is called with `['oc', '--standalone', 'api', 'agent.list']`, and its env has `PWD` equal to `cwd`.
    - **`the manager's launch on OpenCode`**: a new chat gives argv `['oc', '--standalone', '-s', 'ses_…']`; a carry-on ends `'--prompt', 'Continue where you left off.'`; the env has `OPENCODE_ENV`'s key and `OPENCODE_CONFIG_CONTENT`; `role-prompt.md` holds text containing `AGENTS.md` and not `this repo's CLAUDE.md`; the rules sit under `build` when no agent is named, and under the named one otherwise.
  - `managerService.test.ts` (a fake `agent()` you can switch, with OpenCode's adapter given a fake `run`):
    - **`the manager on OpenCode keeps its chat in manager.json and carries it on`**: the first start gives `-s <id>` and `chats.opencode === id`. After an exit mid-turn, the next start gives the same id plus `'--prompt', 'Continue where you left off.'`.
    - **`the manager switches agent only at its next start, and switching back carries on the old chat`**: a Claude start, then a switch while it runs (`launchSpec` is unchanged), then the exit, then an OpenCode start (a new `ses_` id), then the exit, then a Claude start, which resumes the recorded Claude chat.

- [ ] **Step 3: Run them and see them fail.** Run `npx vitest run src/main/agents/opencode.test.ts src/main/manager`. Expected: FAIL.

- [ ] **Step 4: Implement the interfaces above**, following the outcome of Step 1.

- [ ] **Step 5: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 6: Commit** (with outcome A or B in the message)

```bash
git add src/main
git commit -m "feat: the manager runs on OpenCode when it is the default agent, with Mainframe's server, its allow rules and an ask rule for start_task under the agent it runs, and its role prompt as a file; its chat is kept per agent in manager.json (OpenCode's default_agent: <outcome>)"
```

---

### Task 7: The Todo sync on OpenCode

**Files:**
- Create: `src/main/agents/opencodeSync.ts`, `src/main/agents/opencodeSync.test.ts`
- Modify: `src/main/agents/opencode.ts`, `src/main/todo/todoService.ts`, `src/main/todo/todoService.test.ts`

**Interfaces:**
- Consumes: Task 3's `SyncAdapter`, `SYNC_ANSWER` and `SYNC_ANSWER_JSON`, `runOpencode` (Task 6).
- Produces, in `opencodeSync.ts`:
  - `type Rule = { action: string; resource: '*'; effect: 'allow' | 'deny' | 'ask' }`
  - `syncRules(step: SyncStep, tools: string[]): Rule[]`:
    - discover: `[ask '*', deny 'execute', deny 'shell', deny 'write', deny 'edit', deny 'subagent', deny 'webfetch', deny 'opencode_*']`;
    - read: `[deny '*', ...tools.map(allow)]`.
  - `syncConfig(step, tools, instructionsFile: string | null): string` is the JSON text of `{ permissions: rules, agents: { 'mainframe-sync': { mode: 'primary', steps: 12, permissions: rules }, title: { disabled: true } }, ...(instructionsFile && { instructions: [instructionsFile] }) }`.
  - `instructionsFileOf(projectDir: string): string | null` is `<projectDir>/AGENTS.md` when it exists, else `<projectDir>/CLAUDE.md` when it exists, else null.
  - `readOpencodeAnswer(stdout: string, tools: string[]): SyncAnswer`. It reads one JSON event per line and skips lines that aren't JSON, in this order:
    1. an `error` event throws `The sync run failed: ${error.message ?? error.name ?? 'unknown error'}`;
    2. a `tool_use` event whose tool isn't in `tools` and whose status is `completed` throws `The sync used a tool that wasn't allowed: ${tool}`;
    3. the answer is the `text` events of the message whose `step_finish` is the last one with `reason: 'stop'`, joined. With none, it throws `The sync run ended without an answer`;
    4. a code fence around the whole answer is stripped;
    5. text that isn't JSON throws `The sync run's answer wasn't JSON`;
    6. `SYNC_ANSWER.safeParse` must succeed (unknown keys are dropped), or it throws today's `The sync run's answer didn't have the shape Mainframe asked for`.

    There is no retry (spec §12, the builder's call).
  - `isOpencodeToolName(name)`: `/^(?!opencode_)[A-Za-z0-9-]+_[A-Za-z0-9_-]+$/`.
  - `opencodeAgent.sync`:
    - `words`: `sessions: 'coding agent sessions'`, `instructions`: OpenCode's, `toolNames: '(as your tool list names them, such as tracker_get_card)'`, `noConnector: "Mainframe looked in OpenCode's connectors: set your tracker up there, as an MCP server in OpenCode's config, then sync again."`.
    - `prompt(step)`: `syncPrompt(step, words)`, a blank line, then `Answer with one JSON object and nothing else, with no code fence. It must match this JSON Schema: ${SYNC_ANSWER_JSON}`.
    - `prepare(o)`:
      - `runDir = join(o.dir, 'opencode-run')`, made empty if missing;
      - `argv = [bin, 'run', '--standalone', '--format', 'json', '--agent', 'mainframe-sync', '--title', 'sync', '--archived', '-m', setting.syncModel]`. A missing `syncModel` throws `Pick a model for the sync first`; Task 8 asks for one before any run;
      - `cwd: runDir`;
      - `env: { ...o.env, PWD: runDir, OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_CONFIG_CONTENT: syncConfig(step, tools, instructionsFileOf(projectDir)) }`.
    - `afterRun(o)` takes the `sessionID` of the first event that has one and calls `runOpencode([bin, '--standalone', 'session', 'delete', id], { cwd: <runDir>, env })`, ignoring a failure. `--archived` already keeps the session out of the user's lists.
- `TodoService`:
  - It calls `adapter.sync.afterRun` once a run's stdout is in, whatever the answer.
  - It adds `words.noConnector` to discover's `none` message when it isn't `''`.
  - Stop and the time limit still send SIGTERM through `runSync`.

- [ ] **Step 1: Confirm the event shapes** in `<oc>/packages/cli/src/run/noninteractive.ts` (the `emit` calls at about lines 355–470). Check:
  - every event's `sessionID`;
  - `text`: `part.text` and `part.messageID`;
  - `step_finish`: `part.reason` and `part.messageID`;
  - `tool_use`: `part.tool` and `part.state.status`;
  - `error`: `error`.

  Build the test fixtures from what you find. Where a field path differs from the list above, use OpenCode's and say so in the commit.

- [ ] **Step 2: Write the failing tests** in `opencodeSync.test.ts`, with fixtures built as NDJSON strings:
  - **`a good answer split over two text events`** is parsed;
  - **`a fenced answer`** (` ```json … ``` `) is parsed;
  - **`only the message that stopped counts`**: an earlier message whose `step_finish` reason is `tool-calls`, with text, is left out;
  - **`an answer without kind`** throws the shape message;
  - **`an error event`** throws `The sync run failed: Invalid API key`;
  - **`a completed tool outside the confirmed ones fails the sync`**; the same tool with status `error` does not;
  - **`no stop message`** throws `The sync run ended without an answer`;
  - **`syncConfig`**: an exact `toEqual` for discover and read, with the rules in both places, `title.disabled` and `steps: 12`;
  - **`prepare`**: the exact argv with `-m p/m`; `cwd` and `env.PWD` both `<dir>/opencode-run`, which exists and is empty; `OPENCODE_DISABLE_PROJECT_CONFIG: '1'`; `instructions` is `[<projectDir>/AGENTS.md]` when both files exist, `[<projectDir>/CLAUDE.md]` with only that one, and absent with neither; no `--auto` anywhere;
  - **`prepare without a model`** throws `Pick a model for the sync first`;
  - **`isOpencodeToolName`**: `trello_trelloReadCard` true; `read` and `opencode_shell` false.
  - `todoService.test.ts`:
    - **`afterRun gets what each run printed`**;
    - **`a discover that finds no connector says where to set it up`**: with OpenCode's words, the error ends with `noConnector`. With Claude's words it is exactly today's message.

- [ ] **Step 3: Run them and see them fail.** Run `npx vitest run src/main/agents/opencodeSync.test.ts src/main/todo`. Expected: FAIL.

- [ ] **Step 4: Implement the interfaces above.**

- [ ] **Step 5: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main
git commit -m "feat: the Todo sync runs on OpenCode when it is the default agent: an opencode run in an empty folder with the project's config off and its instructions file handed by path, rules that let discover see but not call any tool and let read use only the confirmed ones, an answer read from its events and checked against the tools it used, and its session deleted after"
```

---

### Task 8: The sync model picker

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/agents/agent.ts`, `src/main/agents/opencodeSync.ts`, `src/main/agents/opencodeSync.test.ts`, `src/main/todo/todoService.ts`, `src/main/todo/todoService.test.ts`, `src/main/setup/agentsInUse.ts`, `src/main/setup/agentsInUse.test.ts`, `src/main/mcp/managerTools.ts`, `src/main/index.ts`, `src/renderer/src/todo/TodoPanel.tsx`, `src/renderer/src/todo/todoStore.ts`, `src/renderer/src/app.css`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  ```ts
  /** A model the OpenCode sync can run on; `price` is USD per million tokens, null when OpenCode doesn't know it. */
  export interface SyncModel { id: string; name: string; status: string; price: { input: number; output: number } | null }
  // TodoAsk gains: | { kind: 'model'; models: SyncModel[]; suggested: string | null }
  ```
- On `SyncAdapter`: `models?(o: { bin: string; dir: string; env: Record<string, string> }): Promise<SyncModel[]>`. Only OpenCode has it.
  - It runs `[bin, '--standalone', 'api', 'model.list']` in `<dir>/opencode-run`, with `PWD` set to that folder and `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
  - It reads `data`, keeps the models whose `enabled` isn't false, and takes the price from the `cost` entry without a `tier` (else the first entry). An empty `cost` gives null.
  - It sorts by input price, then output price, with null last, and never logs stdout.
  - A failure rejects with `OpenCode could not list its models: ${message}`.
- `cheapestKnown(models: SyncModel[]): string | null`: the first with a price.
- `TodoServiceDeps` gains `saveAgentSetting(name: AgentName, patch: Partial<AgentSetting>): void`. `AgentsInUse.saveAgentSetting` writes it to `settings.json` at once and updates what `inUse()` returns.
- `TodoService`:
  - Before any run on an adapter that has `models`, `sync()` lists them. When `setting.syncModel` isn't among their ids, it sets the ask `{ kind: 'model', models, suggested: cheapestKnown(models) }`, returns `{ ask: 'model' }`, and runs nothing. A listing that fails refuses with its message.
  - `pickModel(id: string): Promise<SyncOutcome>` needs a model ask that holds `id`; otherwise it throws `No such model; sync again`. It then calls `saveAgentSetting(adapter.name, { syncModel: id })` and syncs.
- IPC: `pickTodoModel(dir: string, id: string)` on channel `todo:pick-model`.
- `managerTools`: `NEEDS_OWNER.model = 'Pick the model the sync runs on, in the Todo panel'` and `ASKS_ABOUT.model = 'the model'`.
- **Panel** (invoke `frontend-design:frontend-design`, matching `.todo-ask`):
  - `Pick the model the sync runs on. Cheapest first, with the price per million tokens in and out.`
  - One row per model (`data-testid="todo-model"`), showing its name and `$0.11 / $0.55`, or `price unknown`. The suggested one starts picked.
  - `Use this and sync` (`todo-pick-model`).

- [ ] **Step 1: Confirm the body of `api model.list`** (`<oc>/packages/server/src/handlers/model.ts`, `response()` in `<oc>/packages/server/src/location.ts`, `ModelInfo` in `<oc>/packages/client/src/promise/generated/types.ts`) and **which string `run -m` takes** (`<oc>/packages/cli/src/run`). `SyncModel.id` is that string: `id`, or `${providerID}/${modelID}`. Say which in the commit.

- [ ] **Step 2: Write the failing tests**
  - `opencodeSync.test.ts`, **`models keep only id, name, status and price, cheapest first, and no secrets`**:
    - a fixture of three models: `dear` (2.4 / 12), `cheap` (0.11 / 0.55, with `settings: { apiKey: 'sk-SECRET-2' }` and a `headers` entry), and `unknown` (`cost: []`);
    - plus one with `enabled: false`;
    - the result is `[cheap, dear, unknown]`, each with exactly the keys `id, name, status, price`;
    - `JSON.stringify(result)` doesn't contain `sk-SECRET-2`;
    - `cheapestKnown` is cheap's id.
  - `todoService.test.ts`:
    - **`a first OpenCode sync asks for a model and runs nothing`**: the view's ask is `{ kind: 'model', suggested: <cheap's id> }`, and `run` was not called;
    - **`a saved model that is gone asks again`**;
    - **`picking a model saves it and syncs with it`**: `saveAgentSetting` is called with `('opencode', { syncModel: id })`, and the run's argv ends `'-m', id`;
    - **`a model list that fails says why`**: the view's error is `OpenCode could not list its models: …`;
    - **`a Claude sync asks for no model`**: unchanged.
  - `agentsInUse.test.ts`, **`saveAgentSetting writes settings.json and inUse() sees it`**.

- [ ] **Step 3: Run them and see them fail.** Run `npx vitest run src/main/agents src/main/todo src/main/setup`. Expected: FAIL.

- [ ] **Step 4: Implement the interfaces and the panel above.**

- [ ] **Step 5: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: the first OpenCode sync asks which model to run on, cheapest first with prices and the cheapest known one picked, keeps only each model's id, name, status and price, and asks again when the saved model has gone"
```

---

### Task 9: The long-sync line, on both agents

**Files:**
- Modify: `src/shared/types.ts` (`TodoView.longSync`), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/todo/syncRun.ts`, `src/main/todo/todoService.ts`, `src/main/todo/todoService.test.ts`, `src/renderer/src/todo/TodoPanel.tsx`, `src/renderer/src/todo/todoStore.ts`, `src/renderer/src/app.css`

**Interfaces:**
- Produces:
  - `export const LONG_SYNC_MS = 2 * 60_000;` in `syncRun.ts`;
  - `TodoView.longSync: boolean`;
  - `TodoServiceDeps.setTimer?: (fn: () => void, ms: number) => () => void` (default: `setTimeout`, cancelled with `clearTimeout`);
  - `TodoService.keepSyncing(): void`;
  - IPC `keepTodoSync(dir: string)` on channel `todo:keep-sync`.
- A run sets a timer at launch. When it fires, while that run is still the running one, `longSync` turns true and the view is sent. `keepSyncing` sets it false for the rest of that run. The run's end, a cancel or a close clears the timer and sets it false.
- **Panel** (invoke `frontend-design:frontend-design`): while `longSync` is true, under the synced line, `Still syncing (2 min). Large syncs can use a lot of tokens.` (`todo-long-sync`), with **Stop** (`todo-long-stop`, as the panel's Stop) and **Keep going** (`todo-keep-going`).

- [ ] **Step 1: Write the failing tests** in `todoService.test.ts`, with a fake `setTimer` that the test fires by hand:
  - **`after 2 minutes the view says the sync is still running`**: the fake was set with `120_000`, and firing it makes `view().longSync` true. Run it for both a Claude and an OpenCode fake agent;
  - **`Keep going hides it for the rest of that run`**;
  - **`a run that ends first never shows it, and clears its timer`**;
  - **`Stop clears it`**: `cancel()` sets it false;
  - **`the next run starts without it`**.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/main/todo/todoService.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the interfaces and the panel above.**

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass. The Claude sync argv test still has `--max-budget-usd 1`.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: a Todo sync still running after 2 minutes says it may use a lot of tokens and offers Stop and Keep going, on both agents"
```

---

### Task 10: The Settings dialog, the cog, ⌘, and Ctrl+,

**Files:**
- Create: `src/renderer/src/settings/SettingsDialog.tsx`, `src/renderer/src/settings/SettingsButton.tsx`, `src/renderer/src/settings/settingsStore.ts`
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` (`registerSettingsIpc`), `src/main/setup/agentsInUse.ts`, `src/main/setup/agentsInUse.test.ts`, `src/main/menu.ts`, `src/main/windowKeys.ts`, `src/main/windowKeys.test.ts`, `src/main/index.ts`, `src/renderer/src/projects/ProjectPane.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/app.css`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  ```ts
  export interface AgentView { check: ProgramCheck; fromEnv: boolean; ticked: boolean; managerAgent?: string; syncModel?: string }
  export interface SettingsView {
    agents: Record<AgentName, AgentView>;
    /** The saved default, which the choice shows. */ defaultAgent: AgentName;
    /** The default this run uses: another ticked agent when the saved one didn't work at start. */ runDefault: AgentName;
  }
  ```
- IPC (app-wide; none names a project):
  - `getSettings(): Promise<SettingsView>` (`settings:get`);
  - `onSettings(cb)` (`settings:changed`);
  - `setAgentTicked(name, ticked)` (`settings:set-ticked`);
  - `setDefaultAgent(name)` (`settings:set-default`);
  - `settingsFindAgent(name)` (`settings:find-agent`);
  - `setAgentOptions(name, patch: { managerAgent?: string | null; syncModel?: string })` (`settings:set-options`), where null clears `managerAgent`;
  - `opencodeChoices(): Promise<{ agents: { id: string; isDefault: boolean }[]; models: SyncModel[] }>` (`settings:opencode-choices`);
  - `onShowSettings(cb)` (`settings:show`, main to page).
- `AgentsInUse` gains:
  - `view(): SettingsView`;
  - `setTicked(name, ticked)`. It throws `${AGENT_NAMES[name]} doesn't work, so it can't be ticked` for an agent that isn't found, `Make another agent the default first` for the saved default, `At least one agent must stay ticked` for the last one, and today's Node.js message for Claude Code without Node;
  - `setDefault(name)`, which throws for an agent that isn't ticked and found;
  - `find(name, path)`, which checks the file with `adapter.check`, then saves `bin` and the new check when it is found;
  - `saveAgentSetting(name, patch)` (Task 8), extended so null deletes a key;
  - `opencodeChoices()`, which runs `opencodeAgents` and `sync.models` in `<dataDir>/opencode-lists` (made empty), with `OPENCODE_DISABLE_PROJECT_CONFIG=1`.

  Each change saves `settings.json`, then sends `settings:changed`. The deps gain `run`, `lookup`, `nodeBin`, `env` and `onChange(view)`.
- `menu.ts`: `buildMenu(o: { openProject?: () => void; openSettings?: () => void } = {})`.
  - The app menu is spelled out in place of `role: 'appMenu'`: `about`, separator, `{ id: 'settings', label: 'Settings…', accelerator: 'Cmd+,', enabled: openSettings !== undefined, click: openSettings }`, separator, `services`, separator, `hide`, `hideOthers`, `unhide`, separator, `quit`.
  - `start` sets it with both.
- `windowKeys.ts`: `isSettingsKey(input)` is `keyDown`, `control`, not `shift`, `alt` or `meta`, and `key === ','`. In `createWindow`'s handler for systems other than the Mac, that key calls `event.preventDefault()` and sends `settings:show`.
- **Renderer** (invoke `frontend-design:frontend-design`, following the Settings mockup and the `.nt-dialog` box and backdrop):
  - `settingsStore`: `settingsView()`, `loadSettings()`, `openSettings()`.
    - `settings:show` opens the dialog unless the setup screen shows, or another modal dialog is open (`document.querySelector('dialog:modal')`).
  - `SettingsDialog`: `<dialog class="settings-dialog" data-testid="settings-dialog">`, mounted once in `App`, titled `Settings`, with a close button (`settings-close`) and Esc. Its sections are a list, each with a small upper-case title.
    - **Agents**:
      - a row per agent: a tick box (`settings-tick-<name>`), the version, the path and `Find…` (`settings-find-<name>`, left out under its env var). A row that doesn't work says why, in `checkLine`'s quiet words;
      - the saved default's tick box is disabled, with the title `Make another agent the default first`;
      - while two are ticked, `Default agent` with a two-way choice (`settings-default-<name>`), and under it exactly `Runs the manager, the Todo sync and new tasks. Tasks that are already running keep their own agent.`;
      - an error from main shows in the section (`settings-error`).
    - **OpenCode**, while OpenCode is ticked. On open it calls `opencodeChoices()` and shows a quiet `Looking…` meanwhile.
      - `Manager's agent` (`settings-manager-agent`, outcome A only): `Your default (<id of isDefault>)`, then each primary agent.
      - `Todo sync model` (`settings-sync-model`): each model with its prices, or `price unknown`; no choice until one is saved.
      - Under them: `Cheapest first, with the price per million tokens in and out. Asked the first time a sync runs.`
  - `SettingsButton`: `<button class="tb-icon" data-testid="settings-open" title="Settings" aria-label="Settings">` with the mockup's cog SVG. It doesn't take the focus on a click (`keepFocus`).
    - It is rendered in `ProjectPane`'s bar right after `jump-next`, inside `place.last`.
    - `App` renders it at the window's top-right corner only while no pane is in the top row (`projectsStore.layout.shown.length === 0`).
  - A notice (`default-fallback`) shows while `runDefault !== defaultAgent`, at the window's bottom right, with a ✕: `${AGENT_NAMES[defaultAgent]} didn't work at start, so ${AGENT_NAMES[runDefault]} runs the manager, the Todo sync and new tasks for now. Settings shows why.`

- [ ] **Step 1: Write the failing tests**
  - `agentsInUse.test.ts`:
    - **`setTicked refuses an agent that doesn't work, the saved default and the last tick, and Claude Code without Node`**: each with its message, and nothing is saved;
    - **`unticking a ticked agent that isn't the default saves enabled false; ticking it back saves true`**;
    - **`setDefault saves the default and runDefault follows`**;
    - **`find saves the path of a file that works and its new check, and leaves a bad file unsaved`**;
    - **`view lists both agents with their checks, ticks and options`**;
    - **`opencodeChoices keeps no secrets`**: the fixtures of Tasks 6 and 8, through a fake run, and the result's JSON has neither secret.
  - `windowKeys.test.ts`, **`isSettingsKey`**: Ctrl+, true; Ctrl+Shift+, false; Ctrl+Alt+, false; Meta+, false; keyUp false; Ctrl+. false.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/main/setup/agentsInUse.test.ts src/main/windowKeys.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement main's side, then the renderer's.**

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: a Settings dialog behind a cog at the far right of the top row, Settings… with Cmd+, on the Mac and Ctrl+, elsewhere, where the agents are ticked, found and given a default, and OpenCode's manager's agent and sync model are picked; a notice says when another agent stands in for a default that didn't work"
```

---

### Task 11: The New task box starts on the default agent; the UI text and the README

**Files:**
- Create: `src/renderer/src/board/newTaskAgents.ts`, `src/renderer/src/board/newTaskAgents.test.ts`
- Delete: `src/renderer/src/board/agentPrefs.ts`, `src/renderer/src/board/agentPrefs.test.ts` (its `localStorage` key goes with them)
- Modify: `src/renderer/src/board/NewTaskDialog.tsx`, `src/renderer/src/projects/ProjectPane.tsx` (the panel's empty text), `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` (the `agentChecks` IPC and its promise go: dead now that the dialog reads Settings), `README.md`

**Interfaces:**
- Consumes: `SettingsView` and `settingsView()` (Task 10), `MIN_AGENT_VERSION` (Task 1).
- Produces `newTaskAgents(view: SettingsView): { options: AgentName[]; start: AgentName; hints: string[] }`:
  - `options` are the ticked agents whose check is `found`, in `AGENT_ORDER`;
  - `start` is `view.runDefault`;
  - `hints` cover each agent that is ticked but not found:
    - too old: `${AGENT_NAMES[n]} ${version} is installed. Mainframe needs ${MIN_AGENT_VERSION[n]} or later.`;
    - broken: `The ${n} at ${path} didn't say its version, so Mainframe can't use it.` (an `AgentName` is its program's name)

  OpenCode's two sentences are today's, word for word.
- `NewTaskDialog`:
  - It reads `settingsView()` (loaded if missing) instead of `agentChecks`.
  - It shows the agent choice only with two or more `options`, and starts on `start`.
  - It saves nothing.
  - Its sub line names the agent picked, as today.
- The board's empty session panel reads `New task starts ${AGENT_NAMES[runDefault]} in a worktree of its own.`
- `README.md`:
  - The requirements table: Claude Code **or** OpenCode 2.1 or later; at least one is needed.
  - The first start asks which agents to use and which one is the default.
  - Settings opens from the cog at the top right, ⌘, on the Mac, or Ctrl+, on Windows and Linux.
  - The manager, the Todo sync and new tasks run on the default agent.
  - An OpenCode sync asks for a model first, reads the tracker through a connector set up in OpenCode's own config, and is never given a shell or edits.
  - A sync that runs over 2 minutes asks whether to go on.
  - Node is needed for Claude Code's hooks.
  - Drop "The manager, the Todo sync and tasks started from cards still use Claude Code."
  - Name Claude Code only where a step is Claude Code's.

- [ ] **Step 1: Write the failing tests** in `newTaskAgents.test.ts`:
  - with both ticked and found, `options` is both and `start` is `runDefault`;
  - with OpenCode unticked, `options` is `['claude']` and `hints` is empty;
  - with OpenCode ticked and too old (1.18.35), `hints` is `['OpenCode 1.18.35 is installed. Mainframe needs 2.1.0 or later.']`;
  - an OpenCode-only view gives `options: ['opencode']` and `start: 'opencode'`.

- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run src/renderer/src/board/newTaskAgents.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement it, the dialog, the empty text, the removals and the README** (invoke `frontend-design:frontend-design` for the dialog). Then grep `src/renderer` for `Claude Code` and change every one that is about the user's own sessions in general. The suggestion ring and TaskCard's `aria-description` are Claude Code's own and stay.

- [ ] **Step 4: Run `npm test`, then `npm run typecheck`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src README.md
git rm src/renderer/src/board/agentPrefs.ts src/renderer/src/board/agentPrefs.test.ts
git commit -m "feat: the New task box starts on the default agent and offers the other ticked ones, the board names the default agent, and the README says Claude Code or OpenCode; the per-project agent memory and the agentChecks call are gone"
```

---

### Task 12: E2E with the fake opencode playing the manager and run

**Files:**
- Create: `e2e/agents.e2e.ts`
- Modify: `e2e/fake-claude.cjs`, `e2e/tasks.ts`, `e2e/opencode.e2e.ts`, plus `e2e/setup.e2e.ts` and `e2e/manager.e2e.ts` where their earlier updates need fixing

**Interfaces:**
- Consumes: the test ids of Tasks 5, 8, 9 and 10, and `launchApp`, `fakeOpencode`, `answerDialogs`, `projectPane`, `mcpCall` and `computer()` (copy `setup.e2e.ts`'s helper, or move it into `e2e/tasks.ts` and import it in both).
- `fake-claude.cjs`, as OpenCode:
  - **A launch records `<pid>.env`:** every `OPENCODE_*` key and `PWD`, as JSON.
  - **`run`** is a sync: `sync()` as today, reading `sync-reply.json`, which holds NDJSON for OpenCode.
  - **`api <op>`** prints `opencode-<op>.json` from the log folder when the test wrote one. Otherwise it prints a default:
    - `agent.list`: `build` (primary, with `request.headers.Authorization: 'Bearer fake-agent-secret'`), `plan` (primary) and `general` (subagent);
    - `model.list`: `prov/cheap` (0.11 / 0.55, with `settings.apiKey: 'sk-fake-secret'`), `prov/dear` (2.4 / 12) and `prov/unknown` (`cost: []`), in OpenCode's shape as Task 8 Step 1 found it.
  - **`session …`** prints nothing and exits 0.
  - Every call records its argv as today.
- `e2e/tasks.ts`:
  - `isSync` also takes `args[0] === 'run'`.
  - A new `isHelper` takes `args[0] === 'api' || args[0] === 'session'`, and `sessionLaunches` leaves helpers out.
  - `isManager` is also true for a launch whose `<pid>.env` has an `OPENCODE_CONFIG_CONTENT` that contains `"mcp"`.
  - New: `envOf(launch)`, `helperCalls(dataDir)`, and `opencodeSyncReply(dataDir, answer)`, which writes the events of Task 7's fixtures for one stop message carrying `JSON.stringify(answer)`, with `sessionID: 'ses_fake'`.
- `e2e/opencode.e2e.ts`: the exact env check becomes `expect(envOf(first).OPENCODE_CLI_CONFIG_CONTENT).toBe('{"tabs":{"mode":"off"}}')` and `expect(envOf(first).OPENCODE_CONFIG_CONTENT).toBeUndefined()`.

- [ ] **Step 1: Write `e2e/agents.e2e.ts`** with these tests:
  - **`a first start with only OpenCode chooses it and opens a project`**:
    - `computer()` with `MAINFRAME_OPENCODE_BIN: fakeOpencode`;
    - `setup-claude` has `data-state="missing"` and no `✗`, and `setup-install-claude` shows on its row;
    - `setup-tick-opencode` is checked, `setup-tick-claude` is disabled, and there is no `setup-default-opencode`;
    - the hint reads `OpenCode runs everything: the manager, the Todo sync and your tasks. Settings can change this later.`;
    - after `setup-choose-project`, the board shows, and `savedSettings` is `{ welcomeSeen: true, defaultAgent: 'opencode', agents: { opencode: { enabled: true } } }`;
    - the manager's launch args start `['--standalone', '-s']`.
  - **`the manager starts on OpenCode with Mainframe's server, its rules and its role prompt`**:
    - settings `{ welcomeSeen: true, defaultAgent: 'opencode' }`, with the fake as `opencode`;
    - the manager's args are `['--standalone', '-s', <SESSION_ID>]` and its cwd is the main checkout;
    - the parsed `OPENCODE_CONFIG_CONTENT` has `mcp.servers.mainframe` `{ type: 'remote', url: /^http:\/\/127\.0\.0\.1:\d+\/mcp$/, headers: { Authorization: /^Bearer [0-9a-f]{64}$/ }, oauth: false }`, the ask rule for `mainframe_start_task` at the top level and under `agents.build`, and `instructions[0]` a file whose text is `rolePrompt(ADAPTERS.opencode.instructions)`;
    - a `tools/call` of `list_sessions` with that URL and token answers 200;
    - a quit and a new launch on the same data folder give the same `-s` id.
  - **`a sync on OpenCode asks for a model, finds the connector, and reads the list with only the confirmed tools`**:
    - the default is `opencode`. Open Todo and press Sync;
    - the `todo-model` rows read cheap, dear, then `price unknown`, with cheap picked;
    - after `todo-pick-model`, the run's args are `['run', '--standalone', '--format', 'json', '--agent', 'mainframe-sync', '--title', 'sync', '--archived', '-m', 'prov/cheap']`, its cwd is `env.PWD`, and `OPENCODE_DISABLE_PROJECT_CONFIG` is `'1'`;
    - the discover config's first rule is `{ action: '*', resource: '*', effect: 'ask' }`;
    - the reply is TOOLS with `readTools: ['tracker_get_list']`. After `todo-confirm-tools`, the read run's rules are `[deny '*', allow 'tracker_get_list']` and the cards show;
    - `helperCalls` include `['--standalone', 'session', 'delete', 'ses_fake']`;
    - `settings.json` has `agents.opencode.syncModel: 'prov/cheap'`, and neither `settings.json` nor `page.content()` contains `sk-fake-secret` or `fake-agent-secret`.
  - **`Settings switches the default agent from the cog, and the New task box follows`**:
    - both agents and two projects side by side;
    - `page.getByTestId('settings-open')` has count 1 and sits inside the last pane's bar;
    - click it, pick `settings-default-opencode`, then close;
    - `settings.json` has `defaultAgent: 'opencode'`;
    - New task opens with `new-task-agent-opencode` checked.
  - **`with no project open the cog still opens Settings`**: close the only project, and `settings-open` still opens `settings-dialog`.
  - **`Ctrl+, opens Settings over a focused terminal`**:
    - on Windows and Linux: focus a task's terminal and press `Control+,`. The dialog opens and the task's screen has no `,` added;
    - on the Mac: click the menu item through `app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('settings')!.click())`, and the dialog opens.

- [ ] **Step 2: Ask the owner to quit their Mainframe (Cmd+Q), then run `npm run test:e2e -- e2e/agents.e2e.ts`.** Expected: FAIL until the fake and the helpers have changed.

- [ ] **Step 3: Implement the fake and the helper changes above.**

- [ ] **Step 4: Run the whole suite: `npm run test:e2e`.** Expected: all pass, including `setup`, `opencode`, `manager` and `todo`. Fix any of Tasks 2 to 11's e2e updates that fail.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test: e2e for Mainframe without Claude Code: an OpenCode-only first start, the manager and the Todo sync on OpenCode with a fake opencode that plays run and api, and Settings from the cog, the menu and Ctrl+,"
```

---

### Task 13: /simplify on the whole branch

- [ ] **Step 1: Run `/simplify`:** the Skill tool, skill `simplify`, args `main...HEAD`.
- [ ] **Step 2: Check each edit.** Undo any edit that changes behaviour or reaches outside the lines the branch changed. Dead code elsewhere is pointed out in the report, not removed.
- [ ] **Step 3: Run `npm test` and `npm run typecheck`, then ask the owner to quit their Mainframe (Cmd+Q) and run `npm run test:e2e`.** Expected: all pass.
- [ ] **Step 4: Commit** what it changed: `git add <its files>`, then, as its own command, `git commit -m "refactor: <what /simplify changed>"`.
- [ ] **Step 5: Record the tip** in the git common folder (in a worktree `.git` is a file):

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/agent-agnostic rev-parse HEAD >> /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified
```

---

### Task 14: The final whole-branch review

- [ ] **Step 1: Dispatch the review.** The branch is large and risky, so the owner's table gives `fable` at `high`. Split it by area: `src/main/agents` with `manager` and `todo`; `setup` and Settings in main and the renderer; the New task box and `e2e`. Give each reviewer the spec, this plan and its part of `git diff main...HEAD`, and ask:
  - whether the code is the simplest that meets the requirement (proportion);
  - "would this work unchanged for a friend whose project is in another language, has a `master` branch, and has none of these plugins installed?";
  - "would this still work with two projects open side by side?";
  - whether a Claude Code launch is byte for byte today's, and whether anything outside `src/main/agents/` names a flag, a config key or a file layout.
- [ ] **Step 2: Fix the findings.** Run `npm test` and `npm run typecheck`, then, after the owner has quit Mainframe, `npm run test:e2e`. Commit each fix as `fix: …`.

---

### Task 15: /code-review high, then the owner's checks

- [ ] **Step 1: Run `/code-review`:** the Skill tool, skill `code-review`, args `high main...HEAD`.
- [ ] **Step 2: Fix what it finds.** Run the three suites (ask for Cmd+Q before the e2e), then commit.
- [ ] **Step 3: Record the tip in both files:**

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/agent-agnostic rev-parse HEAD | tee -a /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified >> /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-reviewed
```

- [ ] **Step 4: The owner checks by hand** (spec §11):
  - a first start with OpenCode only (`MAINFRAME_CLAUDE_BIN` pointing nowhere);
  - the manager on OpenCode listing the tasks and asking before it starts one;
  - a real Todo sync through a connector set up in OpenCode;
  - switching the default back and forth in Settings.

  Fixes from these checks are new work: run `/simplify`, then `/code-review high`, again before the merge menu of `superpowers:finishing-a-development-branch`.
