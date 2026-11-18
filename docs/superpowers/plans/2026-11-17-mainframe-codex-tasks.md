# Codex Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex CLI becomes a third agent for tasks: found at setup, picked in New task, run in a Mainframe-made worktree, reopened with `codex resume --last`.

**Architecture:** A new adapter `src/main/agents/codex.ts` behind the existing `AgentAdapter` interface, registered under the new `AgentName` `'codex'`. Task code that names `'opencode'` today is made to ask the adapter instead. A small offline check (`codex debug prompt-input`) tells the New task box when to show the "add this line to your Codex config" note.

**Tech Stack:** Electron 44, TypeScript 5.9, SolidJS 1.9, node-pty, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-mainframe-codex-tasks-design.md` (approved 2026-11-17). Evidence for every Codex fact: `docs/superpowers/findings/2026-11-17-codex-checks.md`.

## Global Constraints

- `AgentName` gains `'codex'`; `AGENT_NAMES.codex = 'Codex'`; `AGENT_ORDER = ['claude', 'opencode', 'codex']`.
- `MIN_CODEX_VERSION = '0.169.0'`; the version comes only from a stdout line that is exactly `codex-cli X.Y.Z`.
- Env var `MAINFRAME_CODEX_BIN`; an empty value throws `MAINFRAME_CODEX_BIN must name the codex binary, got an empty value`.
- Codex's worktrees: `.mainframe/worktrees/<slug>`, branch `worktree-<slug>` (`mainframeAddsWorktree: true`, `worktreesDir: '.mainframe/worktrees'`).
- Mainframe passes **no** `-c` or other Codex setting on a task's launch. Start: `[bin, prompt]`. Reopen: `[bin, 'resume', '--last', ...(prompt ? [prompt] : [])]`. Both run with `cwd` = the task's worktree.
- Never read `$CODEX_HOME/sessions` or Codex's SQLite files; never pass `--dangerously-bypass-hook-trust`; never set `projects.*.trust_level`.
- Claude Code's and OpenCode's behaviour must not change: every existing test stays green unchanged, apart from tests whose `openingPrompt` call shape Task 2 changes.
- Project-agnostic: no code, copy or default names a project, path, branch or the owner's tools. Multi-project: everything takes its project folder as a parameter.
- UI changes go through the `frontend-design:frontend-design` skill, following the screens' existing styles.
- Before any e2e run: check that the owner's Mainframe isn't running (`pgrep -fl "Simmesolo/Mainframe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"`), on its own, and read the result first. If it is running, ask the owner.
- Commits: no AI attribution of any kind.

## Review Focus

1. **A Codex task reopened before it began** (Codex quit at its trust question or sign-in screen, so no in-turn report came): it must start again with the opening prompt, not `resume --last`. Pinned in Task 2.
2. **A Codex task reopened with no carry-on prompt** (plain Reopen from its card): argv must be exactly `codex resume --last`, with no empty-string argument. Pinned in Task 1.
3. **A `codex --version` that prints anything else** (`codex-cli 0.169.0-alpha.1`, a colour code, a second line, `codex 0.169.0`): it is not taken as a version, so the check says broken rather than crashing or mis-ranking. Pinned in Task 1.
4. **The CLAUDE.md check when `codex debug prompt-input` misbehaves** (exits non-zero, prints non-JSON or an object instead of an array, hangs): no note, no error in the box. Pinned in Task 3.
5. **A project with both `AGENTS.md` and `CLAUDE.md`, or neither:** no note and no Codex run at all. Pinned in Task 3.

---

## File Structure

- Create `src/main/agents/codex.ts`: the adapter (finding, version, argv, dropped keys, the refusing manager and sync).
- Create `src/main/agents/codex.test.ts`.
- Create `src/main/agents/codexInstructions.ts`: `codexMissesClaudeMd`, the offline CLAUDE.md check.
- Create `src/main/agents/codexInstructions.test.ts`.
- Modify `src/shared/types.ts`, `src/main/agents/adapters.ts`, `src/main/config.ts`, `src/main/index.ts`, `src/main/setup/agentChoice.ts`, `src/main/setup/agentsInUse.ts`, `src/main/setup/setupFlow.ts`: register the agent (the typecheck lists every `Record<AgentName, …>` literal).
- Modify `src/renderer/src/setup/setupCopy.ts`, `src/renderer/src/setup/SetupScreen.tsx`: Codex's setup copy and buttons.
- Modify `src/main/tasks/taskService.ts`, `src/main/tasks/openingPrompt.ts`: "began" and the worktree note by adapter, not by `'opencode'`.
- Modify `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`: the `codexClaudeMdNote` call.
- Modify `src/renderer/src/board/NewTaskDialog.tsx`, `TaskCard.tsx`, `src/renderer/src/panel/SessionPanel.tsx`, and their CSS in `src/renderer/src/app.css`.
- Create `e2e/fake-codex.cjs`, `e2e/codex.e2e.ts`; modify `e2e/fake-claude.cjs`, `e2e/launch.ts`, `e2e/globalSetup.ts`.
- Create `scripts/fake-codex-model.mjs`: the hand check's fake model. Not shipped, not imported by `src/`.

---

### Task 1: The Codex adapter, registered as a third agent

**Files:**
- Create: `src/main/agents/codex.ts`, `src/main/agents/codex.test.ts`
- Modify: `src/shared/types.ts:56-72`, `src/main/agents/adapters.ts`, `src/main/config.ts`, `src/main/config.test.ts`, `src/main/index.ts:447`, `src/main/setup/agentChoice.ts:24,31`, `src/main/setup/agentsInUse.ts:92`, `src/main/setup/setupFlow.ts:43,145-147`, `src/renderer/src/setup/setupCopy.ts` (`AGENT_COPY`, `buttonLabel`, `NO_AGENT`), `src/renderer/src/setup/SetupScreen.tsx:20-30`, and any other `Record<AgentName, …>` the typecheck names
- Test: `src/main/agents/codex.test.ts`, `src/main/config.test.ts`, the existing `adapters.test.ts` and setup tests

**Interfaces:**
- Produces: `codexAgent: AgentAdapter`; `parseCodexVersion(stdout: string): string | null`; `codexPlaces(lookup: ExecutableLookup): string[]`; `findCodex(o: FindOptions): Promise<ProgramCheck>`; `codexStartArgv(o: { codexBin: string; prompt: string }): string[]`; `codexReopenArgv(o: { codexBin: string; prompt?: string }): string[]`; `CODEX_DROPPED_ENV: readonly string[]`; `MIN_CODEX_VERSION` and `AgentName` `'codex'` in `shared/types.ts`; `AppConfig.codexBin?: string`.

- [ ] **Step 1: Write the failing tests** in `src/main/agents/codex.test.ts`, following `opencode.test.ts`'s style:

```ts
test('the version is read only from a line that is exactly codex-cli X.Y.Z', () => {
  expect(parseCodexVersion('codex-cli 0.169.0\n')).toBe('0.169.0');
  expect(parseCodexVersion('codex-cli 0.169.0-alpha.1')).toBeNull();
  expect(parseCodexVersion('codex 0.169.0')).toBeNull();
  expect(parseCodexVersion('\x1b[1mcodex-cli 0.169.0\x1b[0m')).toBe('0.169.0'); // colour stripped, as OpenCode's parser does
  expect(parseCodexVersion('warning: something\ncodex-cli 0.169.0')).toBeNull();
});

test('codex is looked for on PATH, then in its installer folder', () => {
  // posix: HOME=/home/u, nothing on PATH -> ['/home/u/.local/bin/codex']
  // win32: LOCALAPPDATA=C:\\Users\\u\\AppData\\Local -> ['C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe']
  // a PATH hit comes first, and duplicates collapse
});

test('a task starts as `codex <prompt>` and reopens as `codex resume --last [prompt]`', () => {
  expect(codexStartArgv({ codexBin: '/b/codex', prompt: 'Do it' })).toEqual(['/b/codex', 'Do it']);
  expect(codexReopenArgv({ codexBin: '/b/codex' })).toEqual(['/b/codex', 'resume', '--last']);
  expect(codexReopenArgv({ codexBin: '/b/codex', prompt: 'Carry on' })).toEqual(['/b/codex', 'resume', '--last', 'Carry on']);
});

test('the adapter: Mainframe adds the worktree, records no session, needs no node', () => {
  expect(codexAgent).toMatchObject({ name: 'codex', envVar: 'MAINFRAME_CODEX_BIN', mainframeAddsWorktree: true, worktreesDir: '.mainframe/worktrees', needsNode: false });
  expect(codexAgent.recordedSession('/any')).toBeNull();
  expect(codexAgent.chatKept('/any')).toBe(true);
  expect(codexAgent.began('/any', { began: true })).toBe(true);
  expect(codexAgent.began('/any', {})).toBe(false);
  expect(codexAgent.taskStart({ bin: '/b/codex', nodeBin: null, taskDir: '/t', slug: 's', name: 'n', sessionId: 'x', prompt: 'P' })).toEqual({ argv: ['/b/codex', 'P'] });
  expect(codexAgent.newSessionId(() => 'u-1')).toBe('u-1');
});

test("Codex's shell variables are dropped, the user's CODEX_HOME is not", () => {
  expect(codexAgent.droppedEnv).toEqual(expect.arrayContaining(['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_CI', 'CODEX_PERMISSION_PROFILE', 'CODEX_VERSION', 'CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS', 'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_PACKAGE_ROOT']));
  expect(codexAgent.droppedEnv).not.toContain('CODEX_HOME');
});

test('the manager and the Todo sync refuse until they run on Codex', async () => {
  await expect(codexAgent.managerLaunch(/* any ManagerLaunch */)).rejects.toThrow("The manager doesn't run on Codex yet.");
  expect(() => codexAgent.sync.prepare(/* any */)).toThrow("The Todo sync doesn't run on Codex yet.");
});
```

In `config.test.ts`: `MAINFRAME_CODEX_BIN=/x/codex` gives `codexBin: '/x/codex'`; `''` throws the message in Global Constraints.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/agents/codex.test.ts src/main/config.test.ts`
Expected: FAIL, `codex.ts` not found and `codexBin` undefined.

- [ ] **Step 3: Implement `src/main/agents/codex.ts`** after `opencode.ts`:
  - `parseCodexVersion`: strip `\x1b[…m`, then `/^codex-cli (\d+\.\d+\.\d+)$/` on the trimmed whole output.
  - `codexPlaces`: `findExecutable('codex', lookup)`, then on win32 `win32.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')` when `LOCALAPPDATA` is set, else `posix.join(env.HOME, '.local', 'bin', 'codex')`; nulls dropped, deduplicated.
  - `checkCodex` / `findCodex` through `checkProgram` / `findProgram` with `MIN_CODEX_VERSION`.
  - `instructions`: the same object as OpenCode's (`first: "this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)"` …). Share it: move OpenCode's `instructions` constant to an export both adapters import, rather than copying it.
  - `worktreeNote`: OpenCode's sentence. Share it the same way.
  - `newSessionId: (uuid) => uuid()`: Mainframe's own key, never sent to Codex.
  - `taskStart` / `taskReopen`: `{ argv }` only, no `env`.
  - `recordedSession: () => null`, `chatKept: () => true`, `began: (_d, t) => t.began === true`, `forgetChat: () => {}`.
  - `managerChat: () => null`; `managerLaunch: () => Promise.reject(new Error("The manager doesn't run on Codex yet."))`.
  - `sync`: `words` copied from OpenCode's sync words where they're agent-neutral; `prepare` throws `new Error("The Todo sync doesn't run on Codex yet.")`; `prompt` returns `''`; `readAnswer` throws the same error; `isToolName: () => false`; `afterRun: () => {}`; no `models`.

  Register it: `'codex'` in `AgentName`, `AGENT_NAMES`, `AGENT_ORDER` (last), `MIN_AGENT_VERSION`; `ADAPTERS.codex = codexAgent`; `readCodexBin` in `config.ts` beside `readOpencodeBin`; `envBins.codex = config.codexBin` in `index.ts`; then every `Record<AgentName, …>` literal the typecheck names (`agentChoice.ts`, `agentsInUse.ts`, `setupFlow.ts`'s `{ claude, opencode }` and its `Promise.all`, and any other).

  Renderer records, with this exact copy:
  - `AGENT_COPY.codex`: `envVar: 'MAINFRAME_CODEX_BIN'`, `min: MIN_CODEX_VERSION`, `nowhere`: win32 `"I looked on your PATH and in %LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin, and Codex wasn't in either."`, else `"I looked on your PATH and in ~/.local/bin, and Codex wasn't in either."`, `update: 'Run codex update in a terminal'`.
  - `buttonLabel`: `'find-codex'` → `'Find codex.exe…'` / `'Find codex…'`; `'install-codex'` → `'How to install Codex ↗'`; `'use-codex'` → `'Use Codex'`.
  - `NO_AGENT`: `"I need a coding agent to run your tasks, Claude Code, OpenCode or Codex, and I couldn't use any of them."`
  - `SetupScreen` `press`: `'find-codex'` → `findAgent('codex')`, `'install-codex'` → `openLinkLogged('https://developers.openai.com/codex/cli', 'setup')`, `'use-codex'` → `useAgent('codex')`. Before committing, open that URL with WebFetch: if it doesn't describe installing the Codex CLI, use the install section of `https://github.com/openai/codex` instead.
  - On win32 the `broken` reason for Codex adds `"If Codex came from npm, its launcher can't run on its own; Codex's own installer gives me a codex.exe I can use."`, as Claude Code's does.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/agents src/main/config.test.ts src/main/setup src/renderer && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: PASS; setup and settings tests that list agents may need `codex` added to their expected records. Change only expectations that list the agents, nothing else.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/agents src/main/config.ts src/main/config.test.ts src/main/index.ts src/main/setup src/renderer/src/setup
git commit -m "feat: Codex as a third agent: found, checked and ticked at setup and in Settings"
```

---

### Task 2: Codex tasks start, began and reopen like OpenCode's

**Files:**
- Modify: `src/main/tasks/taskService.ts:540` (began), `:826-836` (the `openingPrompt` call), `src/main/tasks/openingPrompt.ts:31-47`
- Test: `src/main/tasks/taskService.test.ts`, `src/main/tasks/openingPrompt.test.ts`

**Interfaces:**
- Consumes: `codexAgent` from Task 1 through `ADAPTERS`.
- Produces: `openingPrompt(t)` now takes `agent: AgentName; projectDir: string; worktreePath: string` for every agent (the `{ agent: 'claude' } | { agent: 'opencode'; … }` union goes). Claude Code's `worktreeNote` ignores the two fields, so its prompt is unchanged.

- [ ] **Step 1: Write the failing tests** in `taskService.test.ts`, beside the OpenCode task tests (near line 1228), with the same fakes:

```ts
test('a Codex task starts `codex <opening prompt>` in its own worktree under .mainframe/worktrees', async () => {
  // start({ title: 'Fix login', agent: 'codex' }) with codex found at '/bin/codex'
  // the launch: argv ['/bin/codex', openingPrompt({ agent: 'codex', projectDir, worktreePath, ... })], cwd = <projectDir>/.mainframe/worktrees/fix-login
  // git.addWorktree was asked for that folder on branch worktree-fix-login
});

test('a Codex task that never reported a turn starts again with its opening prompt on reopen', async () => {
  // start, end the session with no status, reopen -> argv ['/bin/codex', <opening prompt>]
});

test('a Codex task that reported working reopens with `codex resume --last`', async () => {
  // start, noteStatus(id, 'working'), end the session, reopen with no prompt -> argv ['/bin/codex', 'resume', '--last']
  // and after Quit mid-turn the carry-on reopen -> ['/bin/codex', 'resume', '--last', resumePromptFor(task)]
});
```

In `openingPrompt.test.ts`: a Codex prompt contains `Mainframe started you in this task's own worktree, /p/.mainframe/worktrees/s, on branch worktree-s.` and names `this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)`; the Claude Code prompts are byte-for-byte what they were.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/tasks/taskService.test.ts src/main/tasks/openingPrompt.test.ts`
Expected: FAIL, the reopen after `working` starts again instead of resuming (`began` is set only for OpenCode).

- [ ] **Step 3: Implement**
  - Add `readonly tracksBegan: boolean` to `AgentAdapter` (doc: "Mainframe marks the task began at its first in-turn report, as the agent records no session itself"): `true` for OpenCode and Codex, `false` for Claude Code. `noteStatus` tests `ADAPTERS[agentOf(task)].tracksBegan` instead of `=== 'opencode'`. (Testing `recordedSession(...) === null` instead would also catch Claude Code before its hook has fired.) Update the `if (!task.began)` comment in `reopenInWorktree` to name no agent.
  - The `openingPrompt` call passes `agent, projectDir: this.deps.projectDir, worktreePath: task.worktreePath` for every agent; `openingPrompt` drops the union and the `where` line.
  - Update the existing tests' `openingPrompt({ agent: 'claude', … })` calls to the new shape (add `projectDir`, `worktreePath`); their expected strings don't change.

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/agent.ts src/main/agents/claude.ts src/main/agents/opencode.ts src/main/agents/codex.ts src/main/tasks
git commit -m "feat: Codex tasks start in a Mainframe worktree and reopen with resume --last once they began"
```

---

### Task 3: The offline CLAUDE.md check, through to the page

**Files:**
- Create: `src/main/agents/codexInstructions.ts`, `src/main/agents/codexInstructions.test.ts`
- Modify: `src/main/setup/agentsInUse.ts`, `src/main/tasks/taskService.ts` (deps `Pick` and one method), `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`
- Test: `codexInstructions.test.ts`, `agentsInUse.test.ts`

**Interfaces:**
- Produces:
  - `export interface CodexConfigNote { configFile: string }` in `shared/types.ts`.
  - `codexMissesClaudeMd(o: { bin: string; projectDir: string; env: Record<string, string>; run?: (argv: string[], o: { cwd: string; env: Record<string, string> }) => Promise<string> }): Promise<boolean>` in `codexInstructions.ts`.
  - `codexConfigFile(env: Record<string, string>, platform: NodeJS.Platform): string` in `codexInstructions.ts`.
  - `AgentsInUse.codexClaudeMdNote(projectDir: string): Promise<CodexConfigNote | null>`.
  - `TaskService.codexClaudeMdNote(): Promise<CodexConfigNote | null>` (passes its own `projectDir`).
  - IPC `codexClaudeMdNote: 'tasks:codex-claude-md-note'`; preload `codexClaudeMdNote(dir: string): Promise<CodexConfigNote | null>`.

- [ ] **Step 1: Write the failing tests** in `codexInstructions.test.ts`, each in a temp project folder with a fake `run`:

```ts
const loaded = JSON.stringify([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /p\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>' }] }]);
const notLoaded = JSON.stringify([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] }]);

test('a CLAUDE.md that Codex would not load is missed', /* CLAUDE.md only, run -> notLoaded */ () => expect(...).resolves.toBe(true));
test('a CLAUDE.md that Codex loads is not missed', /* run -> loaded */ () => expect(...).resolves.toBe(false));
test('with an AGENTS.md, or no CLAUDE.md, codex is not run at all', /* run is a spy: not called; false */);
test('codex failing, printing non-JSON, or printing an object counts as not missed', /* run rejects / 'oops' / '{}' -> false */);
test('codex runs as `<bin> debug prompt-input` in the project folder', /* run called with ['/b/codex', 'debug', 'prompt-input'], { cwd: projectDir, env } */);
test('the config file is $CODEX_HOME/config.toml, else ~/.codex or %USERPROFILE%\\.codex', () => {
  expect(codexConfigFile({ CODEX_HOME: '/c' }, 'darwin')).toBe('/c/config.toml');
  expect(codexConfigFile({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.codex/config.toml');
  expect(codexConfigFile({ USERPROFILE: 'C:\\Users\\u' }, 'win32')).toBe('C:\\Users\\u\\.codex\\config.toml');
});
```

In `agentsInUse.test.ts`: `codexClaudeMdNote` resolves `null` when Codex isn't found, and `{ configFile }` when the check says missed.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/agents/codexInstructions.test.ts src/main/setup/agentsInUse.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**
  - `codexMissesClaudeMd`: `false` unless `CLAUDE.md` exists in `projectDir` and `AGENTS.md` doesn't; then run; `JSON.parse`; `false` unless an array; `true` when no item is a `message` with `role: 'user'` whose `content` has an `input_text` starting `# AGENTS.md instructions for `. Any throw → `false`. The default `run` is `execFile` with no shell, `windowsHide: true`, `timeout: 10_000`, `maxBuffer: 16 MiB`, resolving stdout; its output is never logged.
  - `AgentsInUse.codexClaudeMdNote`: `null` when `this.bin('codex')` is null; else `{ configFile: codexConfigFile(this.deps.env, process.platform) }` when missed, `null` when not.
  - `TaskService` deps `agents: Pick<AgentsInUse, 'bin' | 'defaultAgent' | 'ticked' | 'codexClaudeMdNote'>`; `codexClaudeMdNote()` returns `this.deps.agents.codexClaudeMdNote(this.deps.projectDir)`.
  - `ipcMain.handle(IPC.codexClaudeMdNote, (_e, dir: string) => tasksOf(dir).codexClaudeMdNote())`, beside `startCheck`.

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/codexInstructions.ts src/main/agents/codexInstructions.test.ts src/main/setup src/main/tasks/taskService.ts src/main/ipc.ts src/shared src/preload
git commit -m "feat: tell when Codex wouldn't read a project's CLAUDE.md, from codex debug prompt-input"
```

---

### Task 4: The page: Codex's name on cards and panels, and the CLAUDE.md note

Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Modify: `src/renderer/src/board/TaskCard.tsx:111-115`, `src/renderer/src/panel/SessionPanel.tsx:86-90`, `src/renderer/src/board/NewTaskDialog.tsx`, `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `window.mainframe.codexClaudeMdNote(dir)` and `CodexConfigNote` from Task 3; `window.mainframe.copyText(text)` (exists).

- [ ] **Step 1: Card and panel name every agent but Claude Code.** `<Show when={task.agent !== 'claude'}>` with `{AGENT_NAMES[task.agent]}`, keeping `class="agent-mark"` and `data-testid="task-agent"`.

- [ ] **Step 2: The note in the New task box.** A `createResource` keyed on `agent() === 'codex'` calls `window.mainframe.codexClaudeMdNote(project.dir)`; a rejection logs `[new task] codex note failed` and shows nothing. When it resolves to a note, below the agent choice (and shown even when Codex is the only option, so the choice itself is hidden):

  Copy, exact:
  - `Codex won't read this project's CLAUDE.md. Add this line at the top of {configFile}, then start the task:`
  - the line itself in `<code>`: `project_doc_fallback_filenames = ["CLAUDE.md"]`
  - a small button `Copy` that calls `window.mainframe.copyText('project_doc_fallback_filenames = ["CLAUDE.md"]')` and reads `Copied` for 1.5 s.

  `data-testid="new-task-codex-note"` on the note, `data-testid="new-task-codex-note-copy"` on the button. It never disables Start. Style it as the box's existing hints (`.nt-hint`) with the line set apart.

- [ ] **Step 3: Typecheck and unit tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src
git commit -m "feat: Codex's name on its cards and panels, and the New task box's note when Codex won't read CLAUDE.md"
```

---

### Task 5: e2e with a fake Codex

**Files:**
- Create: `e2e/fake-codex.cjs`, `e2e/codex.e2e.ts`
- Modify: `e2e/fake-claude.cjs`, `e2e/launch.ts`, `e2e/globalSetup.ts`

**Interfaces:**
- Produces: `fakeCodex` and `launchWithCodex(projects, env?, settings?)` in `e2e/launch.ts`, as `fakeOpencode` / `launchWithOpencode`; `appEnv` sets `MAINFRAME_CODEX_BIN: join(dataDir, 'no-codex')` beside `no-opencode`; `FAKE_CODEX_EXE` on Windows (a copy named `fake-codex.exe`).

- [ ] **Step 1: The fake.** `fake-codex.cjs` sets `FAKE_AGENT = 'codex'` and requires `fake-claude.cjs`, as `fake-opencode.cjs` does. In `fake-claude.cjs`: `isCodex` like `isOpencode` (env or `fake-codex` exe name); `--version` prints `codex-cli ${FAKE_CODEX_VERSION ?? '0.169.0'}`; `debug prompt-input` prints the contents of `codex-prompt-input.json` from the log folder when the test wrote one, else `[]`, and records nothing; every other run goes to `session()`, which already records argv and cwd and sends reports.

- [ ] **Step 2: Write the e2e tests** in `codex.e2e.ts`, modelled on `opencode.e2e.ts`:

```ts
test('a Codex task starts in its own worktree under .mainframe/worktrees', /* argv [<codex>, <prompt containing 'Task: Fix login'>], cwd .../.mainframe/worktrees/fix-login; card shows task-agent 'Codex' */);
test('a Codex task closed and reopened from its card runs `codex resume --last` in its worktree', /* after a 'working' report */);
test('Quit mid-turn carries the Codex session on with resume --last and the carry-on prompt', /* as OpenCode's */);
test("the New task box says when Codex won't read the project's CLAUDE.md", /* project with CLAUDE.md, no AGENTS.md, codex-prompt-input.json = '[]' -> new-task-codex-note visible with the line; with a loaded instructions item -> not visible */);
test('setup lists Codex', /* first start with launchWithCodex: the agents step has a Codex row with v0.169.0 */);
```

- [ ] **Step 3: Check the owner's Mainframe isn't running** (Global Constraints), on its own, and read the result.

- [ ] **Step 4: Run the Codex tests**

Run: `npm run test:e2e -- e2e/codex.e2e.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the whole e2e suite**

Run: `npm run test:e2e`
Expected: all passed. A timing failure that passes on a re-run of that one test is the known flake; note it in the report.

- [ ] **Step 6: Commit**

```bash
git add e2e
git commit -m "test: e2e for Codex tasks with a fake codex"
```

---

### Task 6: The hand check's fake model

**Files:**
- Create: `scripts/fake-codex-model.mjs`

- [ ] **Step 1: Write the script**, node built-ins only, run as `node scripts/fake-codex-model.mjs [port]` (default 18765). It:
  - makes a throwaway Codex home in `os.tmpdir()` (`mkdtemp('mainframe-codex-home-')`) and writes its `config.toml`:

    ```toml
    model = "fake-model"
    model_provider = "fake"
    [model_providers.fake]
    name = "fake"
    base_url = "http://127.0.0.1:<port>/v1"
    wire_api = "responses"
    ```
  - serves `POST /v1/responses`: after 2 s, server-sent events `response.created`, `response.output_item.done` (an assistant `message` with `output_text` "Done (fake model)."), `response.completed` with zero usage, as in the findings. Requests whose body has no `tools` (Codex's side requests) get the same answer at once. `GET …/models` gets `{"object":"list","data":[]}`.
  - prints, then serves until Ctrl+C:
    `Fake Codex model on http://127.0.0.1:<port>. Start Mainframe with CODEX_HOME=<dir> npm start (quit your own Mainframe first, or add MAINFRAME_DATA_DIR=<another folder>). Codex will ask once whether to trust the project.`

- [ ] **Step 2: Try it**: run the script in the background, then in a scratch git repo run `CODEX_HOME=<dir> codex "hi"` through a pty (or by hand), and check that the fake logs a `POST /v1/responses` and Codex shows "Done (fake model).". Stop the script.

- [ ] **Step 3: Commit**

```bash
git add scripts/fake-codex-model.mjs
git commit -m "chore: a fake model for trying Codex in Mainframe without an account"
```

---

## After the last task

Per `CLAUDE.md`: `/simplify main...HEAD`, the final whole-branch review, `/code-review high main...HEAD`, the three suites after each, and the `.git/claude-simplified` / `.git/claude-reviewed` records. Then the owner's hand check with `scripts/fake-codex-model.mjs`. The branch merges into the local `main` once accepted; **nothing is pushed** until the manager-and-sync branch is on `main` too (owner). Follow-ups to note in the report: the manager and the sync on Codex; commands an agent leaves running when its terminal closes.
