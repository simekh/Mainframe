# Finished Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks whose work is finished leave the board for a Finished tab, and unfinished ones can be paused, put back on the to-do list or discarded.

**Architecture:** `git.ts` gains one query that reports what a task would lose (`taskGitState`) and the removals. `TaskService` gains a place for each task (board, put back, finished, discarded), a check round that moves safe tasks to Finished, and Discard and Continue. `TodoService` orchestrates Put back, since it owns the to-do list. The renderer renames Closed to Paused, adds the card buttons and a Finished tab in the Todo panel.

**Tech Stack:** Electron, TypeScript, SolidJS, Vitest, Playwright, git CLI.

**Spec:** `docs/superpowers/specs/2026-11-16-mainframe-finished-tasks-design.md` (read it whole before any task).

## Global Constraints

- Nothing names a project, a branch (`main`), a tracker or a skill. The base is `origin/HEAD`, else the main checkout's `HEAD` (CLAUDE.md, "project-agnostic").
- Everything is per project: each `TaskService` runs its own round, timer and fetch, and touches only `mine()` tasks (CLAUDE.md, "several projects at once").
- `state.json` stays `VERSION = 1`: new `TaskRecord` fields are optional, and records without them load as tasks on the board.
- Mainframe's git calls keep `--no-optional-locks`. Nothing is deleted without proof: the check run again just before removal, or the owner's confirm on Discard. Only Discard passes `--force` to `git worktree remove`. A passed check deletes the branch with `git branch -D`.
- A git that lacks `merge-tree --write-tree` (before 2.38) makes the branch count as `unmerged`: the safe side.
- The fetch runs with `GIT_TERMINAL_PROMPT=0` and a 30 s timeout. A failed or timed-out fetch is not an error.
- Prompts defer to the repo's instructions through the adapter's `Instructions`, never to a named file or skill.
- Copy, exactly: lane **Paused**, empty text "No paused tasks", panel note "Paused. Reopen continues this chat.", buttons **Reopen**, **Put back**, **Discard**, **Finish**, **Continue**, card label **Merged**, tabs **To do** and **Finished**, rows "Finished 11 Nov" / "Discarded 11 Nov" (day and short month in the system's locale), "· no card", the put-back failure "Put back: the card is not on the to-do list".
- UI tasks (Tasks 7 and 8) invoke `frontend-design:frontend-design` during implementation (the owner's global rule).
- Commit subjects carry no AI attribution.

## Review Focus

1. **A task paused before it did anything** (its conversation never began, or its branch has no commits of its own) must stay Paused, never move to Finished. Tests in Tasks 1 and 3.
2. **Uncommitted or untracked files** in a worktree whose branch is merged keep the task Paused, and the round removes nothing. Tests in Tasks 1 and 3.
3. **A project with no remote** (no `origin/HEAD`): the base is `HEAD`, the fetch is skipped, and the round works. Test in Task 1.
4. **A task reopened or continued while a round is checking it**: the round must not remove its worktree under a session that is starting. Test in Task 3.
5. **Quit or project close during a round**: no removal happens after `beginQuit`. Test in Task 3.

---

### Task 1: Git queries for what a task would lose, and its removal

**Files:**
- Modify: `src/main/git.ts`
- Test: `src/main/git.test.ts`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  ```ts
  export interface TaskGitState {
    /** gone: no local branch. no-commits: the branch still points where it was created. merged: merging it into the base changes nothing. */
    branch: 'gone' | 'no-commits' | 'merged' | 'unmerged';
    /** Paths with uncommitted changes or untracked (not ignored) files in the worktree; [] when the folder is gone or is not a worktree's top. */
    uncommitted: string[];
    /** Subjects of the branch's commits that are on neither the base nor any remote branch, newest first; [] when the branch is gone. */
    unsaved: string[];
  }
  ```
- Produces, in `src/main/git.ts`, all added to `gitQueries`:
  - `fetchBase(projectDir: string): Promise<void>`: never rejects.
  - `taskGitState(projectDir: string, branch: string, worktreePath: string): Promise<TaskGitState>`
  - `removeWorktree(projectDir: string, worktreePath: string, o: { force: boolean }): Promise<void>`: resolves at once when the folder is gone; rejects with git's message.
  - `deleteBranch(projectDir: string, branch: string): Promise<void>`: `git branch -D`; resolves when the branch is gone already.

- [ ] **Step 1: Write the failing tests** in `src/main/git.test.ts`, using `repo()` and `commitFile`. Make a task branch with `git(main, 'worktree', 'add', '--no-track', '-b', 'worktree-t', wt, 'origin/HEAD')`, which also writes the reflog entry that marks where the branch was created:
  - `taskGitState is gone for a missing branch and a missing folder`: `{ branch: 'gone', uncommitted: [], unsaved: [] }`.
  - `taskGitState is no-commits for a branch still where it was created, even once the base moves on`: after a commit on `stage` pushed to origin, still `no-commits`.
  - `taskGitState is merged after a fast-forward merge, a merge commit and a squash merge`: three branches, each merged into `stage` and pushed in its own way, each `merged`, with `unsaved: []`.
  - `taskGitState is unmerged for a branch with commits not on the base, and lists those not on any remote`: `unsaved` equals the subjects. Once the branch is pushed to `origin`, `unsaved` is `[]` and the branch is still `unmerged`.
  - `taskGitState lists uncommitted and untracked files, not ignored ones`: modify a tracked file, add an untracked one, and add an ignored one (via `.gitignore`). `uncommitted` equals the first two, sorted.
  - `taskGitState uses HEAD as the base when there is no origin/HEAD`: after `git remote set-head origin --delete`, a branch merged into local `stage` only is `merged`.
  - `fetchBase brings in a merge pushed from another clone, and resolves without a remote`: clone `origin` a second time, merge the task branch there and push. Before `fetchBase(main)` the branch is `unmerged`, after it `merged`. On a repo with `origin` removed, `fetchBase` resolves.
  - `removeWorktree and deleteBranch remove a merged task's worktree and branch, and resolve when they are gone already`: afterwards `branchExists` is false and the folder is gone. A second call of each resolves.
  - `removeWorktree refuses a worktree with untracked files unless forced`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/main/git.test.ts`
  Expected: FAIL. The new exports are not defined.

- [ ] **Step 3: Implement the four functions in `src/main/git.ts`.**
  - The `git()` helper gains `opts.env` (laid over `process.env`) and `opts.timeoutMs` (execFile's `timeout`).
  - Base: a private `base(projectDir)` returns `'origin/HEAD'` when `rev-parse --verify --quiet origin/HEAD` succeeds, else `'HEAD'`.
  - `fetchBase`:
    - `symbolic-ref --short refs/remotes/origin/HEAD` gives `origin/<name>`.
    - Then `fetch --quiet origin <name>`, with env `GIT_TERMINAL_PROMPT=0` and a 30 000 ms timeout.
    - Any failure resolves.
  - `taskGitState`:
    - `branch` is decided in this order, all with refs in `refs/heads/<branch>` form:
      - `gone` when `branchExists` is false.
      - `no-commits` when the tip equals the oldest entry of `reflog show --format=%H refs/heads/<branch>`. With no reflog: when `rev-list --count <base>..<branch>` is 0.
      - `merged` when the first line of `merge-tree --write-tree <base> <branch>` (exit 0) equals `rev-parse <base>^{tree}`. A non-zero exit (a conflict, or an old git) is `unmerged`.
      - Otherwise `unmerged`.
    - `unsaved` is `log --format=%s <branch> --not <base> --remotes`.
    - `uncommitted` uses the existing `isWorktreeTop`, then `status --porcelain=v1 -z --untracked-files=all` with `NO_INDEX_REFRESH`.
  - `removeWorktree`: `worktree remove [--force] <path>`, then `worktree prune`.
  - `deleteBranch`: `branch -D <branch>` when `branchExists`.

- [ ] **Step 4: Run them to see them pass**

  Run: `npx vitest run src/main/git.test.ts`
  Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main/git.ts src/main/git.test.ts src/shared/types.ts
  git commit -m "feat: git reports what a task's worktree and branch would lose, and removes them"
  ```

---

### Task 2: A task's place, and what the board and the manager see of it

**Files:**
- Modify: `src/main/tasks/taskStore.ts`, `src/main/tasks/taskService.ts`, `src/shared/types.ts`, `src/main/mcp/managerTools.ts`
- Test: `src/main/tasks/taskStore.test.ts`, `src/main/tasks/taskService.test.ts`, `src/main/mcp/managerTools.test.ts`

**Interfaces:**
- Produces in `src/shared/types.ts`: `export type TaskPlace = 'putBack' | 'finished' | 'discarded';`
- `TaskRecord` gains `place?: TaskPlace` and `endedAt?: number`. `isTaskRecord` accepts them missing, or as one of the three strings and a number.
- `TaskView` gains:
  - `place: TaskPlace | null`
  - `endedAt: number | null`
  - `merged: boolean`: a running task the last round found had nothing to lose.
  - `problem: string | null`: Put back's failure line. Kept in memory, cleared by any reopen or move.
- `SessionReport` gains `place: TaskPlace | null` and `endedAt: number | null`. The `list_sessions` description says so: "…and where it is: null on the board, putBack, finished or discarded, with endedAt."
- `TaskService` gains private `merged = new Set<string>()` and `problems = new Map<string, string>()`, read by `view()`.
- In the test file's `setup()`, the fake `GitQueries` gains `fetchBase: async () => {}`, `taskGitState: async () => ({ branch: 'unmerged', uncommitted: [], unsaved: [] })`, `removeWorktree: async () => {}` and `deleteBranch: async () => {}`.

- [ ] **Step 1: Write the failing tests**
  - `taskStore.test.ts`: `loadTasks keeps place and endedAt, and loads records without them`. A record with `place: 'finished', endedAt: 5` round-trips. One with `place: 'gone'` is set aside, as other bad files are.
  - `taskService.test.ts`: `a view carries place, endedAt, merged and problem: null, null, false and null for a new task`.
  - `managerTools.test.ts`: `list_sessions reports each task's place and endedAt`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/main/tasks src/main/mcp`
  Expected: FAIL on the new fields.

- [ ] **Step 3: Add the fields** to `TaskRecord`, `isTaskRecord`, `TaskView`, `view()`, `SessionReport`, `reports()` and the tool's description. Update `toMatchObject`/`toEqual` expectations that list a whole view.

- [ ] **Step 4: Run the unit tests and the typecheck**

  Run: `npx vitest run && npx tsc --noEmit`
  Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main/tasks src/shared/types.ts src/main/mcp
  git commit -m "feat: a task records where it is (board, put back, finished, discarded), and the board and manager see it"
  ```

---

### Task 3: The check round moves finished tasks off the board

**Files:**
- Modify: `src/main/tasks/taskService.ts`, `src/main/index.ts`
- Test: `src/main/tasks/taskService.test.ts`

**Interfaces:**
- Consumes: Task 1's `fetchBase`, `taskGitState`, `removeWorktree`, `deleteBranch`. Task 2's fields.
- Produces:
  - `TaskService.checkRound(): Promise<void>`. A call while a round runs returns that round's promise.
  - `export const FINISH_CHECK_MS = 3 * 60_000;` in `taskService.ts`.

**Behaviour** (spec, "The check"):
- A round does nothing while `quitting`.
- It calls `fetchBase` once, then checks each `mine()` task whose `place` is undefined or `'putBack'`. It skips tasks in `starting` or `launching`.
- Its conversation began when:
  - Claude: `ADAPTERS.claude.recordedSession(taskDir) !== null`.
  - OpenCode: `task.began === true`.
- Nothing to lose: it began, `uncommitted` is empty, and `branch` is `'gone'` or `'merged'`.
- **Running task:** adds to or removes from `merged`, then sends the list when the set changed.
- **No running task, nothing to lose:**
  - Calls `taskGitState` again. If that still passes and no session or launch began meanwhile, it runs `removeWorktree(…, { force: false })`, then `deleteBranch`.
  - Then sets `place = 'finished'` and `endedAt = now()`, and runs `commit()`.
  - A rejected removal: `warn`, and the task stays where it was.
- **Triggers:**
  - `onSessionExit` calls `void this.checkRound()`. A task's exit then also finishes it, which is how **Finish** works: Finish is Close.
  - `restore()` calls it once its loop is done.
  - `index.ts` `start()` runs `setInterval(() => void service.checkRound(), FINISH_CHECK_MS)`, cleared in `cancelSync` (which close and Quit both call).
- A rejected round warns and never throws to its trigger.

- [ ] **Step 1: Write the failing tests** in `taskService.test.ts`, driving `taskGitState` with a fake that returns a state per branch and counts calls:
  - `a round moves a closed task with a merged branch and nothing uncommitted to Finished, removing its worktree and branch`: asserts `place: 'finished'`, `endedAt: 1000`, the removal calls in order with `force: false`, and the saved record.
  - `a round moves a closed task whose branch and worktree are gone to Finished`.
  - `a round leaves a task whose conversation never began, though its branch is gone` (Review Focus 1).
  - `a round leaves a task whose branch has no commits of its own` (Review Focus 1).
  - `a round leaves a merged task with uncommitted files, and removes nothing` (Review Focus 2).
  - `a round marks a running merged task merged, without closing or removing anything, and clears the mark when it no longer passes`.
  - `a closed merged task is finished by the round its exit starts`: close, then `onSessionExit`, then await the round.
  - `a task reopened while the round checks it is not removed` (Review Focus 4): make `taskGitState` wait on a promise, call `reopen`, then release it. No removal, and `place` stays undefined.
  - `no round removes anything after beginQuit` (Review Focus 5).
  - `a round touches only its own project's tasks`: two services on one `TaskRecords`.
  - `a removal git refuses leaves the task where it was and warns`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/main/tasks/taskService.test.ts`
  Expected: FAIL, as `checkRound` is not a function.

- [ ] **Step 3: Implement `checkRound`** and its triggers in `taskService.ts`, and the interval in `index.ts`.

- [ ] **Step 4: Run the unit tests and the typecheck**

  Run: `npx vitest run && npx tsc --noEmit`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main/tasks/taskService.ts src/main/tasks/taskService.test.ts src/main/index.ts
  git commit -m "feat: a round every few minutes and at each session's end moves tasks with nothing to lose to Finished"
  ```

---

### Task 4: Reopen always runs in a worktree, and Continue brings a finished task back

**Files:**
- Modify: `src/main/agents/agent.ts`, `src/main/agents/claude.ts`, `src/main/agents/opencode.ts`, `src/main/tasks/taskService.ts`, `src/main/tasks/openingPrompt.ts`, `src/main/tasks/carryOn.ts`
- Test: `src/main/agents/claude.test.ts`, `src/main/agents/opencode.test.ts`, `src/main/tasks/taskService.test.ts`, `src/main/tasks/openingPrompt.test.ts`

**Interfaces:**
- `TaskReopen` loses `branchExists`. `reopenArgv` always passes `--worktree <slug>`.
- **Before coding:** read <https://code.claude.com/docs/en/worktrees>. Confirm that `--worktree <name> --resume <id>` makes the branch from `origin/<default>` when it is missing. Confirm when it resets an existing worktree with commits. If a reset can happen to a worktree whose branch has commits, stop and report it, as Reopen depends on it.
- `AgentAdapter` gains `chatKept(taskDir: string): boolean`:
  - Claude: true when `readRecordedStart(taskDir)` has an id and either no `transcriptPath`, or a file `<id>.jsonl` in any folder of the projects folder, as `readResumableSession` looks.
  - OpenCode: `() => true`.
- `reopenInWorktree`: with no folder and no branch, it calls `addWorktree(task, true)` instead of running in the project folder.
- `carryOn.ts` gains:
  ```ts
  export const continuePrompt = (branch: string): string =>
    `Mainframe has continued this task in a fresh worktree on branch ${branch}, made from the default branch, which has any of your earlier work that was merged. Wait for my next message.`;
  ```
- `openingPrompt` gains `continuing?: boolean`, which adds the part "This continues an earlier task of the same name. Its conversation is gone; any of its work that was merged is in the default branch."
- `TaskService.continueTask(taskId: string): Promise<TaskView>`:
  - `place` is `'finished'` or `'discarded'`:
    - Clears `place` and `endedAt`.
    - If `chatKept`, resumes with `continuePrompt(task.branch)` (`startedWithPrompt: true`, `resumePending: true`).
    - Otherwise it gives the task a new session id and runs `startLaunch` with `continuing: true`.
  - `place` is `'putBack'`: clears `place`, then `reopen`.
  - Otherwise it throws `Task <title> is on the board; reopen it instead`.

- [ ] **Step 1: Write the failing tests**
  - `claude.test.ts`: `reopenArgv always resumes in the task's worktree`. The argv has `--worktree <slug>` before `--resume`.
  - `claude.test.ts`: `chatKept is false once the transcript is gone, and true without a transcript path`.
  - `taskService.test.ts`:
    - `Continue of a finished Claude task resumes its chat in its worktree with the continue prompt, and puts it on the board`.
    - `Continue of a finished task whose chat is gone starts a new conversation with the continuing opening prompt`.
    - `Continue of a finished OpenCode task adds a fresh worktree from the base`: `addWorktree` is called with `{ create: true }`.
    - `Continue refuses a task on the board`.
    - `Reopen of an OpenCode task whose folder and branch are gone adds a fresh worktree`. This replaces the test that expects the project folder.
  - `openingPrompt.test.ts`: `a continuing prompt says the earlier conversation is gone`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/main/agents src/main/tasks`
  Expected: FAIL.

- [ ] **Step 3: Implement** the changes above. Delete the `branchExists` lookup in `reopen()` along with the parameter, and keep `reopenInWorktree`'s own `branchExists` call.

- [ ] **Step 4: Run the unit tests and the typecheck**

  Run: `npx vitest run && npx tsc --noEmit`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main/agents src/main/tasks
  git commit -m "feat: Continue brings a finished task back in a fresh worktree, and Reopen never runs a task in the main checkout"
  ```

---

### Task 5: Discard

**Files:**
- Modify: `src/main/tasks/taskService.ts`, `src/shared/types.ts`
- Test: `src/main/tasks/taskService.test.ts`

**Interfaces:**
- `export interface DiscardPreview { uncommitted: string[]; unsaved: string[] }` in `src/shared/types.ts`.
- `TaskService.discardPreview(taskId: string): Promise<DiscardPreview>`: `taskGitState`'s two lists.
- `TaskService.discard(taskId: string): Promise<void>`:
  - Throws `Close <title> before discarding it` while a session runs or launches.
  - Otherwise runs `removeWorktree(…, { force: true })`, then `deleteBranch`, sets `place = 'discarded'` and `endedAt`, and commits.
  - A rejected removal throws git's message, and the task stays on the board.
- In `start()`, the card rule finds `other` among tasks whose `place !== 'discarded'`.

- [ ] **Step 1: Write the failing tests**
  - `discardPreview lists the uncommitted files and the unsaved commits`.
  - `discard force-removes the worktree, deletes the branch and moves the task to Discarded`.
  - `discard refuses a running task`.
  - `a card whose task was discarded starts a fresh task`.
  - `a card whose task is finished still refuses Start` (Continue is the way, Task 6).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/main/tasks/taskService.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the two methods and the card rule.

- [ ] **Step 4: Run the unit tests and the typecheck**

  Run: `npx vitest run && npx tsc --noEmit`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main/tasks src/shared/types.ts
  git commit -m "feat: Discard removes a paused task's worktree and branch, and its card can start afresh"
  ```

---

### Task 6: Put back, and to-do items that continue a task

**Files:**
- Modify: `src/main/tasks/taskService.ts`, `src/main/tasks/carryOn.ts`, `src/main/todo/todoService.ts`, `src/main/todo/todoSchema.ts`, `src/shared/types.ts`, `src/main/index.ts`, `src/main/mcp/managerTools.ts`
- Test: `src/main/tasks/taskService.test.ts`, `src/main/todo/todoService.test.ts`, `src/main/mcp/managerTools.test.ts`

**Interfaces:**
- `TodoNote` and `TodoNoteDraft` gain `taskId?: string`. `TODO_NOTE` gains `taskId: z.string().optional()`.
- `carryOn.ts` gains:
  ```ts
  export const putBackPrompt = (i: Instructions): string =>
    `I'm putting this task back on the to-do list for later. Move its card back to the to-do list the way ${i.again} says, or else to its board's to-do list or status. Then stop.`;
  ```
- `TaskService` gains:
  - `putBackCard(taskId: string): Promise<void>`. It reopens the task with `putBackPrompt` in place of the carry-on prompt (the session's `closeWhenTurnEnds = true`). In `noteStatus`, once such a session has been in a turn (`inTurn`) and then reports `done` or `idle`, it calls `close`. The promise resolves when that session exits, however it ended.
  - `markPutBack(taskId: string): void`: sets `place = 'putBack'`, clears the problem, commits.
  - `returnToBoard(taskId: string, problem?: string): void`: clears `place`, sets or clears the problem, commits.
- `TodoServiceDeps.startTask` is replaced by `tasks: Pick<TaskService, 'start' | 'list' | 'continueTask' | 'putBackCard' | 'markPutBack' | 'returnToBoard'>`. `index.ts` passes `service`.
- `TodoService.putBack(taskId: string): Promise<void>`. Only for a Paused task (no session); otherwise it throws `Close <title> before putting it back`.
  - **No card:** `saveNote({ title, text: description, taskId })`, then `markPutBack`.
  - **A card:** `putBackCard`, then `sync()`.
    - The card's id is in the synced cards: `markPutBack`.
    - It isn't, or the sync errs: `returnToBoard(id, 'Put back: the card is not on the to-do list')`.
- `startItem` routing:
  - A note with `taskId`: `continueTask`, then `deleteNote` (without returning its task to the board).
  - A card whose task (any `place` but `'discarded'`) is `'putBack'` or `'finished'`: `continueTask`.
  - Anything else: as today.
- `deleteNote` of a note with `taskId`: `returnToBoard(taskId)`, then delete.
- After a sync saves cards: each put-back task with a card that is no longer among them gets `returnToBoard(id)`.
- The `start_task` description adds: "A card whose task was put back or finished continues that task."

- [ ] **Step 1: Write the failing tests**
  - `taskService.test.ts`:
    - `putBackCard resumes the task with the put-back prompt and closes it once its turn is over`: drive `noteStatus` with working, then done, and assert `killed`. After `onSessionExit` the promise resolves.
    - `a put-back session that asks a question stays open`: blocked, then nothing more; not killed.
    - `markPutBack and returnToBoard move the task and set the problem`.
  - `todoService.test.ts`:
    - `putBack of a note's task adds the note back with the task's id and marks it put back`.
    - `putBack of a card's task marks it put back when the next sync lists the card`.
    - `putBack of a card's task returns it to the board with the problem when the sync doesn't list the card`.
    - `starting a put-back note continues its task and removes the note`.
    - `starting a card whose task is finished continues it; one whose task was discarded starts a new task`.
    - `deleting a put-back note returns its task to the board`.
    - `a sync that drops a put-back task's card returns the task to the board`.
  - `managerTools.test.ts`: `start_task on a put-back card continues its task`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/main/tasks src/main/todo src/main/mcp`
  Expected: FAIL.

- [ ] **Step 3: Implement** the changes above, and update the existing `TodoService` test setup to the new `tasks` dep.

- [ ] **Step 4: Run the unit tests and the typecheck**

  Run: `npx vitest run && npx tsc --noEmit`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main src/shared
  git commit -m "feat: Put back returns a paused task to the to-do list, and its item continues it on its branch"
  ```

---

### Task 7: The board: Paused lane, card buttons, Merged and Finish, and the Discard dialog

Invoke `frontend-design:frontend-design` before writing the UI.

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/renderer/src/tasksStore.ts`, `src/renderer/src/board/lanes.ts`, `src/renderer/src/board/Board.tsx`, `src/renderer/src/board/TaskCard.tsx`, `src/renderer/src/panel/SessionPanel.tsx`, `src/renderer/src/app.css`
- Create: `src/renderer/src/board/DiscardDialog.tsx`
- Test: `src/renderer/src/board/lanes.test.ts`, `e2e/tasks.ts`, `e2e/board.e2e.ts`, and every e2e file that names the `closed` lane (`tasks.e2e.ts`, `todo.e2e.ts`, `terminal.e2e.ts`, `opencode.e2e.ts`, `session-panel.e2e.ts`)

**Interfaces:**
- IPC, as invokes taking `(dir, taskId)`:
  - `discardPreview: 'tasks:discard-preview'` → `DiscardPreview`
  - `discardTask: 'tasks:discard'`
  - `continueTask: 'tasks:continue'` → `TaskView`
  - `putBackTask: 'todo:put-back'`, which calls `todoOf(dir).putBack`
- `tasksStore.ts`:
  - `continueTask(dir, id)` selects first, as `reopenTask` does.
  - `putBackTask(dir, id)` and `discardTask(dir, id)` call the bridge.
- `lanes.ts`: `Lane` is `'needs-you' | 'working' | 'paused'`, and the closed row's label is `Paused`. `laneOrder` leaves out every task with `place !== null`.
- `TaskCard`:
  - **A Paused card** shows Reopen, Put back and Discard.
  - **A card in Needs you with `task.merged`** shows the label `Merged` and a **Finish** button that calls `closeTask`.
  - **`task.problem`** shows as the card's activity line.
- `DiscardDialog` takes the preview and shows:
  - the uncommitted files and the unsaved commits, or "Nothing would be lost." when both are empty;
  - the buttons Cancel and **Discard**.

- [ ] **Step 1: Write the failing tests**
  - `lanes.test.ts`: `laneOrder puts closed tasks in paused and leaves out tasks that are put back, finished or discarded`.
  - In `e2e/tasks.ts`, `cardIn`'s lane type becomes `'needs-you' | 'working' | 'paused'`. Rename the `closed` lane in every e2e file listed above.
  - `board.e2e.ts`: `a closed task whose branch is merged leaves Paused for Finished, its worktree and branch gone`.
    - Start a task with the fake claude.
    - In the test repo, add the worktree `worktree-<slug>` under `.claude/worktrees/<slug>` with one commit, merge it into `stage`, and push it to origin.
    - Close the card, and expect it gone from every lane. `git branch --list worktree-<slug>` is empty, and the folder is gone.
  - `board.e2e.ts`: `Discard asks first, lists what would be lost, and removes the worktree and branch`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/renderer && npm run test:e2e -- e2e/board.e2e.ts`
  Expected: FAIL. (First ask the owner to quit their Mainframe with Cmd+Q: see the memory note on e2e runs.)

- [ ] **Step 3: Implement** the IPC, the store calls, the lanes, the card, the dialog and the panel note, with the copy from Global Constraints.

- [ ] **Step 4: Run all three suites**

  Run: `npx vitest run && npx tsc --noEmit && npm run test:e2e`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src e2e
  git commit -m "feat: the board's Paused lane, with Put back and Discard, and Finish on a merged task"
  ```

---

### Task 8: The Todo panel's Finished tab, and Continue from the list

Invoke `frontend-design:frontend-design` before writing the UI.

**Files:**
- Modify: `src/renderer/src/todo/todoItems.ts`, `src/renderer/src/todo/TodoPanel.tsx`, `src/renderer/src/todo/TicketPanel.tsx`, `src/renderer/src/app.css`, `README.md`
- Create: `src/renderer/src/todo/FinishedList.tsx`
- Test: `src/renderer/src/todo/todoItems.test.ts`, `e2e/todo.e2e.ts`

**Interfaces:**
- `TodoItem['action']` is `{ kind: 'start' } | { kind: 'reopen'; taskId: string } | { kind: 'continue'; taskId: string } | null`. For a card:
  - The task is the card's task whose `place !== 'discarded'`.
  - It is hidden while that task's session runs.
  - The action is `continue` when the task's `place` is `'putBack'` or `'finished'`, `reopen` when the task is Paused on the board, and otherwise `start` (or `null` for a card for the owner).
  - A note with `taskId` has `continue`.
- In `TicketPanel`, the delete button of a note with `taskId` has the title "Delete this todo; its task goes back to Paused on the board".
- `startsFromTicket` stays true for `start` only. Continue in the list and in the ticket calls `startTodoItem`, which routes to `continueTask` in main.
- `export function finishedTasks(tasks: TaskView[], query: string): TaskView[]`, in `todoItems.ts`:
  - Keeps tasks whose `place` is `finished` or `discarded`, newest `endedAt` first.
  - Filters on title or card number, ignoring case and a leading `#`.
- `FinishedList` shows a search box and one row per task: the number, the title, "Finished 11 Nov" or "Discarded 11 Nov", "· no card", and **Continue**, which calls `continueTask` from `tasksStore`.
- `TodoPanel`'s header holds the tabs **To do** and **Finished** (with the count). Quick Add and Sync show on To do only. The open tab is kept per project in `todoPrefs`.
- In `README.md`, the board's lanes say Paused, and new sections say what Finished, Put back and Discard do. Name no project.

- [ ] **Step 1: Write the failing tests**
  - `todoItems.test.ts`:
    - `a card whose task is put back or finished offers continue; one whose task was discarded offers start`.
    - `a put-back note offers continue`.
    - `finishedTasks orders by endedAt and filters on title and number`.
  - `todo.e2e.ts`:
    - `the Finished tab lists a finished task, and Continue brings it back to the board in its worktree`. Seed `state.json` with a finished task and its `session-start.json` before launch. After Continue, the fake claude's argv has `--worktree <slug>` and `--resume`, and the card is in Working.
    - `Put back on a note's task brings its note back, and Start on it continues the task`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/renderer/src/todo && npm run test:e2e -- e2e/todo.e2e.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the items, the list, the tabs and the README.

- [ ] **Step 4: Run all three suites**

  Run: `npx vitest run && npx tsc --noEmit && npm run test:e2e`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src e2e README.md
  git commit -m "feat: the Todo panel's Finished tab, with Continue, and Continue on put-back items"
  ```
