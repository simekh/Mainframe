# OpenCode Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can run on OpenCode 2.1+ instead of Claude Code. You pick it in the New task box, and it gets the same worktree, lanes, close, reopen, Quit and carry-on prompt as a Claude task.

**Architecture:** OpenCode's launch lives in `src/main/tasks/opencode.ts`, beside Claude's `launch.ts`. `TaskService` picks one by the task's `agent`. For OpenCode, Mainframe makes the worktree itself with `git worktree add` (same folder and branch names as Claude's `-w`), then runs `opencode --standalone -s <id> --prompt <text>` in it, with tabs turned off through an env var. Status needs one change: the summary record (id `''`) wins.

**Tech Stack:** Electron, TypeScript, Solid, node-pty, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-mainframe-opencode-tasks-design.md`

## Global Constraints

- OpenCode's minimum version is `2.1.0`. `opencode --version` prints `opencode vX.Y.Z`.
- An OpenCode session id is `ses_` plus 28 lowercase hex characters (32 bytes in all).
- Every OpenCode launch passes `--standalone` and gets the env `OPENCODE_CLI_CONFIG_CONTENT={"tabs":{"mode":"off"}}`.
- Worktrees stay at `<projectDir>/.claude/worktrees/<slug>` on branch `worktree-<slug>` for both agents.
- A record without `agent` is a Claude task. `state.json` stays at version 1.
- A Claude task's argv, cwd and prompt stay exactly as they are today. The existing tests must pass unchanged.
- The manager, the Todo sync, and tasks started from a Todo card or by the manager stay on Claude Code.
- Product code names no project, path or branch (see `CLAUDE.md`, "project-agnostic"). The OpenCode prompt names `AGENTS.md`/`CLAUDE.md` only as "this repo's instructions".
- Never run the e2e suite while the owner's own Mainframe is running: ask them to quit it first (Cmd+Q).
- Frontend work invokes the `frontend-design:frontend-design` skill (global `CLAUDE.md`).

## Review Focus

1. **Two OpenCode starts with the same title at once** must get two different slugs. The record goes into `records.all` before the `git worktree add` await (Task 4 test `two OpenCode starts at once get two slugs`).
2. **`git worktree add` fails** (say, the branch name is taken outside Mainframe's view). The start rejects with git's message and leaves no task behind (Task 4 test `a failed worktree add leaves no task`).
3. **The worktree folder was deleted by hand but its branch remains.** Reopen prunes git's stale entry, adds the worktree back and runs there (Task 3 git test, Task 4 reopen test).
4. **A repo with no `origin` remote** branches from `HEAD`, not an error (Task 3 test `branches from HEAD without origin/HEAD`).
5. **A `state.json` record with an unknown `agent`** is set aside like any bad file, never launched as Claude (Task 4 taskStore test).

---

### Task 1: The summary record wins

**Files:**
- Modify: `src/main/status/programStatus.ts` (`current()`)
- Test: `src/main/status/programStatus.test.ts`

**Interfaces:**
- Produces: `ProgramStatusRecords.current()` returns the record with id `''` when there is one, and otherwise the record updated last, as now.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns the summary record over a child updated later', () => {
  const r = new ProgramStatusRecords();
  r.apply({ id: '', state: 'working' }, 1);
  r.apply({ id: 'ses_child', state: 'idle' }, 2);
  expect(r.current()?.state).toBe('working');
});
it('returns the child updated last when there is no summary record', () => {
  const r = new ProgramStatusRecords();
  r.apply({ id: 'a', state: 'working' }, 1);
  r.apply({ id: 'b', state: 'blocked', kind: 'permission' }, 2);
  expect(r.current()?.id).toBe('b');
});
```

- [ ] **Step 2: Run them and see the first fail**

Run: `npx vitest run src/main/status/programStatus.test.ts`
Expected: `returns the summary record over a child updated later` fails with `idle`.

- [ ] **Step 3: Implement it.** `current()` returns `this.records.get('') ?? <last record>`. Update its doc comment to say why: OpenCode sends one summary record plus one record per pending session.

- [ ] **Step 4: Run the file again.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/status/programStatus.ts src/main/status/programStatus.test.ts
git commit -m "fix: a terminal's status is its summary record when it has one, so an OpenCode sub-session's state can't stand for the whole session"
```

---

### Task 2: Finding OpenCode

**Files:**
- Modify: `src/shared/types.ts` (add `MIN_OPENCODE_VERSION`, `AgentName`, `AGENT_NAMES`)
- Modify: `src/main/setup/programChecks.ts`, `src/main/config.ts`, `src/main/pty/spawnEnv.ts`
- Test: `src/main/setup/programChecks.test.ts`, `src/main/config.test.ts`, `src/main/pty/spawnEnv.test.ts`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  - `export const MIN_OPENCODE_VERSION = '2.1.0';`
  - `export type AgentName = 'claude' | 'opencode';`
  - `export const AGENT_NAMES: Record<AgentName, string> = { claude: 'Claude Code', opencode: 'OpenCode' };`
- Produces, in `programChecks.ts`:
  - `parseOpencodeVersion(stdout: string): string | null`: matches `/^opencode v(\d+\.\d+\.\d+)$/` on the trimmed output
  - `opencodePlaces(lookup: ExecutableLookup): string[]`: `findExecutable('opencode', lookup)`, then `<home>/.opencode/bin/opencode` (`%USERPROFILE%\.opencode\bin\opencode.exe` on Windows). Deduplicated, nulls dropped.
  - `findOpencode(o: { fromEnv?: string; lookup: ExecutableLookup; run: VersionRunner }): Promise<ProgramCheck>`: same rules as `findClaude`, without `saved`
- Produces, in `config.ts`: `AppConfig.opencodeBin?: string` from `MAINFRAME_OPENCODE_BIN`. An empty value throws `MAINFRAME_OPENCODE_BIN must name the opencode binary, got an empty value`.
- Produces, in `spawnEnv.ts`: `OPENCODE_TERMINAL` and `OPENCODE_PTY_HANDOFF` join `DROPPED_KEYS`. Add a comment saying OpenCode sets them in the shells it runs.

- [ ] **Step 1: Write the failing tests.** Follow the existing `findClaude` and `checkClaude` tests and their fakes in `programChecks.test.ts`:
  - `parseOpencodeVersion('opencode v2.2.7\n')` is `'2.2.7'`; `parseOpencodeVersion('2.2.7 (Claude Code)')` is `null`
  - `findOpencode` with a 1.18.35 on PATH returns `{ state: 'too-old', path, version: '1.18.35' }`
  - with nothing anywhere, it returns `{ state: 'missing' }`
  - with nothing on PATH and a working `~/.opencode/bin/opencode`, it returns `found` at that path (POSIX and win32 lookups)
  - with `fromEnv` set, it looks only there
  - `loadConfig({ MAINFRAME_OPENCODE_BIN: '' }, '/d')` throws the message above
  - `buildSpawnEnv({ OPENCODE_TERMINAL: '1', OPENCODE_PTY_HANDOFF: '{}', OPENCODE_CONFIG_DIR: '/x' }, 'darwin')` keeps only `OPENCODE_CONFIG_DIR` of the three

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/setup/programChecks.test.ts src/main/config.test.ts src/main/pty/spawnEnv.test.ts`
Expected: FAIL (missing exports or wrong values).

- [ ] **Step 3: Implement the interfaces above.** Generalise `checkClaude` into `checkProgram(path, parse, min, run, files)` and keep `checkClaude` as a thin call to it, so both agents share one check.

- [ ] **Step 4: Run the three files, then `npm run typecheck`.** Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/setup/programChecks.ts src/main/setup/programChecks.test.ts src/main/config.ts src/main/config.test.ts src/main/pty/spawnEnv.ts src/main/pty/spawnEnv.test.ts
git commit -m "feat: Mainframe can find OpenCode 2.1 or later, on PATH, in its installer's folder or through MAINFRAME_OPENCODE_BIN"
```

---

### Task 3: OpenCode's launch, its worktree, and its opening prompt

**Files:**
- Create: `src/main/tasks/opencode.ts`, `src/main/tasks/opencode.test.ts`
- Modify: `src/main/git.ts` (add `addWorktree` to `gitQueries`), `src/main/tasks/openingPrompt.ts`
- Test: `src/main/git.test.ts` (use `src/main/testing/makeRepo.ts`), `src/main/tasks/openingPrompt.test.ts`

**Interfaces:**
- Consumes: `AgentName` (Task 2).
- Produces, in `opencode.ts`:
  - `export const OPENCODE_ENV: Record<string, string> = { OPENCODE_CLI_CONFIG_CONTENT: '{"tabs":{"mode":"off"}}' };`
  - `newOpencodeSessionId(): string`: `ses_` plus 28 hex characters from `randomBytes(14)`
  - `isOpencodeSessionId(s: string): boolean`: `/^ses_[0-9a-f]{28}$/`
  - `opencodeStartArgv(o: { opencodeBin: string; sessionId: string; prompt: string }): string[]` returns `[bin, '--standalone', '-s', id, '--prompt', prompt]`
  - `opencodeReopenArgv(o: { opencodeBin: string; sessionId: string; prompt?: string }): string[]` returns `[bin, '--standalone', '-s', id]`, plus `'--prompt', prompt` when given. It throws `not a session id: <id>` when `!isOpencodeSessionId(id)`.
- Produces, in `git.ts`: `addWorktree(projectDir: string, path: string, branch: string, o: { create: boolean }): Promise<void>`
  - `create: true` runs `git worktree add --no-track -b <branch> <path> <base>`. `<base>` is `origin/HEAD` when `git rev-parse --verify --quiet origin/HEAD` succeeds, and `HEAD` otherwise.
  - `create: false` runs `git worktree prune`, then `git worktree add <path> <branch>`.
  - It rejects with git's error when git fails.
- Produces, in `openingPrompt.ts`: `openingPrompt(t)` takes two more fields, `agent: AgentName` and `projectDir: string`, and keeps `worktreePath` from the task. For `'claude'` the text is byte for byte today's. For `'opencode'`:
  - Every "this repo's CLAUDE.md" becomes `this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)` on its first mention and `those instructions` after that.
  - The worktree note is exactly:
    `Mainframe started you in this task's own worktree, ${worktreePath}, on branch ${branch}. The main checkout is ${projectDir}: when you need it, for example to merge, run git there with git -C ${projectDir}.`

- [ ] **Step 1: Write the failing tests**
  - `opencode.test.ts`:
    - `opencodeStartArgv({ opencodeBin: 'oc', sessionId: 'ses_' + 'a'.repeat(28), prompt: 'P' })` equals `['oc', '--standalone', '-s', 'ses_aaaa…', '--prompt', 'P']`
    - reopen without a prompt has no `--prompt`
    - reopen with `'ses_x'` throws `not a session id: ses_x`
    - 100 `newOpencodeSessionId()` calls all pass `isOpencodeSessionId` and are distinct
  - `git.test.ts` (each in a `makeRepo` repo):
    - `branches from origin/HEAD when there is one`: clone the repo, add a commit to the clone's `main`, then call `addWorktree(clone, path, 'worktree-a', { create: true })`. The worktree's `HEAD` equals `origin/HEAD`, not the new commit.
    - `branches from HEAD without origin/HEAD`: a repo without a remote gets a worktree at `HEAD`.
    - `adds a deleted worktree back on its branch`: create, then `rm -rf` the folder, then call `addWorktree(dir, path, 'worktree-a', { create: false })`. The folder exists on `worktree-a`.
    - `rejects when the branch is taken`: `create: true` on an existing branch name rejects.
  - `openingPrompt.test.ts`:
    - an `'opencode'` prompt contains the exact worktree note above, contains `AGENTS.md`, and contains neither `EnterWorktree` nor `ExitWorktree`
    - a `'claude'` prompt equals the existing snapshot or expected string, unchanged

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/tasks/opencode.test.ts src/main/git.test.ts src/main/tasks/openingPrompt.test.ts`
Expected: FAIL (module and functions missing).

- [ ] **Step 3: Implement the interfaces above.** Pass the agent's instructions phrase into `BRIEF`, `NO_QUESTIONS` and `cardParts` rather than duplicating them.

- [ ] **Step 4: Run the three files, then `npm run typecheck`.** Expected: all pass. Fix the existing `openingPrompt` callers' types: `taskService.ts` passes `agent: 'claude'` for now.

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/opencode.ts src/main/tasks/opencode.test.ts src/main/git.ts src/main/git.test.ts src/main/tasks/openingPrompt.ts src/main/tasks/openingPrompt.test.ts src/main/tasks/taskService.ts
git commit -m "feat: OpenCode's launch: its argv, a worktree Mainframe makes from origin/HEAD, and an opening prompt that names the repo's AGENTS.md and the main checkout"
```

---

### Task 4: Tasks run on their agent

**Files:**
- Modify: `src/main/tasks/taskStore.ts`, `src/main/tasks/taskService.ts`, `src/main/pty/sessionHost.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/shared/types.ts` (`TaskView.agent`), `src/preload/index.ts`, `src/main/index.ts`
- Test: `src/main/tasks/taskStore.test.ts`, `src/main/tasks/taskService.test.ts`, `src/main/pty/sessionHost.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - `TaskRecord.agent?: AgentName`. `isTaskRecord` accepts `undefined`, `'claude'` or `'opencode'` and nothing else. New records always store it.
  - `TaskView.agent: AgentName` and `SessionReport.agent: AgentName` (`task.agent ?? 'claude'`).
  - `TaskServiceDeps.opencodeBin: string | null` and `TaskServiceDeps.git.addWorktree`.
  - `TaskService.start(req: { title; description; noQuestions; card?; agent?: AgentName })`. Without `agent` the task is `'claude'`. With `'opencode'` and `opencodeBin === null` it throws `OpenCode 2.1 or later is not installed`.
  - `TaskService.launchSpec(id): { argv: string[]; cwd: string; env?: Record<string, string> }`. Claude tasks keep `cwd: projectDir` and get no `env`.
  - `SessionHost.spawn` spec gains `env?: Record<string, string>`, laid over the host's env for both `resolveExecutable` and the spawn.
  - IPC `startTask(dir, { title, description, noQuestions, agent })`. Main passes on only `'opencode'` or `'claude'`.
  - IPC `agentChecks(): Promise<{ opencode: ProgramCheck }>`, channel `agents:checks`.
  - In `index.ts`, `start()` awaits `findOpencode({ fromEnv: config.opencodeBin, lookup: lookupIn(programs.env), run: runVersion(programs.env) })` once and hands `opencodeBin` (the path when `found`, else `null`) to every project's `TaskService`.

**How an OpenCode task runs in `TaskService`:**
- **Start:**
  - pick the slug as now
  - set `claudeSessionId = newOpencodeSessionId()`
  - push the record into `records.all` without a commit, then `await git.addWorktree(projectDir, worktreePath, branch, { create: true })`
  - on failure, take the record out again and rethrow
  - then add the session: `opencodeStartArgv`, `cwd: worktreePath`, `env: OPENCODE_ENV`; then commit
  - write no hook settings
  - the Windows long-description fallback applies as for Claude, without `--add-dir`
- **Reopen:**
  - after the existing guard, which also checks a new `private readonly launching = new Set<string>()` of task ids, work out the folder:
    - the worktree folder exists: `cwd: worktreePath`
    - it's gone but the branch exists: add the task id to `launching`, `await git.addWorktree(..., { create: false })`, then remove it in `finally`, and use `cwd: worktreePath`
    - both are gone: `cwd: projectDir`
  - argv is `opencodeReopenArgv` with `resumePromptFor(task)`
  - `startedWithPrompt` and `resumePending` follow the carry-on prompt, as for Claude
- `onSessionExit` reads the recorded SessionStart id only for Claude tasks.

- [ ] **Step 1: Write the failing tests**, using the existing fakes in `taskService.test.ts` (add `addWorktree` and `opencodeBin: '/bin/opencode'` to them):
  - **`an OpenCode task starts in its worktree`**
    - `git.addWorktree` was called with `(projectDir, <projectDir>/.claude/worktrees/<slug>, 'worktree-<slug>', { create: true })`
    - `launchSpec` has argv `['/bin/opencode', '--standalone', '-s', id, '--prompt', <prompt>]`, `cwd` the worktree and `env` `OPENCODE_ENV`
    - `id` passes `isOpencodeSessionId`, and `list()[0].agent` is `'opencode'`
  - **`a Claude task's launch is unchanged`**: no `agent` gives today's argv, `cwd: projectDir`, and no `env` key.
  - **`two OpenCode starts at once get two slugs`**: two `start({ title: 'Same', agent: 'opencode' })` calls without awaiting give slugs `same` and `same-2`.
  - **`a failed worktree add leaves no task`**: `addWorktree` rejects with `Error('fatal: x')`. `start` rejects with `fatal: x`, and `list()` is empty.
  - **`OpenCode not installed`**: with `opencodeBin: null`, `start({ ..., agent: 'opencode' })` rejects with `OpenCode 2.1 or later is not installed`.
  - **`reopen resumes the same OpenCode session`**: after the session exits, `reopen` gives argv `['/bin/opencode', '--standalone', '-s', <same id>]`. After an exit that was mid-turn (`noteStatus` working, then exit), the argv ends `'--prompt', 'Continue where you left off.'`.
  - **`reopen adds a deleted worktree back`**:
    - with the worktree folder missing and `branchExists` true, `addWorktree` gets `{ create: false }` and `cwd` is the worktree
    - with the branch missing too, `cwd` is `projectDir` and `addWorktree` isn't called
  - **`reports name the agent`**: `reports()[0].agent` is `'opencode'`.
  - **taskStore, `old records load as Claude tasks`**: a version 1 file without `agent` loads, and its view's agent is `'claude'`.
  - **taskStore, `an unknown agent sets the file aside`**: `agent: 'gemini'` gives `[]` and a `.bad-` file.
  - **sessionHost, `a session's env is laid over the host's`**: `spawn` with `env: { A: '2' }` on a host with `{ A: '1', B: '1' }` spawns with `{ A: '2', B: '1' }`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/tasks src/main/pty/sessionHost.test.ts`
Expected: the new tests fail; the existing ones pass.

- [ ] **Step 3: Implement the interfaces and the flow above.** In `index.ts` and `ipc.ts`, wire `opencodeBin`, `agentChecks` and the `agent` field. `TodoService` and `managerTools` keep calling `start` without `agent`.

- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: all unit tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main src/shared src/preload
git commit -m "feat: a task runs on its own agent: an OpenCode task gets a worktree Mainframe makes, its own session id, and reopens and carries on as a Claude task does"
```

---

### Task 5: Picking the agent in the New task box

**Files:**
- Create: `src/renderer/src/board/agentPrefs.ts`, `src/renderer/src/board/agentPrefs.test.ts`
- Modify: `src/renderer/src/board/NewTaskDialog.tsx`, `src/renderer/src/tasksStore.ts` (`startTask` passes `agent`), `src/renderer/src/board/TaskCard.tsx`, `src/renderer/src/panel/SessionPanel.tsx`, and the stylesheet those components use

**Interfaces:**
- Consumes: `AgentName`, `AGENT_NAMES`, `MIN_OPENCODE_VERSION` (Task 2); `window.mainframe.agentChecks()` and `TaskView.agent` (Task 4).
- Produces, in `agentPrefs.ts`:
  - `loadAgent(storage: Pick<Storage, 'getItem'>, dir: string, opencodeFound: boolean): AgentName`: `'opencode'` only when the stored value is `'opencode'` and `opencodeFound`; otherwise `'claude'`
  - `saveAgent(storage: Pick<Storage, 'setItem'>, dir: string, agent: AgentName): void`: swallows a refused write, as `saveHideMine` does
  - the key is `mainframe.new-task-agent:<dir>`

**What the dialog shows** (invoke `frontend-design:frontend-design` and match the dialog's existing `field` and `check` styles):
- When `agentChecks().opencode.state === 'found'`: an "Agent" choice of two options, Claude Code and OpenCode (`data-testid` `new-task-agent-claude` and `new-task-agent-opencode`). It starts at `loadAgent(...)`, and a start saves the pick with `saveAgent`.
- When the state is `too-old`, a hint (`data-testid="new-task-agent-hint"`): `OpenCode ${version} is installed. Mainframe needs ${MIN_OPENCODE_VERSION} or later.`
- When it is `broken`: `The opencode at ${path} didn't say its version, so Mainframe can't use it.`
- When it is `missing`: nothing new.
- The sub line reads `Starts ${AGENT_NAMES[agent]} in a new worktree of ${project.name}`.
- **Card and session panel header:** a small mark reading `OpenCode` (`data-testid="task-agent"`) on OpenCode tasks only.

- [ ] **Step 1: Write the failing tests** in `agentPrefs.test.ts`:
  - nothing stored gives `'claude'`
  - a stored `'opencode'` gives `'opencode'` when found and `'claude'` when not
  - a `setItem` that throws doesn't throw out of `saveAgent`

- [ ] **Step 2: Run it and see it fail.** Run: `npx vitest run src/renderer/src/board/agentPrefs.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `agentPrefs.ts`, the dialog, the mark and `startTask`'s `agent`.**

- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: the New task box offers OpenCode when it is installed, remembers the pick per project, and says when the OpenCode found is too old; OpenCode tasks carry a mark"
```

---

### Task 6: E2E with a fake OpenCode, and the README

**Files:**
- Create: `e2e/fake-opencode.cjs`, `e2e/opencode.e2e.ts`
- Modify: `e2e/fake-claude.cjs`, `e2e/globalSetup.ts`, `e2e/launch.ts` (export `fakeOpencode`), `README.md`

**Interfaces:**
- Consumes: everything above. Test ids from Task 5. `launches`, `report`, `sendLine`, `cardIn`, `card`, `repo`, `launchApp` and `launchAgain` from `e2e/tasks.ts` and `e2e/launch.ts`.
- Produces:
  - **`e2e/fake-opencode.cjs`:** sets `process.env.FAKE_AGENT = 'opencode'` and requires `./fake-claude.cjs`.
  - **`fake-claude.cjs`:** treats itself as OpenCode when `process.env.FAKE_AGENT === 'opencode'` or `basename(process.execPath).startsWith('fake-opencode')`. As OpenCode, `--version` prints `opencode v${process.env.FAKE_OPENCODE_VERSION ?? '2.2.7'}`. A launch records `<pid>.env`, holding the JSON `{ OPENCODE_CLI_CONFIG_CONTENT }`, beside `<pid>.argv`. Then it runs the same shell.
  - **`globalSetup.ts`:** on Windows, copies the built `.exe` to `fake-opencode.exe` in the same folder and sets `FAKE_OPENCODE_EXE`.
  - **`launch.ts`:** `export const fakeOpencode = process.env.FAKE_OPENCODE_EXE ?? join(root, 'e2e', 'fake-opencode.cjs');`. Only `opencode.e2e.ts` passes `MAINFRAME_OPENCODE_BIN: fakeOpencode`, so the other suites see no agent choice.

- [ ] **Step 1: Write `e2e/opencode.e2e.ts`**, with these tests:
  - **`an OpenCode task starts in its own worktree`**
    - pick `new-task-agent-opencode` and start
    - the launch's cwd is `<repo>/.claude/worktrees/<slug>`
    - its args are `['--standalone', '-s', <id matching /^ses_[0-9a-f]{28}$/>, '--prompt', <text containing 'AGENTS.md'>]`
    - `git -C <repo> rev-parse --verify worktree-<slug>` succeeds
    - its env file has `{"tabs":{"mode":"off"}}`
    - the card shows `task-agent` with `OpenCode`
  - **`its card follows the summary record`**
    - `sendLine(report('working'))`: the card is in `working`
    - then send a child record, `printf '\033]7501;state=idle:id=ses_child\033\\'` (fields are separated by `:`, as in OpenCode's own `state=idle:app=opencode`): the card is still in `working`
  - **`Quit mid-turn carries the OpenCode session on`**
    - report `working`, then quit the app
    - `launchApp` again on the same data folder: the newest launch has args `['--standalone', '-s', <same id>, '--prompt', 'Continue where you left off.']` and the same cwd
  - **`the dialog says when OpenCode is too old`**
    - with `FAKE_OPENCODE_VERSION=1.18.35`, `new-task-agent-hint` reads `OpenCode 1.18.35 is installed. Mainframe needs 2.1.0 or later.`
    - `new-task-agent-opencode` isn't there

- [ ] **Step 2: Ask the owner to quit their Mainframe (Cmd+Q), then run `npm run test:e2e -- e2e/opencode.e2e.ts`.** Expected: FAIL until the fake changes are in; after them, PASS.

- [ ] **Step 3: Implement the fake, `globalSetup` and `launch.ts` changes.**

- [ ] **Step 4: Run the whole e2e suite: `npm run test:e2e`.** Expected: all pass, including the existing suites, which are unchanged.

- [ ] **Step 5: Update `README.md`.**
  - Add an optional row to the requirements table: OpenCode 2.1 or later, from its installer (`~/.opencode/bin`) or any `opencode` on PATH.
  - Add one paragraph: the New task box offers OpenCode when it is found. An OpenCode task runs in the same kind of worktree and follows the repo's `AGENTS.md` (or `CLAUDE.md`). The manager, the Todo sync and tasks started from cards still use Claude Code. `MAINFRAME_OPENCODE_BIN` names a particular `opencode`.

- [ ] **Step 6: Commit**

```bash
git add e2e README.md
git commit -m "test: e2e for OpenCode tasks with a fake opencode, and the README says how OpenCode tasks work"
```

---

### After the last task

Per this repo's `CLAUDE.md`:
1. `/simplify` with args `main...HEAD`. Check its edits, run the three suites, commit, then record the tip in `.git/claude-simplified`.
2. The final whole-branch review.
3. `/code-review high main...HEAD`. Fix what it finds, run the three suites, commit, then record the tip in both `.git/claude-reviewed` and `.git/claude-simplified`.
4. The owner tries a real OpenCode task by hand:
   - start one and watch it work
   - answer a permission
   - close and reopen it
   - Quit with it mid-turn and start Mainframe again
