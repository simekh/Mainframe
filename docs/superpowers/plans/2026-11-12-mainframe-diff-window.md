# The diff window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a file in a task's changed-files list opens one diff window above Mainframe's window. It shows a snapshot of every changed file: the file list on the left, every file's changes in one scroll on the right, scrolled to the clicked file.

**Architecture:**
- **Main reads the diff:** `git diff` against the same base as `changedFiles`, plus the untracked files read from disk.
- **The files come from `changedFiles`' own listing,** so the files, statuses and counts match the panel by construction. A pure parser and a pure assembler, with the size limits, turn the patch into `FileDiff[]`.
- **The window:** a child `BrowserWindow` loads the same renderer with `?view=diff`. It pulls its `DiffView` once it loads, and receives new ones over `diff:changed`.

**Tech Stack:** TypeScript 5.9, Electron 44.10.2, SolidJS 1.9, vitest 5, Playwright 1.64. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-12-mainframe-diff-window-design.md`. Mockup: `docs/superpowers/mockups/2026-11-12-diff-window.html` (layout A).

### Decisions the spec leaves to the builder (§10), and the plan's own calls

1. **View routing.** The diff window loads `index.html?view=diff`: `loadFile(…, { query: { view: 'diff' } })`, or `${ELECTRON_RENDERER_URL}?view=diff` in dev.
   - `main.tsx` dynamically imports either `./App` or `./diff/DiffApp`.
   - The imports are dynamic because the stores behind `App` subscribe to main at import time (`tasksStore.ts:64`, `projectsStore.ts:75`, …), and the diff window must not run them.
2. **IPC:** `diff:open`, `diff:get`, `diff:close` and `diff:changed` (Task 5).
3. **Limits (spec §4.3):**
   - **Per file:** 3000 rendered lines (changed and context).
   - **Whole diff:** 15000 rendered lines.
   - **Untracked files:** read only up to 1 MiB; a NUL byte in the first 8000 bytes means binary.
   - **The `git diff` output buffer:** 64 MiB. Past it, the window shows the failed state with "the changes are too large to read (over 64 MB)".
4. **Bounds file:** `diff-window.json` in the data folder, holding `{ version: 1, bounds: {x, y, width, height} }`.
   - A missing, bad or newer file means the default place. It never throws: it is only a window's place.
5. **The parser is written fresh**, not adapted, so it needs no `THIRD_PARTY_NOTICES.md` line. With `--no-renames`, a header's two paths are equal, which gives an exact split (Task 1). Parallel Code's regex can't do that.
6. **A row click keeps the focus,** using `keepFocus` on `mousedown` as the heading does. The diff window takes the focus when it shows.
7. **Esc is handled in the diff page:** a `keydown` calls `closeDiff()`. Playwright's keys reach the page, and main has nothing to match.
8. **Main sets the window's title** and prevents `page-title-updated`, so `index.html`'s `<title>` never replaces it.
9. **Requests are numbered when they arrive.** `openDiff` takes its `seq` before it awaits git. `show()` and the page both drop a view older than the one they have, so the last click wins even when an earlier read finishes later.
10. **Copy the spec doesn't fix:**
    - An empty file reads "Empty file."
    - A removed worktree reads "Worktree removed: there are no changes to show."
    - A failure reads "Mainframe couldn't read the changes: <message>".

## Global Constraints

- **Project-agnostic** (root `CLAUDE.md`). No code, copy or test value names a project, path, branch, language or tool. The diff reads correctly under a friend's git settings: every `git diff` gets `--no-color --no-ext-diff --no-textconv --no-relative --no-renames --src-prefix=a/ --dst-prefix=b/ -U3`, and `-c core.quotePath=false -c diff.autoRefreshIndex=false`. `git()` already adds `--no-optional-locks`.
- **Several projects in one window** (root `CLAUDE.md`). `openDiff` names its project by its folder, and the title names the project and the task. Every task review asks both of the root `CLAUDE.md`'s questions; a no is an Important finding.
- **Exact copy** (spec §4):
  - title `Changes · <task title> · <project name>`
  - "Binary file, not shown."
  - "Too large to show here (N lines changed)." ("Too large to show here." when N is unknown)
  - "Not shown: this task's changes are too large to show at once. Click this file in the session panel to see it."
  - "No line changes (file mode changed)."
  - "No changes"
  - plus Decision 10's copy.
- **The window:**
  - default 1000 × 720, centred over Mainframe's window
  - `parent` set to Mainframe's window, never `alwaysOnTop`, not modal
  - `show: !(e2e && onMac)`, as Mainframe's window has
  - the same `webPreferences` as Mainframe's window: `sandbox`, `contextIsolation`, no `nodeIntegration`, the same preload
  - `window.open` denied and navigation blocked
- **Anti-goals** (spec §2), each a hard rule:
  - the window's files or counts never disagree with the panel's
  - no git index lock is taken
  - the window never keeps Mainframe running after Mainframe's window closes
  - a huge diff never freezes either window
- **No dependency changes** on this branch.
- **UI work uses the `frontend-design` skill** (the owner's global `CLAUDE.md`), within `app.css`'s tokens and fonts. This covers Task 5's view and Task 6's row styling.
- **Dead code:** delete what each change makes dead (listed per task), including imports it leaves unused. Point out, don't remove, dead code found elsewhere.
- **No e2e run while the owner's Mainframe runs.** Each e2e run has its own step before it: `pgrep -fl "Simmesolo/Mainframe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"`, run on its own and read first.
  - If it prints a process, stop and ask the owner to quit Mainframe with Cmd+Q.
  - Never run it in the same batch as the e2e run.
- **Commits:** `type: plain sentence`, lowercase type. Never mention Claude, AI or Anthropic.
- **Commands:**
  - Run them from the worktree: `npm --prefix <worktree> …` and `git -C <worktree> …`, with absolute paths.
  - Never chain `cd` with another command.
  - Run `git add` and `git commit` as separate commands.

## Review Focus

1. **A friend's git settings** (`diff.noprefix`, `diff.mnemonicPrefix`, `color.ui=always`, `diff.context=10`, `core.quotePath`) change nothing in the window. Test: Task 3.
2. **Unusual paths:** paths with a space, a non-ASCII letter, a ` b/` inside, or a tab show as they are, and a click on their row finds them. Tests: Tasks 1 and 3.
3. **A session that edits while the diff is read.** A file the listing has but the patch hasn't, or an untracked file that has gone, shows its heading with a note, and nothing fails. Test: Task 2.
4. **A big task:** a lockfile over the per-file limit, many files past the whole-diff limit, and a clicked file late in path order. The clicked file still shows its lines. Tests: Tasks 2 and 3.
5. **Quick clicks:** two opens in a row, or a click while the window's page still loads. The window ends on the last click. Test: Task 6.

## Before Task 1

1. **The worktree** comes from `main` at or after the plan's commit, so it has the spec, the mockup and this plan.
2. **Package check:** done on 2026-11-12 at the brainstorm. There were no advisories. The owner hasn't approved any updates, and nothing updates on this branch.
3. **Baseline:** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck` pass.

---

### Task 1: The diff types and the patch parser

**Files:**
- Modify: `src/shared/types.ts` (after `ChangedFile`)
- Create: `src/main/diff/parsePatch.ts`
- Test: `src/main/diff/parsePatch.test.ts`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  ```ts
  /** One line of a file's diff: a removed line has no new number, an added one no old number. */
  export interface DiffLine { kind: 'add' | 'remove' | 'context'; text: string; oldLine: number | null; newLine: number | null }
  /** Why a file shows a note in place of its lines. */
  export type DiffNote = 'binary' | 'tooLarge' | 'notShown' | 'noLines' | 'empty';
  export interface FileDiff {
    path: string;
    status: ChangedFile['status'];
    /** The panel's counts; for an untracked text file, its line count and 0. Null where unknown. */
    added: number | null;
    removed: number | null;
    /** Each hunk a run of lines; empty when `note` is set. */
    hunks: DiffLine[][];
    note: DiffNote | null;
  }
  export type DiffResult = { kind: 'files'; files: FileDiff[] } | { kind: 'noWorktree' } | { kind: 'failed'; message: string };
  /** What the diff window shows. `seq` orders the requests: a higher one is a later click. */
  export interface DiffView { seq: number; projectName: string; taskTitle: string; focus: string; result: DiffResult }
  ```
- Produces, in `parsePatch.ts`: `export type PatchBlock = DiffLine[][] | 'binary';` and `export function parsePatch(raw: string): Map<string, PatchBlock>`.

- [ ] **Step 1: Write the failing tests** in `parsePatch.test.ts`. Use helpers `ctx(text, o, n)`, `rem(text, o)` and `add(text, n)`, and build each patch with `[...lines].join('\n') + '\n'`. Tests:
  - `'parses a modified file with two hunks, numbering old and new lines'`. A patch for `f.txt` with `@@ -1,3 +1,3 @@` (` one`, `-two`, `+TWO`, ` three`) and `@@ -10,2 +10,3 @@ ctx` (` ten`, `+ten-and-a-half`, ` eleven`) gives `new Map([['f.txt', [[ctx('one',1,1), rem('two',2), add('TWO',2), ctx('three',3,3)], [ctx('ten',10,10), add('ten-and-a-half',11), ctx('eleven',11,12)]]]])`.
  - `'parses added and deleted files'`. Both blocks come in one patch: a `new file mode 100644` block (`--- /dev/null`, `@@ -0,0 +1,2 @@`, `+a`, `+b`) gives `[[add('a',1), add('b',2)]]`. A `deleted file mode` block (`+++ /dev/null`, `@@ -1 +0,0 @@`, `-gone`) gives `[[rem('gone',1)]]`.
  - `'marks a binary file'`. A block with `Binary files a/b.bin and b/b.bin differ` gives `'binary'` for `b.bin`.
  - `'keeps a mode-only change with no hunks'`. A block with only `old mode 100644` and `new mode 100755` gives `[]`.
  - `'skips the no-newline marker and strips CR'`. Lines `-x\r`, `\ No newline at end of file`, `+y` give `[[rem('x',1), add('y',1)]]`.
  - `'reads paths with spaces, a " b/" inside, and quoted ones'`. Headers:
    - `diff --git a/a b.txt b/a b.txt` gives `a b.txt`.
    - `diff --git a/x b/y.txt b/x b/y.txt` gives `x b/y.txt`.
    - `diff --git "a/t\tab.txt" "b/t\tab.txt"`, with a literal backslash-t, gives `t<TAB>ab.txt`.
    - `diff --git "a/\303\266.txt" "b/\303\266.txt"` gives `ö.txt`.
  - `'merges two blocks of one path'`. A type change prints a delete block and an add block for the same path, and the result has both blocks' hunks in order.
  - `'is empty for an empty patch'`. `parsePatch('')` gives an empty Map.
- [ ] **Step 2: Run them to see them fail.** Run `npm --prefix <worktree> test -- src/main/diff/parsePatch.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `parsePatch(raw: string): Map<string, PatchBlock>`.**
  - Split `raw` on `\n`.
  - A line that starts `diff --git ` opens a block for `headerPath(line)`.
  - Before a block's first `@@`, a line that starts `Binary files ` makes the block `'binary'`, and every other line is skipped.
  - `@@ -o[,c] +n[,d] @@…` opens a hunk, numbered from `o` and `n`.
  - Inside a hunk, the first character decides the line: ` ` is context (old and new both advance), `-` is a removal (old advances), `+` is an addition (new advances), `\` is skipped. The text is `line.slice(1)` with a trailing `\r` removed.
  - A second block for a path already in the map appends its hunks. `'binary'` wins over hunks.
  - `headerPath` works on `rest` (the line after `diff --git `):
    - **Quoted** (`rest[0] === '"'`): read the second quoted string. Decode its C escapes (`\a \b \t \n \v \f \r \" \\` and three-digit octal) into bytes, with other characters as their UTF-8 bytes, and turn the bytes into text with `TextDecoder`. Drop the leading `b/`.
    - **Unquoted:** `rest` is `'a/' + P + ' b/' + P`, so `P = rest.slice(2, 2 + (rest.length - 5) / 2)`.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**
  - Run `git -C <worktree> add src/shared/types.ts src/main/diff/parsePatch.ts src/main/diff/parsePatch.test.ts`.
  - Then run `git -C <worktree> commit -m "feat: the diff window's types, and a parser for git's patch output that keeps paths with spaces and quoted paths whole"`.

### Task 2: Joining the listing, the patch and the untracked files, within the limits

**Files:**
- Create: `src/main/diff/assembleDiff.ts`
- Test: `src/main/diff/assembleDiff.test.ts`

**Interfaces:**
- Consumes: `PatchBlock` (Task 1), `ChangedFile`, `FileDiff` and `DiffLine` (`src/shared/types.ts`).
- Produces:
  ```ts
  export type UntrackedContent = { kind: 'text'; lines: string[] } | { kind: 'binary' } | { kind: 'tooLarge' };
  export interface DiffLimits { fileLines: number; totalLines: number }
  export const DIFF_LIMITS: DiffLimits = { fileLines: 3000, totalLines: 15000 };
  export function assembleDiff(
    listed: ChangedFile[], blocks: Map<string, PatchBlock>, untracked: Map<string, UntrackedContent>,
    focus: string, limits: DiffLimits = DIFF_LIMITS,
  ): FileDiff[];
  ```

- [ ] **Step 1: Write the failing tests.** Build `listed` with a helper `file(path, status, added, removed)`, and use small `limits` where the test is about them.
  - `'gives each listed file its patch, in the listing's order'`. M `b.txt` and A `a.txt`, listed `[b, a]` with blocks for both, give `files.map(f => f.path)` equal to `['b.txt', 'a.txt']`. Each file keeps its listing's status and counts, has its block as `hunks`, and has `note: null`.
  - `'notes binary, mode-only, empty and missing files'`:
    - a `'binary'` block gives `note: 'binary'` and `hunks: []`
    - M with block `[]` gives `'noLines'`
    - A with `added: 0, removed: 0` and block `[]` gives `'empty'`
    - an M file with no block gives `'noLines'`, because it changed after the listing
  - `'shows untracked text files as added, and notes the rest'`:
    - `'?'` with `{ kind: 'text', lines: ['u1','u2'] }` gives `added: 2, removed: 0, hunks: [[add('u1',1), add('u2',2)]], note: null`
    - with `lines: []` it gives `'empty'` and `added: 0`
    - `binary` gives `'binary'`
    - `tooLarge` gives `'tooLarge'` with `added: null`
    - no entry (the file went away) gives `'noLines'`
  - `'marks a file over the per-file limit too large, keeping its counts'`. With `{ fileLines: 3, totalLines: 100 }`, a 4-line block gives `note: 'tooLarge', hunks: []`, and `added` and `removed` stay as listed.
  - `'serves the clicked file first, then path order, until the whole-diff limit'`:
    - Limits `{ fileLines: 5, totalLines: 6 }`.
    - Files `a` (3 lines), `b` (3) and `c` (1), with focus `c`.
    - `a` and `c` show their lines, and `b` is `'notShown'`.
  - `'once a file misses the whole-diff limit, every later file is not shown'`:
    - Limits `{ fileLines: 5, totalLines: 6 }`.
    - Files `a` (2), `b` (5) and `c` (1), with focus `a`.
    - `b` and `c` are both `'notShown'`.
  - `'files with notes cost nothing against the limit'`. A binary file between two shown files changes nothing.
- [ ] **Step 2: Run them to see them fail.** Run `npm --prefix <worktree> test -- src/main/diff/assembleDiff.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `assembleDiff`.**
  - Build each listed file as the tests say.
  - Then apply the limits:
    - First, every file whose lines (`hunks.flat().length`) are over `fileLines` gets `tooLarge`.
    - Then walk `[focus, ...the rest in listed order]`, adding each shown file's lines to a running total.
    - The first file that would take the total past `totalLines`, and every file after it in that walk, gets `notShown` and `hunks: []`.
  - Return the files in listed order.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**
  - Run `git -C <worktree> add src/main/diff/assembleDiff.ts src/main/diff/assembleDiff.test.ts`.
  - Then run `git -C <worktree> commit -m "feat: the diff window's files come from the changed-files listing, with notes for what can't be shown, and the clicked file is served first within the limits"`.

### Task 3: Reading a task's diff from git

**Files:**
- Modify: `src/main/git.ts` (`git()`, `changedFiles`, `gitQueries`)
- Modify: `src/main/tasks/taskService.ts` (next to `changedFiles`, about line 257)
- Test: `src/main/git.test.ts`, `src/main/tasks/taskService.test.ts` (its `setup()` fake gains `taskDiff: async () => []`)

**Interfaces:**
- Consumes: `parsePatch` (Task 1), and `assembleDiff`, `UntrackedContent` and `DIFF_LIMITS` (Task 2).
- Produces:
  - `export async function taskDiff(worktreePath: string, focus: string): Promise<FileDiff[] | null>`. It is null when the folder is not a work tree's top, as `changedFiles` is, and it throws when git fails after that.
  - `gitQueries.taskDiff`.
  - `TaskService.diff(taskId: string, focus: string): Promise<{ taskTitle: string; result: DiffResult }>`, which throws `Unknown task <id>` for a task that isn't the project's.

- [ ] **Step 1: Write the failing tests** in `git.test.ts`. Use its `repo()`, `git()` and `commitFile()`, and a worktree at `.claude/worktrees/x` on `origin/stage`, as the `changedFiles` tests do. Tests:
  - `'taskDiff shows committed, uncommitted and untracked changes, matching changedFiles'`:
    - Changes: commit `a.txt` (`a\n`), write `README.md` as `bye\n`, write untracked `u.txt` as `u1\nu2\n`.
    - `README.md` (M 1/1) has `[[rem('hi',1), add('bye',1)]]`.
    - `a.txt` (A 1/0) has `[[add('a',1)]]`.
    - `u.txt` (`'?'`, 2/0) has `[[add('u1',1), add('u2',2)]]`.
    - `taskDiff`'s files, mapped to `{ path, status, added, removed }`, equal `await changedFiles(wt)`. The exception is the `'?'` file, which is compared on `path` and `status` only, since the window counts its lines and the panel doesn't.
  - `'taskDiff notes binary, empty and mode-only files'`:
    - a committed `b.bin` (bytes `62 00 01 ff`) gives `'binary'`
    - a committed empty `e.txt` gives `'empty'`
    - an untracked binary gives `'binary'`
    - and, under `it.skipIf(process.platform === 'win32')`, `chmod 755 README.md` gives `'noLines'`
  - `'taskDiff keeps paths with spaces and non-ASCII letters'`. Committed `a b.txt` and `ö.txt` come back with exactly those paths.
  - `"taskDiff ignores the user's diff settings"`:
    - In the worktree, `git config` sets `diff.noprefix true`, `diff.mnemonicPrefix true`, `color.ui always`, `diff.context 10` and `core.quotePath true`.
    - Commit `ten.txt` as lines `1`…`10` on the base first, then change line `5` in the worktree.
    - The result is one hunk of 8 lines, whose first line is `ctx('2', 2, 2)`.
    - `ö.txt` keeps its path.
  - `'taskDiff marks untracked files over the limits too large'`:
    - An untracked file of 3001 lines gives `'tooLarge'` with `added: 3001`.
    - A file of 1.1 MB on a single line gives `'tooLarge'` with `added: null`.
  - `'taskDiff is null for a folder that is not a work tree'`. A missing folder gives null.
- [ ] **Step 2: Write the failing tests** in `taskService.test.ts`:
  - `"diff asks git for the task's worktree and the clicked file"`. It records `(dir, focus)` and returns `{ taskTitle: view.title, result: { kind: 'files', files } }`.
  - `'diff says the worktree is gone when git finds none'`. Null gives `{ kind: 'noWorktree' }`.
  - `"diff passes on git's failure as its message"`. A rejection with `new Error('boom')` gives `{ kind: 'failed', message: 'boom' }`.
  - `'diff rejects an unknown task'`. `service.diff('nope', 'a')` rejects with `/Unknown task/`.
- [ ] **Step 3: Run them to see them fail.** Run `npm --prefix <worktree> test -- src/main/git.test.ts src/main/tasks/taskService.test.ts`. Expected: FAIL, because `taskDiff` and `diff` are missing.
- [ ] **Step 4: Implement.**
  - `git(dir, args, opts: { maxBuffer?: number } = {})`, with 16 MiB still the default.
  - Split `changedFiles` into internal `isWorktreeTop(path)`, `diffBase(path)` and `listChanges(path, base)`. `changedFiles` composes them, and its behaviour and tests are unchanged.
  - `taskDiff`:
    - Checks the top, as `changedFiles` does, and is null when it isn't one.
    - Takes the base once.
    - Runs `listChanges` and `git diff` with the flags in Global Constraints, `-- ` and a 64 MiB buffer. An `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` becomes `new Error('the changes are too large to read (over 64 MB)')`.
    - Reads each `'?'` file with an internal `readUntracked(worktreePath, path): Promise<UntrackedContent | undefined>`. That function `lstat`s the file:
      - a file that is gone, or not a regular file, gives undefined
      - over 1 MiB gives `tooLarge`
      - a NUL byte in the first 8000 bytes gives `binary`
      - otherwise, the UTF-8 text split on `\n`, with the final empty string dropped and each `\r` at a line's end stripped
    - Returns `assembleDiff(listed, parsePatch(patch), untracked, focus)`.
  - `TaskService.diff`: `this.find(taskId)` gives the title and the worktree. Null becomes `noWorktree`, and a throw becomes `failed`, with `err instanceof Error ? err.message : String(err)`.
- [ ] **Step 5: Run them to see them pass.** Same command, then `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.**
  - Run `git -C <worktree> add src/main/git.ts src/main/git.test.ts src/main/tasks/taskService.ts src/main/tasks/taskService.test.ts`.
  - Then run `git -C <worktree> commit -m "feat: a task's diff from git, against the same base and listing as its changed files, unaffected by the user's diff settings"`.

### Task 4: The window's place, title and copy menu

**Files:**
- Create: `src/main/diff/diffWindowState.ts`
- Modify: `src/main/contextMenu.ts`
- Test: `src/main/diff/diffWindowState.test.ts`, `src/main/contextMenu.test.ts`

**Interfaces:**
- Produces (no `electron` import in either file):
  ```ts
  export interface Rect { x: number; y: number; width: number; height: number }
  export const DIFF_WINDOW_SIZE = { width: 1000, height: 720 };
  export function restoreBounds(saved: Rect | null, workAreas: Rect[], parent: Rect): Rect;
  export function readDiffWindowBounds(dataDir: string, warn: (msg: string) => void): Rect | null;
  export function writeDiffWindowBounds(dataDir: string, bounds: Rect): void;
  export function diffWindowTitle(view: { taskTitle: string; projectName: string }): string;
  // contextMenu.ts
  export function copyMenuItems(params: { selectionText: string }): MenuItemConstructorOptions[] | null;
  ```

- [ ] **Step 1: Write the failing tests.**
  - `'restoreBounds keeps saved bounds that show on a display'`. Saved `{x:100,y:100,width:900,height:600}` with work area `{x:0,y:0,width:1920,height:1080}` gives the saved bounds.
  - `'restoreBounds centres the default size over the parent when saved bounds are off every display'`:
    - Saved `{x:5000,y:0,…}`, or `null`.
    - Parent `{x:100,y:50,width:1400,height:900}`.
    - The result is `{x:300,y:140,width:1000,height:720}`.
  - `'restoreBounds needs 100 by 40 px on a display'`:
    - An overlap of 99 px wide is dropped, and 100 is kept.
    - An overlap of 39 px tall is dropped, and 40 is kept.
  - `'the bounds file round-trips, and a missing, bad or newer one is null'`:
    - write, then read, gives the same `Rect`
    - no file gives null, with no warning
    - `{"version":1,"bounds":{"x":"a"}}` gives null and one warning
    - `{"version":2,…}` gives null
  - `'diffWindowTitle names the task and the project'`. `{ taskTitle: 'Fix login', projectName: 'shop' }` gives `'Changes · Fix login · shop'`.
  - `'copyMenuItems offers Copy only with a selection'`. `''` gives null, and `'x'` gives `[{ role: 'copy' }]`.
- [ ] **Step 2: Run them to see them fail.** Run `npm --prefix <worktree> test -- src/main/diff/diffWindowState.test.ts src/main/contextMenu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Bounds are written with `writeJsonAtomic` (from `src/main/tasks/taskStore`) to `diff-window.json`. A file is valid when its `version` is 1 and its four numbers are finite, with `width > 0` and `height > 0`.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**
  - Run `git -C <worktree> add src/main/diff/diffWindowState.ts src/main/diff/diffWindowState.test.ts src/main/contextMenu.ts src/main/contextMenu.test.ts`.
  - Then run `git -C <worktree> commit -m "feat: where the diff window opens, its title, and a Copy menu for selected text"`.

### Task 5: The diff window's page

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`
- Create: `src/renderer/src/diff/diffText.ts` (+ `diffText.test.ts`), `src/renderer/src/diff/LineCounts.tsx`, `src/renderer/src/diff/DiffApp.tsx`, `src/renderer/src/diff/DiffFile.tsx`, `src/renderer/src/diff/diff.css`
- Modify: `src/renderer/src/panel/ChangedFiles.tsx`. Its `letter` and `Diff` move out (Interfaces below), and both local copies are deleted.

**Interfaces:**
- Consumes: `DiffView`, `DiffResult` and `FileDiff` (Task 1).
- Produces:
  - `IPC.openDiff = 'diff:open'`, `IPC.getDiff = 'diff:get'`, `IPC.closeDiff = 'diff:close'` and `IPC.diffChanged = 'diff:changed'`.
  - On `MainframeApi`, with matching preload lines:
    ```ts
    /** Opens the diff window on the task's changes, scrolled to `path`; reads them afresh each time. */
    openDiff(dir: string, taskId: string, path: string): Promise<void>;
    /** The diff window's current view; null before the first open. */
    getDiff(): Promise<DiffView | null>;
    onDiff(cb: (view: DiffView) => void): () => void;
    closeDiff(): void;
    ```
  - In `diffText.ts`: `statusLetter(status: ChangedFile['status']): string` (`'?'` gives `'U'`), `noteText(file: FileDiff): string | null`, and `resultMessage(result: DiffResult): string | null`. The last is null for a non-empty `files`.
  - `LineCounts` (props `added` and `removed`): the `Diff` component moved from `ChangedFiles.tsx` as it is.
  - Test ids, for Task 6:
    - `diff-list-row` on each list button, with `data-path`, and `aria-current="true"` on the selected one
    - `diff-file` on each section, with `data-path`
    - `.diff-line[data-kind]` on each line
    - `diff-note` on a note
    - `diff-message` on the empty and failed message

- [ ] **Step 1: Write the failing tests** in `diffText.test.ts`:
  - `noteText` gives each copy in Global Constraints and Decision 10:
    - `tooLarge` with `added: 3000, removed: 12` gives `'Too large to show here (3012 lines changed).'`
    - with `added: null` it gives `'Too large to show here.'`
    - `note: null` gives null
  - `resultMessage` gives:
    - `'No changes'` for `files: []`
    - the worktree copy for `noWorktree`
    - `"Mainframe couldn't read the changes: boom"` for `failed`
    - null for one file
  - `statusLetter('?')` gives `'U'`, and `statusLetter('M')` gives `'M'`.
- [ ] **Step 2: Run them to see them fail.** Run `npm --prefix <worktree> test -- src/renderer/src/diff/diffText.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `diffText.ts`,** and run the same command. Expected: PASS.
- [ ] **Step 4: Build the page.** Invoke the `frontend-design` skill first; the mockup's layout A is the target.
  - **`main.tsx`:** `?view=diff` renders `./diff/DiffApp`, and anything else renders `./App`, both through `import()` (Decision 1). `data-platform` is still set first.
  - **`DiffApp`:**
    - It imports Inter 400 and 500, JetBrains Mono 400, `../app.css` and `./diff.css`.
    - On mount, it subscribes with `onDiff(apply)` first, then calls `getDiff()` and applies what that returns.
    - `apply` drops a view whose `seq` is not above the current one. Otherwise it sets the view, selects `view.focus`, and on the next animation frame scrolls the focus's section to the top (`scrollIntoView({ block: 'start' })`, found with `CSS.escape` on `data-path`).
    - A `keydown` of `Escape` with no modifier calls `closeDiff()`.
    - A list row's click selects the row and scrolls to its section.
    - When `resultMessage` isn't null, it shows that message centred, in place of the two columns.
  - **`DiffFile`:**
    - The heading: the path, and `LineCounts`.
    - The hunks, with a thin separator row between them.
    - Each line: the old-number gutter, the new-number gutter, the `+`/`−`/space marker, and the code.
    - A note's `<p>` in place of the lines when `noteText` isn't null.
  - **`diff.css`:**
    - Two columns, the list about 260 px wide, and each column scrolls on its own. The page sits under `body { overflow: hidden }`.
    - The list's rows look like `.file-list`'s: the status colours, and paths cut from the start.
    - Long lines scroll sideways inside their file and don't wrap.
    - The gutters and the marker have `user-select: none`, and the code and paths have `user-select: text`, so copying takes only the code (spec §4.2).
    - Added and removed lines take `--success` and `--error` tints, the code is in `--font-mono`, and the theme is dark only.
  - **`ChangedFiles.tsx`:** use `statusLetter` and `LineCounts`. It renders as before.
- [ ] **Step 5: Verify.** Run `npm --prefix <worktree> run typecheck` and `npm --prefix <worktree> test`. Expected: PASS. The page is first exercised in Task 6's e2e.
- [ ] **Step 6: Commit.**
  - Run `git -C <worktree> add src/shared/ipc.ts src/preload/index.ts src/renderer/src/main.tsx src/renderer/src/diff src/renderer/src/panel/ChangedFiles.tsx`.
  - Then run `git -C <worktree> commit -m "feat: the diff window's page: the changed files on the left and every file's changes in one scroll, at the clicked file"`.

### Task 6: Opening the window from the changed-files list

**Files:**
- Create: `src/main/diff/diffWindow.ts`
- Modify: `src/main/ipc.ts` (`registerIpc` gains a `diff` parameter), `src/main/index.ts`
- Modify: `src/renderer/src/panel/ChangedFiles.tsx` (rows become buttons), `src/renderer/src/app.css` (`.file-list .file-row`)
- Modify: `e2e/launch.ts:96`, `e2e/app.e2e.ts:33`. Both take Mainframe's window as `BrowserWindow.getAllWindows().find((w) => w.getParentWindow() === null)!`.
- Test: create `e2e/diff.e2e.ts`

**Interfaces:**
- Consumes: Tasks 3 to 5.
- Produces:
  - in `ipc.ts`: `export interface DiffWindowControl { nextSeq(): number; show(view: DiffView): void; current(): DiffView | null; close(): void }`
  - in `diffWindow.ts`: `export class DiffWindow implements DiffWindowControl`, built with `{ parent: BrowserWindow; dataDir: string; hidden: boolean; prepare: (win: BrowserWindow) => void; warn: (msg: string) => void }`

- [ ] **Step 1: Write the failing e2e tests** in `e2e/diff.e2e.ts`. Use `repo`, `git`, `startTask` and `launchApp`, as `session-panel.e2e.ts` does.
  - **Setup for the tests below:** worktree `fix-login` on `origin/stage`. In it, commit `a.txt` with 200 lines (`line 1` … `line 200`), and write an untracked `b.txt` holding `b\n`. Wait for 2 `changed-file` rows.
  - `"clicking a changed file opens the diff window above Mainframe's, titled for the task and project, at that file"`:
    - `const opened = app.waitForEvent('window')`, click row 1 (`b.txt`), then `const diff = await opened`.
    - There are 2 `diff-file` sections, and `a.txt`'s has 200 `.diff-line[data-kind=add]`.
    - The `diff-list-row[data-path="b.txt"]` has `aria-current="true"`, and `b.txt`'s section is in the viewport.
    - `app.evaluate` over `getAllWindows()` finds one window titled `` `Changes · Fix login · ${basename(main)}` ``, whose `getParentWindow()` is Mainframe's window.
  - `'a second click reuses the window, reads the changes again, and loads another task into it'`:
    - Write an untracked `c.txt` after the first open, then click row 1 again. `app.windows()` still has 2 windows, and there are 3 `diff-file` sections.
    - Start a second task, `Other`, with worktree `other` holding an untracked `o.txt`. Select its card (`card(page, id).click()`) and click its one row.
    - Still 2 windows; the title is `` `Changes · Other · ${basename(main)}` ``, and there is 1 `diff-file`, `o.txt`.
  - `'two quick opens end on the later one'`:
    - Call `page.evaluate` for `openDiff(dir, id, 'a.txt')` without awaiting it, then await `openDiff(dir, id, 'b.txt')`.
    - Get the task's id with `ids(page)`.
    - The `b.txt` row ends up `aria-current`.
  - `'Esc closes the diff window, and a click opens it again'`. `diff.keyboard.press('Escape')`, then `diff.waitForEvent('close')`, leaves 1 window. The next click opens a new window.
  - `'the diff window opens at the size it was left'`:
    - `app.evaluate` sets the diff window's size to 900 × 600.
    - Esc closes it, and `diff-window.json` in `dataDir` exists.
    - Reopened, its `getSize()` is `[900, 600]`.
  - `"closing Mainframe's window with the diff window open ends the app"`. `app.evaluate` closes the window without a parent, and `app.waitForEvent('close')` resolves.
- [ ] **Step 2: Run them to see them fail.** First the `pgrep` step (Global Constraints), on its own. Then run `npm --prefix <worktree> run test:e2e -- e2e/diff.e2e.ts`. Expected: FAIL, because no window opens.
- [ ] **Step 3: Implement `DiffWindow`.**
  - **`nextSeq()`** counts up from 1.
  - **`show(view)`:**
    - It drops a view whose `seq` is below the latest's. Otherwise it keeps the view as the latest.
    - **With no window,** it creates one:
      - the size and place come from `restoreBounds(readDiffWindowBounds(dataDir, warn), screen.getAllDisplays().map((d) => d.workArea), parent.getBounds())`
      - it sets `parent`, `title: diffWindowTitle(view)`, `show: !hidden`, `enableLargerThanScreen: hidden`, `backgroundColor: '#080c10'`, `minWidth: 480`, `minHeight: 320`, and Mainframe's `webPreferences`
      - it prevents `page-title-updated`
      - on `close`, it saves `getNormalBounds()`
      - on `closed`, it forgets the window
      - it calls `prepare(win)`
    - **With a window,** it calls `setTitle`, sends `IPC.diffChanged` with the view, and, unless hidden, restores the window if minimised and focuses it.
  - **`current()`** returns the latest view, and **`close()`** closes the window if there is one.
- [ ] **Step 4: Wire it.**
  - **`index.ts`:**
    - Move `createWindow`'s `window.open`, `will-navigate`, DevTools-key and context-menu setup into `prepareWebContents(win, menuItems)`, and its load into `loadPage(win, view?: 'diff')`. Mainframe's window passes `editMenuItems`.
    - In `start()`, build the window with `new DiffWindow({ parent: win, dataDir: config.dataDir, hidden: config.e2e && onMac, prepare: (w) => { prepareWebContents(w, copyMenuItems); loadPage(w, 'diff'); }, warn: console.warn })`.
    - Add `win.on('close', () => diffWindow.close())`, and pass the window to `registerIpc`.
  - **`ipc.ts`:**
    - `openDiff`: `const seq = diff.nextSeq()`, then `await tasksOf(dir).diff(taskId, path)`, then `diff.show({ seq, projectName: basename(dir), taskTitle, focus: path, result })`.
    - `getDiff` returns `diff.current()`, and `closeDiff` (`ipcMain.on`) calls `diff.close()`.
  - **`ChangedFiles.tsx`:**
    - Each `<li>` keeps its test id and `data-status`, and holds a `<button class="file-row">` with the `.st`, `.path` and counts.
    - The button has `onMouseDown={keepFocus}`, and its click calls `window.mainframe.openDiff(project.dir, taskId, path)`. A failure goes to `console.warn('[diff] …')`.
  - **`app.css`:** `.file-row` is laid out as `.file-list li` was (flex, gap 10 px, full width, left-aligned), and its path turns `--fg` on hover.
- [ ] **Step 5: Run them to see them pass.**
  - Run the `pgrep` step on its own.
  - Then run `npm --prefix <worktree> run test:e2e`, the whole suite, since the helpers and `ChangedFiles` changed.
  - Then run `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`.
  - Expected: all PASS.
- [ ] **Step 6: Commit.**
  - Run `git -C <worktree> add src/main/diff/diffWindow.ts src/main/ipc.ts src/main/index.ts src/renderer/src/panel/ChangedFiles.tsx src/renderer/src/app.css e2e/launch.ts e2e/app.e2e.ts e2e/diff.e2e.ts`.
  - Then run `git -C <worktree> commit -m "feat: clicking a changed file opens the diff window above Mainframe's, one window reused for every task, closed with Esc and with Mainframe's window"`.

---

## Finish (root `CLAUDE.md`)

After Task 6, follow "When `/simplify` and `/code-review high` run" in the root `CLAUDE.md`, in its order:
1. **`/simplify`** on `main...HEAD`. Check its edits, run the three suites (e2e after its own `pgrep` step), commit, and record the tip.
2. **The final whole-branch review.** It asks the two Mainframe questions and judges proportion.
3. **`/code-review high`** on `main...HEAD`. Fix its findings, run the three suites, commit, and record the tip in both files.
4. **The owner's acceptance, on the Mac:**
   - The window opens above Mainframe and moves with it.
   - It resizes, and comes back where it was left after a restart.
   - Esc and the close button close it.
   - Quit with it open works.
   - Two projects side by side load into the one window.
   - A large real task (a lockfile change) stays responsive.
5. **Windows and Linux:** the CI run of the reviewed push.
6. **Then:** acceptance fixes count as new work, as the root `CLAUDE.md` says. After them comes `superpowers:finishing-a-development-branch`.

**Dead code found elsewhere:** none in the files read for this plan.
