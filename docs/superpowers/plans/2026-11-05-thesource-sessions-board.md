# TheSource sessions on the board (plan 2a): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner starts a task from a title and a description. TheSource launches `claude -w` for it in the project's main checkout, shows it on a board with Needs you, Working and Closed lanes, and shows the selected session in a full-height panel. The panel's width can be dragged and the panel can be pinned or unpinned. It holds the task's header, changed files, terminal and message field. Ctrl+Tab jumps to the next session that needs the owner. Close keeps the work; Reopen continues the same chat; quitting and restarting reopens every task that was running.

**Architecture:** Plan 1's main process (PTYs, OSC 7501, clipboard) stays. A `TaskService` in main replaces the feel test's `SessionRegistry`. It keeps task records in `<dataDir>/state.json`, builds each launch command, and writes a per-task `--settings` file whose only hook is a SessionStart hook. That hook records the session's current id for Reopen. Lanes are worked out in the renderer from OSC 7501 status (findings §11.3, §7 of its consequences). Git queries run with `execFile` in main.

**Tech Stack:** unchanged from plan 1: Electron 44, electron-vite 6, SolidJS 1.9, TypeScript 5.9, xterm.js 6.1 beta, node-pty 1.1, Vitest 5, Playwright 1.64. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-thesource-agent-manager-design.md`. Read §2, §7.1–§7.4, §7.7 and §10 step 1 first, including the 2026-11-05 notes in them. Also read the step 1 findings `docs/superpowers/findings/2026-11-05-step1-checks.md` ("Consequences for plan 2") and `docs/feel-test.md` ("Owner's notes for plan 2").

**Design:** the mockup the owner approved on 2026-11-05, `docs/superpowers/mockups/2026-11-05-plan-2a-board.html`. Open it in a browser: its script plays every state, the card moves and the panel modes. It is Parallel Code's board at `97c3558`, from `src/components/task-board.css`, `src/components/board/TaskStatus.tsx`, `src/components/StatusDot.tsx` and the `parallel-code` look in `src/styles.css`. Tasks 5–9 build to it. Where the mockup and a task's text differ, the task's text wins; report the difference.

**Scope.** This is spec §10 step 1 without Trello. The TODO lane, card details, Start, Start next card and moving cards to In Progress are plan 2b; there, a Trello card becomes one more way to fill the same start request. Merge turn, Ready to merge and Merged lanes, MCP tools and the manager are later steps.

## Global Constraints

- `<root>` = `/Users/simonekholm/Developer/Simmesolo/TheSource`; `<damela>` = `/Users/simonekholm/Developer/Simmesolo/Damela`; `<pc>` = a clone of https://github.com/johannesjo/parallel-code at `97c3558` in the session scratchpad, never committed (`git clone https://github.com/johannesjo/parallel-code.git <pc>`, `git -C <pc> checkout 97c3558`).
- Work on the branch `sessions-board` (it exists; this plan is committed on it).
- Every command passes absolute paths (`npm --prefix <root> …`, `git -C <dir> …`); never `cd x && …` (owner's global CLAUDE.md).
- Pinned versions and the build setup from plan 1 stay as they are. No new npm dependencies.
- **Launch forms** (findings, consequences 1 and 4), always with cwd = the project's main checkout and never through a shell:
  - start: `claude -w <slug> -n <project>-<slug> --session-id <uuid> --settings <settings file> "<opening prompt>"`
  - reopen while branch `worktree-<slug>` exists: `claude --worktree <slug> --resume <uuid> --settings <settings file>`
  - reopen once that branch is gone: `claude --resume <uuid> --settings <settings file>`
  - No `--permission-mode`, no `--mcp-config` (spec §7.2, 2026-11-05 notes).
- **Close and quit end a session with SIGHUP** (node-pty's default `kill()`), which Claude Code treats like a terminal closing: no keep/remove question, worktree and branch kept (findings §11.4 row d). The app never removes a worktree or a branch.
- The app never edits the owner's or a repo's settings files. Its own files live in `<dataDir>`: `state.json` and `tasks/<taskId>/{settings.json,session-start.json}`.
- `<dataDir>` is Electron's `userData` (`~/Library/Application Support/thesource`), or `THESOURCE_DATA_DIR` when set. The app calls `app.setPath('userData', dataDir)` before `ready`, so Chromium's storage (the panel's `localStorage`) lives there too and e2e runs never touch the owner's.
- Session state comes only from OSC 7501, never from regexes on terminal output (spec §2, §6.2).
- Main runs git as `execFile('git', ['--no-optional-locks', '-C', <absolute dir>, …])`, and diffs with `-c diff.autoRefreshIndex=false`, so the app never takes the index lock while a session runs git.
- Code adapted from Parallel Code starts with `// Adapted from Parallel Code (MIT): <path> at 97c3558. See THIRD_PARTY_NOTICES.md.`, and `THIRD_PARTY_NOTICES.md` lists the file.
- UI work invokes the `frontend-design:frontend-design` skill (owner's global CLAUDE.md). The look stays Parallel Code's: the CSS variables at the top of `src/renderer/src/app.css`, Inter for the interface, Sora for titles, JetBrains Mono for code and paths. Sizes, spacing, glyphs and motion come from the mockup (see **Design**); add any variable it uses that `app.css` lacks (`--bg-elevated`, `--bg-input`, `--border-focus`, `--success`, `--radius-*`) with the mockup's value.
- Motion respects `prefers-reduced-motion: reduce`: nothing slides or spins then, and colour changes stay.
- Keyboard: Option and Cmd+C/V stay as plan 1 set them (Swedish layout, Edit menu). Never bind Cmd+R or Cmd+W.
- Commit messages carry no AI attribution of any kind (owner's global CLAUDE.md).

## Review Focus

1. **Quitting (Cmd+Q) or the app crashing with tasks running.** The owner expects every running task back at the next start. The SIGHUPs that quitting sends must not mark tasks closed. Pinned by the `beginQuit` unit test in Task 4 and the restart e2e test in Task 5.
2. **Titles with å/ä/ö, emoji, slashes or only punctuation, very long titles, and a title matching an existing task, worktree branch or leftover worktree folder** (from iTerm2 work). Each must give a unique slug that git and `claude -w` accept. Pinned by the `slugify`/`uniqueSlug` tests in Task 1 and the taken-names test in Task 4.
3. **Terminals started while nothing is on screen**: tasks reopened at startup with no selection, or a session started while the unpinned panel is hidden. Their PTYs must start at the size the terminal shows, or Claude Code draws for the wrong width. Pinned by the `stty size` e2e tests in Task 5 and Task 7.
4. **The data folder's path has a space** (`Application Support`). The SessionStart hook command must still write its file, and it must print nothing, because Claude Code adds a SessionStart hook's stdout to Claude's context. Pinned by the shell-run hook test in Task 2.
5. **`claude` missing from PATH, or a session that exits at once** (a bad flag, or `No conversation found with session ID` on resume). The task must land in Closed with the terminal showing why, and must not be relaunched at the next start. Pinned by the self-exit unit test in Task 4 and the missing-binary e2e test in Task 5.

---

## File structure

```
src/main/tasks/naming.ts          slugify, uniqueSlug, sessionName
src/main/tasks/openingPrompt.ts   the opening prompt
src/main/tasks/launch.ts          start/reopen argv, the hooks file, reading what SessionStart recorded
src/main/tasks/taskStore.ts       TaskRecord, loading and saving state.json
src/main/tasks/taskService.ts     TaskService: start, reopen, close, exits, quit, restore
src/main/git.ts                   startCheck, branchExists, worktreeBranchNames, changedFiles
src/main/testing/makeRepo.ts      throwaway repo with a bare origin on `stage` (unit and e2e tests)
src/main/config.ts                + claudeBin, dataDir; − sessionArgv
src/main/index.ts, ipc.ts, menu.ts, src/preload/index.ts, src/shared/{types,ipc}.ts   wiring
src/renderer/src/taskModel.ts     SessionState, nextSessionState, updateTerminals (pure)
src/renderer/src/tasksStore.ts    Solid store: tasks, session states, terminals, selection
src/renderer/src/board/NewTaskDialog.tsx, Board.tsx, TaskCard.tsx, StatusGlyph.tsx, lanes.ts, cardMoves.ts, shortcuts.ts
src/renderer/src/panel/SidePanel.tsx, panelPrefs.ts, SessionPanel.tsx, ChangedFiles.tsx, MessageField.tsx
src/renderer/src/terminal/sendMessage.ts   message field → terminal (from Parallel Code sendPrompt)
e2e/fake-claude.sh                stands in for `claude`: records cwd and argv, then runs bash
e2e/tasks.ts                      e2e helpers: startTask, screen, card, launches, run
docs/superpowers/mockups/2026-11-05-plan-2a-board.html   the approved design (already committed)
```

Removed: `src/main/sessions.ts` (+ test) and `src/renderer/src/sessionsStore.ts`, replaced by the task modules. View → Redraw Terminals and its IPC channel also go: the owner found it unneeded (feel test notes). `redrawAllTerminals` itself stays, because `TerminalView` uses it after a WebGL surface comes back.

---

### Task 1: Task names and the opening prompt

**Files:**
- Create: `src/main/tasks/naming.ts`, `src/main/tasks/openingPrompt.ts`
- Test: `src/main/tasks/naming.test.ts`, `src/main/tasks/openingPrompt.test.ts`

**Interfaces:**
- Produces: `slugify(title: string): string`, `uniqueSlug(base: string, taken: ReadonlySet<string>): string`, `sessionName(projectDir: string, slug: string): string`.
- Produces: `openingPrompt(t: { title: string; description: string; branch: string; noQuestions: boolean }): string`.

Slug rules (spec §12 leaves them to the builder): Unicode NFKD, combining marks removed, lowercase, every run of characters outside `[a-z0-9]` becomes one `-`, no leading or trailing `-`. Longer than 40 characters → cut at the last `-` at or before 40, or at 40 if there is none. Empty → `task`. Collisions get `-2`, `-3`, ….

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/tasks/naming.test.ts
import { it, expect } from 'vitest';
import { sessionName, slugify, uniqueSlug } from './naming';

it.each([
  ['Fix login on iOS', 'fix-login-on-ios'],
  ['Åtgärda växeln för öl', 'atgarda-vaxeln-for-ol'],
  ['Add 🍎 emoji / support!!', 'add-emoji-support'],
  ['  --Trim--  ', 'trim'],
  ['!!!', 'task'],
  ['Make the board show every session that needs the owner first', 'make-the-board-show-every-session-that'],
  ['x'.repeat(50), 'x'.repeat(40)],
])('slugify(%j) is %j', (title, slug) => {
  expect(slugify(title)).toBe(slug);
});

it('uniqueSlug adds the first free number', () => {
  expect(uniqueSlug('fix', new Set())).toBe('fix');
  expect(uniqueSlug('fix', new Set(['fix']))).toBe('fix-2');
  expect(uniqueSlug('fix', new Set(['fix', 'fix-2', 'fix-3']))).toBe('fix-4');
});

it('sessionName prefixes the slug with the project folder', () => {
  expect(sessionName('/Users/x/Developer/Damela', 'fix-login')).toBe('damela-fix-login');
});
```

```ts
// src/main/tasks/openingPrompt.test.ts
import { it, expect } from 'vitest';
import { openingPrompt } from './openingPrompt';

const tail =
  "TheSource started you in this task's own worktree, on branch worktree-fix-login, so don't call EnterWorktree. " +
  'From inside a worktree, Claude Code refuses git commands aimed at the main checkout: when you need the main ' +
  'checkout, for example to merge, call ExitWorktree with action "keep" first.';

const brief = "This task is your brief: read it, plan, then start. Follow this repo's CLAUDE.md, and ask me when you need me.\n\n";
const t = { title: 'Fix login', branch: 'worktree-fix-login', noQuestions: false };

it('gives the brief, the description and the worktree note', () => {
  expect(openingPrompt({ ...t, description: 'The button does nothing.\nOnly on iOS.' })).toBe(
    brief + 'Task: Fix login\n\nThe button does nothing.\nOnly on iOS.\n\n' + tail,
  );
});

it('leaves out an empty description', () => {
  expect(openingPrompt({ ...t, description: '  \n' })).toBe(brief + 'Task: Fix login\n\n' + tail);
});

it('passes on no-questions mode', () => {
  expect(openingPrompt({ ...t, description: '', noQuestions: true })).toBe(
    brief + 'Task: Fix login\n\n' + tail + '\n\n' +
      "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
      "When the work is done and reviewed as this repo's CLAUDE.md requires, merge without asking me, skipping the merge menu.",
  );
});
```

No-questions mode is spec §7.2's "don't ask me questions" checkbox next to Start. It passes the owner's instruction for that one task into the prompt, and the app enforces nothing.

The ExitWorktree sentence is there because of the launch form, not because of a project rule. From inside a worktree, Claude Code refuses `git -C <main>`, and its refusal doesn't mention ExitWorktree (findings, consequence 5).

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/tasks`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `naming.ts` and `openingPrompt.ts`**

The description is trimmed; the title is used as given (trimmed).

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test -- src/main/tasks`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/main/tasks
git -C <root> commit -m "feat: task slugs, session names and the opening prompt"
```

---

### Task 2: Launch commands and the SessionStart hook

**Files:**
- Create: `src/main/tasks/launch.ts`
- Test: `src/main/tasks/launch.test.ts`

**Interfaces:**
- Produces: `startArgv(o: { claudeBin: string; slug: string; name: string; claudeSessionId: string; settingsPath: string; prompt: string }): string[]`.
- Produces: `reopenArgv(o: { claudeBin: string; slug: string; claudeSessionId: string; settingsPath: string; branchExists: boolean }): string[]`. Throws when `claudeSessionId` isn't a UUID, so an id can never be read as a flag.
- Produces: `hookSettings(taskDir: string): string` (the settings file's JSON text) and `readSessionStart(text: string | null): string | null` (the `session_id` it recorded when it is a UUID, else null).
- Produces: `isUuid(s: string): boolean`.

The hook is a `command` hook because SessionStart doesn't support `http` hooks (hooks doc, read 2026-11-05). Its command is `cat > '<dir>/session-start.json.tmp' && mv '<dir>/session-start.json.tmp' '<dir>/session-start.json'`. Each path is single-quoted, with `'` written as `'\''`. Use `"timeout": 10` and no matcher, so it runs on every `source` (startup, resume, clear, compact, fork). The file always holds the latest SessionStart input, and its `session_id` is the conversation to resume. The command prints nothing: SessionStart stdout goes into Claude's context.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/tasks/launch.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { hookSettings, readSessionStart, reopenArgv, startArgv } from './launch';

const U = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';
const S = '/data/tasks/t1/settings.json';

it('starts claude in a named worktree with a fixed session id, the hooks file and the prompt', () => {
  expect(startArgv({ claudeBin: 'claude', slug: 'fix-login', name: 'damela-fix-login', claudeSessionId: U, settingsPath: S, prompt: 'P' }))
    .toEqual(['claude', '-w', 'fix-login', '-n', 'damela-fix-login', '--session-id', U, '--settings', S, 'P']);
});

it('reopens in the worktree while its branch exists, and in the main checkout once it is gone', () => {
  const o = { claudeBin: 'claude', slug: 'fix-login', claudeSessionId: U, settingsPath: S };
  expect(reopenArgv({ ...o, branchExists: true })).toEqual(['claude', '--worktree', 'fix-login', '--resume', U, '--settings', S]);
  expect(reopenArgv({ ...o, branchExists: false })).toEqual(['claude', '--resume', U, '--settings', S]);
});

it('refuses to resume an id that is not a UUID', () => {
  expect(() => reopenArgv({ claudeBin: 'claude', slug: 's', claudeSessionId: '--evil', settingsPath: S, branchExists: false })).toThrow('--evil');
});

it('registers one SessionStart command hook', () => {
  const hooks = JSON.parse(hookSettings('/d/t1')).hooks;
  expect(Object.keys(hooks)).toEqual(['SessionStart']);
  expect(hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: expect.any(String), timeout: 10 }] }]);
});

it('the hook command saves its input silently, also in a folder whose path has a space and a quote', () => {
  const dir = mkdtempSync(join(tmpdir(), "hook dir 'q' "));
  const command = JSON.parse(hookSettings(dir)).hooks.SessionStart[0].hooks[0].command;
  const out = execFileSync('/bin/sh', ['-c', command], { input: `{"session_id":"${U}","source":"clear"}` });
  expect(out.toString()).toBe('');
  expect(readFileSync(join(dir, 'session-start.json'), 'utf8')).toBe(`{"session_id":"${U}","source":"clear"}`);
});

it.each([
  [`{"session_id":"${U}"}`, U],
  [null, null],
  ['{', null],
  ['{"session_id":"--evil"}', null],
  ['[]', null],
])('readSessionStart(%j) is %j', (text, id) => {
  expect(readSessionStart(text)).toBe(id);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/tasks/launch.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `launch.ts`**

`isUuid` is `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (Parallel Code `electron/shared/session-resume.ts` checks the same before `--resume`).

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test -- src/main/tasks/launch.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/main/tasks/launch.ts src/main/tasks/launch.test.ts
git -C <root> commit -m "feat: launch commands and a SessionStart hook that records the session id"
```

---

### Task 3: Git queries

**Files:**
- Create: `src/main/git.ts`, `src/main/testing/makeRepo.ts`
- Test: `src/main/git.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md` (lists `src/main/git.ts`, adapted from `electron/ipc/git.ts` `getChangedFiles`)

**Interfaces:**
- Produces in `src/shared/types.ts`: `interface StartCheck { ahead: number; branch: string; base: string }` and `interface ChangedFile { path: string; status: 'A' | 'M' | 'D' | 'T' | 'U' | '?'; added: number | null; removed: number | null }`. The counts are null where git gives none: untracked and binary files.
- Produces in `src/main/git.ts` (each resolves, never rejects):
  - `startCheck(projectDir: string): Promise<StartCheck | null>`. `branch` is the main checkout's branch (`rev-parse --abbrev-ref HEAD`), `base` is `origin/HEAD`'s target (`symbolic-ref --short refs/remotes/origin/HEAD`, e.g. `origin/stage`), and `ahead` is `rev-list --count origin/HEAD..HEAD`. Null when any of these fails (not a repo, no `origin/HEAD`).
  - `branchExists(projectDir: string, branch: string): Promise<boolean>`, from `rev-parse --verify --quiet refs/heads/<branch>`.
  - `worktreeBranchNames(projectDir: string): Promise<string[]>`: local branches named `worktree-*`, without the prefix, from `for-each-ref --format=%(refname:short) refs/heads/worktree-*`.
  - `changedFiles(worktreePath: string): Promise<ChangedFile[] | null>`. The base is `merge-base HEAD origin/HEAD`, or `HEAD` when that fails. Then `-c diff.autoRefreshIndex=false diff --no-renames --name-status -z <base>`, which covers committed and uncommitted changes to tracked files, plus `ls-files --others --exclude-standard -z` as status `?`. The line counts come from the same diff with `--numstat -z` (`<added>\t<removed>\t<path>\0`; `-` for a binary file gives null), matched by path. Sorted by path. Null when `worktreePath` isn't a git work tree.
  - `export const gitQueries = { startCheck, branchExists, worktreeBranchNames, changedFiles }` and `export type GitQueries = typeof gitQueries`.
- Produces in `src/main/testing/makeRepo.ts`: `makeRepo(): { origin: string; main: string }`. It creates, in a fresh temp dir, a bare `origin.git` (`init --bare -b stage`) and its clone `main` with `user.name`/`user.email` set, one commit (`README.md` containing `hi\n`) pushed to `stage`, and `remote set-head origin stage`. It uses `execFileSync('git', …)` with absolute paths. Task 5's e2e tests use it too.

- [ ] **Step 1: Write the failing tests** in `src/main/git.test.ts`, each on a fresh `makeRepo()`:
  - `startCheck reports the main checkout's branch, origin/HEAD and how far ahead it is`. First `{ ahead: 0, branch: 'stage', base: 'origin/stage' }`. Then, after a local commit in `main`, `ahead: 1`.
  - `startCheck is null outside a repo and without origin/HEAD`, for `mkdtempSync(...)` and for a repo after `git remote set-head origin --delete`.
  - `branchExists sees local branches only`: `stage` is true and `worktree-x` false; after `git branch worktree-x`, it is true.
  - `worktreeBranchNames lists worktree branches without the prefix`: branches `worktree-a`, `worktree-b` and `other` give `['a', 'b']`.
  - `changedFiles lists committed, uncommitted and untracked changes since the branch left origin/HEAD`. Run `git worktree add -b worktree-x <main>/.claude/worktrees/x origin/stage`. In it, commit `a.txt` holding `a\n`, then change `README.md` to `bye\n` without committing and create `u.txt`. Expected: `[{ path: 'README.md', status: 'M', added: 1, removed: 1 }, { path: 'a.txt', status: 'A', added: 1, removed: 0 }, { path: 'u.txt', status: '?', added: null, removed: null }]`.
  - `changedFiles is null for a folder that is not a work tree`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/git.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `git.ts`, `makeRepo.ts` and the two shared types**

One private runner, `git(dir: string, args: string[]): Promise<string>`, does `execFile('git', ['--no-optional-locks', '-C', dir, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })`. The query functions catch its rejection.

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test -- src/main/git.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/main/git.ts src/main/git.test.ts src/main/testing src/shared/types.ts THIRD_PARTY_NOTICES.md
git -C <root> commit -m "feat: git queries for the start check, branches and changed files"
```

---

### Task 4: Task records and the task service

**Files:**
- Create: `src/main/tasks/taskStore.ts`, `src/main/tasks/taskService.ts`
- Test: `src/main/tasks/taskStore.test.ts`, `src/main/tasks/taskService.test.ts`

**Interfaces:**
- Consumes: Task 1 (`slugify`, `uniqueSlug`, `sessionName`, `openingPrompt`), Task 2 (`startArgv`, `reopenArgv`, `hookSettings`, `readSessionStart`), Task 3 (`GitQueries`).
- Produces in `src/shared/types.ts`:
  ```ts
  export interface TaskView {
    id: string; title: string; description: string; slug: string;
    branch: string;        // worktree-<slug>
    worktreePath: string;  // <projectDir>/.claude/worktrees/<slug>
    createdAt: number;
    /** When its last session ended; null while one runs. Closed cards show their age from it. */
    closedAt: number | null;
    /** The running `claude` process; null when the task is closed. */
    session: { id: string; startedWithPrompt: boolean } | null;
  }
  ```
- Produces in `taskStore.ts`: `interface TaskRecord { id; projectDir; title; description; slug; name; claudeSessionId; worktreePath; branch; createdAt: number; closedAt: number | null; open: boolean }`, with every other field a string. Also `loadTasks(file: string, now: number, warn: (msg: string) => void): TaskRecord[]` and `saveTasks(file: string, tasks: TaskRecord[]): void`.
  - The file is `{ "version": 1, "tasks": [...] }`.
  - Save writes `<file>.tmp` and renames it over `<file>`.
  - Load of a missing file gives `[]`. A file that doesn't parse, or has the wrong shape, is renamed to `<file>.bad-<now>` and gives `[]`, with a `warn` that names the new path.
- Produces in `taskService.ts`:
  ```ts
  new TaskService(deps: {
    projectDir: string; dataDir: string; claudeBin: string; git: GitQueries;
    kill(sessionId: string): void; onChange(tasks: TaskView[]): void;
    newId?: () => string; now?: () => number; warn?: (msg: string) => void;
  })
  list(): TaskView[]                                    // this project's tasks, in creation order
  startCheck(): Promise<StartCheck | null>
  start(req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView>
  reopen(taskId: string): Promise<TaskView>
  restore(): Promise<void>                              // reopens every open task of this project
  close(taskId: string): void
  launchSpec(sessionId: string): { argv: string[]; cwd: string }   // throws for an unknown id
  onSessionExit(sessionId: string): void
  beginQuit(): void
  changedFiles(taskId: string): Promise<ChangedFile[] | null>
  ```
  - `open` means "should be running". `start` and `reopen` set it. `close` clears it. `onSessionExit` clears it too, unless `beginQuit` came first.
  - `closedAt` is set to `now()` when an exit clears `open`, and back to null by `start` and `reopen`.
  - Each session gets a fresh `newId()` and is held in memory with its launch spec until its exit.
  - Every change saves `state.json` and calls `onChange(list())`.
  - Tasks of other projects in `state.json` are kept as they are and not listed.

Behaviour in detail:
- **`start`:**
  - It trims the title and rejects an empty one with `Error('A task needs a title')`.
  - The slug is `uniqueSlug(slugify(title), taken)`. `taken` holds the slugs of every task of this project, the result of `git.worktreeBranchNames(projectDir)`, and the folder names in `<projectDir>/.claude/worktrees` (a missing folder counts as empty).
  - It writes `hookSettings(taskDir)` to `<dataDir>/tasks/<id>/settings.json`.
  - The session's argv is `startArgv` with `openingPrompt`, and `startedWithPrompt` is true.
- **`reopen`:**
  - A task that is running is returned unchanged.
  - Otherwise it takes `claudeSessionId` from `readSessionStart` of the task's `session-start.json`, when that gives an id.
  - The argv is `reopenArgv`, with `branchExists` from git, and `startedWithPrompt` is false.
- **`onSessionExit`** also takes the latest id from `session-start.json`, so `state.json` holds it even if the app crashes later.
- **`close`** calls `kill(sessionId)`. The session stays in `list()` until its exit arrives.

- [ ] **Step 1: Write the failing tests**

`taskStore.test.ts`:
- `saves and loads tasks, leaving no temp file`.
- `a missing file loads as no tasks`.
- `a file that cannot be read is kept aside and loads as no tasks`. Write `{oops` to the file. Expected: `[]`, `<file>.bad-1000` holds `{oops`, and `warn` was called with a message containing `.bad-1000`.

`taskService.test.ts` uses one `setup(gitOverrides?)` with real temp folders:
- `projectDir` is a folder named `Damela` inside `mkdtempSync`, so that `sessionName` gives `damela-…`.
- `dataDir` is another temp folder.
- `git` is a fake: `startCheck → null`, `branchExists → false`, `worktreeBranchNames → []`, `changedFiles → []`, each overridable.
- `kill` records ids, and `onChange` records lists.
- `newId` counts up `00000000-0000-4000-8000-000000000001`, `…002`, and so on.
- `now` gives 1000.

The tests:
- `start records the task, writes its hooks file and launches claude -w with the opening prompt`.
  - The view has `slug: 'fix-login'`, `branch: 'worktree-fix-login'`, `worktreePath: <projectDir>/.claude/worktrees/fix-login` and `session.startedWithPrompt: true`.
  - `launchSpec(view.session!.id)` has `cwd: projectDir` and an argv equal to `startArgv({ claudeBin: 'claude', slug: 'fix-login', name: 'damela-fix-login', claudeSessionId: <the record's id>, settingsPath: <dataDir>/tasks/<id>/settings.json, prompt: openingPrompt(...) })`.
  - The settings file exists, `state.json` has the task with `open: true`, and `onChange` was called.
- `start picks a slug that no task, worktree branch or worktree folder has taken`. Start `Fix login` once, which gives `fix-login`. The fake `worktreeBranchNames` returns `['fix-login-2']`, and the test creates `<projectDir>/.claude/worktrees/fix-login-3`. The second `Fix login` gives `fix-login-4`.
- `start refuses an empty title` rejects with `title`.
- `close kills the session; its exit then closes the task`:
  - `kill` got the session id, and `list()[0].session` is still set.
  - After `onSessionExit`, `session` is null, `closedAt` is 1000, and `state.json` has `open: false`. A `reopen` sets `closedAt` back to null.
- `a session that exits by itself closes its task` (Review Focus 5).
- `exits during a quit leave tasks open, and restore reopens them` (Review Focus 1):
  - `beginQuit()`, then `onSessionExit`. `state.json` still has `open: true` and `closedAt: null`.
  - A second `TaskService` on the same folders, after `restore()`, lists the task with `session.startedWithPrompt: false`, and its `launchSpec` argv is the reopen form.
- `reopen resumes in the worktree while its branch exists, and in the main checkout once it is gone`. With `branchExists` true, the argv contains `--worktree fix-login`. With it false, the argv is `['claude', '--resume', <id>, '--settings', …]`.
- `reopen continues the conversation SessionStart last recorded`. Write `{"session_id":"<uuid 2>"}` to the task's `session-start.json`, then `onSessionExit`, then `reopen`. The argv resumes `<uuid 2>`, and `state.json` stores it.
- `reopen of a running task changes nothing`: the same session id comes back, and nothing is killed.
- `tasks of other projects are kept and not listed`. Seed `state.json` with a task whose `projectDir` is `/other`. `list()` leaves it out, and after a `start` it is still in `state.json`.
- `changedFiles asks git about the task's worktree`: the fake receives `worktreePath`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/tasks`
Expected: the new files FAIL, modules not found; Tasks 1–2 tests still pass.

- [ ] **Step 3: Implement `taskStore.ts` and `taskService.ts`**

Use synchronous `fs` for `state.json` and the task folders: they are small, and main does nothing else meanwhile. Create the task folder with `{ recursive: true }` before writing into it.

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test` then `npm --prefix <root> run typecheck`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/main/tasks src/shared/types.ts
git -C <root> commit -m "feat: task records and the service that starts, closes and reopens sessions"
```

---

### Task 5: Tasks over the bridge, and the New task dialog

This task swaps the feel test's sessions for tasks from end to end. The left side stays a plain list of task cards until Task 6 turns it into lanes.

**Files:**
- Modify: `src/main/config.ts` (+ test), `src/main/index.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/app.css`, `src/renderer/src/env.d.ts`
- Create: `src/renderer/src/taskModel.ts` (+ `taskModel.test.ts`), `src/renderer/src/tasksStore.ts`, `src/renderer/src/board/NewTaskDialog.tsx`, `e2e/fake-claude.sh` (mode 755), `e2e/tasks.ts`, `e2e/tasks.e2e.ts`
- Delete: `src/main/sessions.ts`, `src/main/sessions.test.ts`, `src/renderer/src/sessionsStore.ts`
- Modify tests: `e2e/launch.ts`, `e2e/bridge.e2e.ts`, `e2e/terminal.e2e.ts`

**Interfaces:**
- Consumes: Task 4 `TaskService`, Task 3 `gitQueries`.
- Produces: `AppConfig` is `{ projectDir; claudeBin; dataDir; inputBatchMs; outputBatchMs; logOsc; e2e }`, and `loadConfig(env, isDirectory, defaultDataDir: string)`.
  - New variables: `THESOURCE_CLAUDE_BIN` (default `claude`; empty is rejected and the error names the variable) and `THESOURCE_DATA_DIR` (default `defaultDataDir`).
  - `THESOURCE_SESSION_ARGV` is removed.
- Produces: `RendererConfig` adds `projectName: string`, the basename of `projectDir`.
- Produces, the bridge (`TheSourceApi`):
  - Removed: `createSession`, `kill` and `onRedrawTerminals`.
  - Added: `listTasks(): Promise<TaskView[]>`, `startCheck(): Promise<StartCheck | null>`, `startTask(req: { title: string; description: string; noQuestions: boolean }): Promise<TaskView>`, `reopenTask(taskId: string): Promise<TaskView>`, `closeTask(taskId: string): void` and `onTasks(cb: (tasks: TaskView[]) => void): () => void`.
  - The PTY calls and events keep their `sessionId`, which is now `TaskView.session.id`.
  - IPC channels: `tasks:list`, `tasks:start-check`, `tasks:start`, `tasks:reopen`, `tasks:close`, `tasks:changed`.
- Produces in `taskModel.ts`:
  - `interface SessionState { status: ProgramStatus | null; started: boolean; since: number }`.
  - `nextSessionState(prev: SessionState | undefined, status: ProgramStatus | null, now: number): SessionState`. `started` becomes true at the first status other than `idle`, and stays true. `since` is when the state last changed: it becomes `now` when `status?.state` differs from `prev?.status?.state` (or there is no `prev`), and stays otherwise, so a new `msg` doesn't reset a card's age.
  - `interface TerminalEntry { sessionId: string; taskId: string }`.
  - `updateTerminals(current: TerminalEntry[], tasks: TaskView[]): TerminalEntry[]`.
    - A task with a session that has no entry gets one, replacing that task's earlier entry.
    - A closed task keeps its last entry, so its final output stays readable.
- Produces in `tasksStore.ts`:
  - `tasksStore`: `{ tasks: TaskView[]; sessions: Record<string, SessionState>; terminals: TerminalEntry[]; selectedId: string | null }`.
  - `loadTasks()`, `startTask(req)` (selects the new task), `reopenTask(id)` (selects it), `closeTask(id)`, `select(id: string | null)` and `terminalOf(taskId): string | null`.
- Produces, e2e hooks: `window.__thesourceE2E = { taskIds(): string[]; screenText(taskId: string): string; termSize(taskId: string): { cols: number; rows: number } | null }`.
- Produces, test ids: `new-task` (toolbar button), `new-task-title`, `new-task-description`, `new-task-no-questions` (checkbox), `new-task-start`, `start-check-warning`, `task-card` (with `data-task-id`, `data-selected`), `task-status` (inside a card), `close-session` (panel header).
- Produces, e2e helpers in `e2e/tasks.ts`:
  - `startTask(page, title?, description?): Promise<string>` opens the dialog, fills it and starts. It returns the new task id once its screen shows `$`.
  - `ids(page)`, `screen(page, taskId)`, `termSize(page, taskId)`, `card(page, taskId)`, `run(page, line)`.
  - `launches(dataDir): Array<{ cwd: string; args: string[] }>`, in launch order.
- Produces: `launchApp(env?)` returns `{ app, page, dataDir }`.
  - Defaults: `THESOURCE_CLAUDE_BIN=<root>/e2e/fake-claude.sh`, `THESOURCE_PROJECT_DIR=os.tmpdir()`, and `THESOURCE_DATA_DIR` a fresh `mkdtempSync` unless the caller passes one (the restart test does).
  - Also `FAKE_CLAUDE_LOG_DIR=<dataDir>/fake-claude`, created by the helper.

`e2e/fake-claude.sh`:

```bash
#!/bin/bash
# Stands in for `claude` in e2e tests: records its working directory and arguments, then becomes
# a plain shell so the terminal tests can type into it.
if [ -n "$FAKE_CLAUDE_LOG_DIR" ]; then printf '%s\0' "$PWD" "$@" > "$FAKE_CLAUDE_LOG_DIR/$$.argv"; fi
exec /bin/bash --noprofile --norc
```

`launches()` reads the `*.argv` files sorted by modification time and splits each file on NUL.

**Main wiring** (`index.ts`):
- Before `ready`: load the config with `app.getPath('userData')` as the default data dir. Then call `app.setPath('userData', config.dataDir)`. A config error is still shown after `ready`, as now.
- After `ready`: create the window and the `TaskService`. Its `kill` is `host.kill`, and its `onChange` sends `tasks:changed`.
- Register IPC, then `void service.restore()`. A `listTasks` that comes in before `restore` finishes gets the current list, and the change event follows.
- `before-quit`: `service.beginQuit()`, then `host.killAll()`.
- In `ipc.ts`, `spawn` gets its launch spec from `service.launchSpec(sessionId)`. The PTY's exit calls `service.onSessionExit(sessionId)`. If `launchSpec` or `host.spawn` throws, the handler calls `service.onSessionExit(sessionId)` and rethrows, so the terminal shows the error and the task closes (Review Focus 5).
- `menu.ts` loses View → Redraw Terminals and its separator.
- The window gets `titleBarStyle: 'hiddenInset'`, so the window buttons sit in the top bar (mockup) and the panel can run to the top edge.

**Renderer.**
- The terminal well renders one `TerminalView` per `tasksStore.terminals` entry. It is `selected` when it is the selected task's `terminalOf`.
- **The well always keeps its size** (Review Focus 3). Replace `.well[hidden] { display: none }` with `visibility: hidden`, so terminals that mount with nothing selected still measure their real size before they spawn.
- `TerminalView`'s `onExit` prop goes: a closed task arrives through `tasks:changed`.
- **Left column:** the top bar, then the task cards.
  - The top bar is 46 px tall. It starts after 90 px, which leaves room for the window buttons, and holds **New task** and the project chip (a colour square and the project name).
  - It is a window drag region (`-webkit-app-region: drag`, with `no-drag` on its buttons). Task 8 makes the panel's title bar one too.
  - Each card shows the title and, for now, plan 1's `statusText`: `closed` when the session is null, else `state · kind` or `—`.
- **Panel header:** the selected task's title and a **Close session** button, shown while it runs.

**New task dialog** (`NewTaskDialog.tsx`):
- A native `<dialog>` opened with `showModal()`. Esc closes it.
- A Title input (focused), a Description textarea, a **Don't ask me questions** checkbox (off by default, spec §7.2), Cancel and Start.
- Enter in the title, or Cmd+Enter in the description, starts. Start is disabled while the title is blank.
- On open it calls `startCheck()`. When `ahead > 0`, it shows the warning (`data-testid="start-check-warning"`) and the button reads **Start anyway**. The warning reads, with `1 commit that isn't` / `N commits that aren't`:
  `{branch} has {N} commits that aren't on {base}. New worktrees start from {base}, so this task won't have them. Push {branch} first, or start anyway.`
- A failed start shows the error's message in the dialog and keeps it open.

- [ ] **Step 1: Update the config tests and write the `taskModel` tests**

`config.test.ts`:
- `uses the defaults` expects `{ projectDir: <damela>, claudeBin: 'claude', dataDir: '/data', inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false }` for `loadConfig({}, isDir, '/data')`.
- `reads every override` sets `THESOURCE_CLAUDE_BIN: '/x/claude'` and `THESOURCE_DATA_DIR: '/tmp/d'`.
- The rejected cases become `['THESOURCE_CLAUDE_BIN', '']` plus the three batch cases.

`taskModel.test.ts`:
- `started turns true at the first status other than idle, and stays true`: `idle` gives false, `working` true, then `idle` true.
- `since moves when the state changes, not when its message does`: `working` at 1 gives `since: 1`; `working` with another `msg` at 2 keeps 1; `blocked` at 3 gives 3.
- `a new session gets a terminal, a reopened task's terminal is replaced, a closed task keeps its last one`.

- [ ] **Step 2: Write the failing e2e tests**

Update `e2e/launch.ts` as in the interfaces above. Rewrite `e2e/terminal.e2e.ts` on `startTask` and cards. Its tests:
- typed input reaches the shell;
- the font and the emoji tests;
- switching tasks keeps each one intact (click the cards);
- OSC 7501 status shows on the card: `task-status` reads `blocked · question`;
- a new status replaces the old one;
- a flood in a hidden task arrives in full;
- quitting leaves no session process behind;
- `Close session ends the process and keeps the task, and the other tasks keep running`. After closing, that card's `task-status` reads `closed`, its terminal shows `[Process exited]`, the task stays selected, and the other shells are still alive and still take input.

Rewrite `e2e/bridge.e2e.ts`: `a task's session streams output, reports OSC 7501 status and exit`.
- `THESOURCE_CLAUDE_BIN` is a script the test writes into its temp folder (mode 755): `#!/bin/sh\nprintf 'bridge-%s' ok; printf '\033]7501;state=working\033\\'; sleep 0.3`.
- In `page.evaluate`, listen to `onData`, `onStatus` and `onExit` before calling `startTask`, then filter by the returned `session.id`. The renderer mounts the terminal and spawns it itself.
- Expected: the output contains `bridge-ok`, the states are `['working', 'none']`, and the exit code is 0.

New `e2e/tasks.e2e.ts`:
- `New task launches claude -w in the main checkout with a fresh session id, the hooks file and the opening prompt`. Run it on `makeRepo().main`, and check the only `launches()` entry:
  - `cwd` is that folder.
  - `args` starts with `-w`, `fix-login`, `-n`, `main-fix-login`, `--session-id`, then a UUID, then `--settings` and `<dataDir>/tasks/<taskId>/settings.json`.
  - The last arg starts with `This task is your brief` and contains `Task: Fix login`.
  - A second task started with `new-task-no-questions` checked has a prompt that contains `No questions on this task`.
- `the dialog warns when the main checkout has commits that new worktrees won't have`. After a local commit in `makeRepo().main`, the warning reads `stage has 1 commit that isn't on origin/stage. …` and the button reads `Start anyway`. On a fresh `makeRepo()` there is no warning.
- `quitting with tasks running reopens them at the next start, in their worktrees while the branch exists` (Review Focus 1).
  - Start `Alpha` and `Beta` on a `makeRepo()`, run `git -C <main> branch worktree-alpha`, then `app.close()`.
  - Relaunch with the same `dataDir`. Both cards are back and running.
  - The two new `launches()` entries are `--worktree alpha --resume <alpha's uuid> --settings …` and `--resume <beta's uuid> --settings …`.
- `tasks reopened at startup start at the size their terminal shows` (Review Focus 3). After a restart with nothing selected, click the card and `run(page, 'stty size')`. The screen shows `<rows> <cols>` from `termSize`.
- `a task whose claude can't start lands in Closed and stays closed after a restart` (Review Focus 5). With `THESOURCE_CLAUDE_BIN=/nonexistent/claude`, the card's `task-status` reads `closed`. After a relaunch with the same data dir, it still reads `closed`, and `launches()` is empty.

- [ ] **Step 3: Run them to see them fail**

Run: `npm --prefix <root> test` then `npm --prefix <root> run test:e2e`
Expected: the config and taskModel unit tests FAIL; the e2e tests FAIL (no `new-task` button).

- [ ] **Step 4: Implement the wiring, the store and the dialog**

Invoke `frontend-design:frontend-design` for the dialog, toolbar and card styling before writing them. The dialog follows the mockup's New task dialog: `--bg-elevated` with a 12 px radius, inputs with the focus ring, and Start as the one accent-filled button.

- [ ] **Step 5: Run everything**

Run: `npm --prefix <root> test`, `npm --prefix <root> run typecheck`, `npm --prefix <root> run test:e2e`
Expected: all pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git -C <root> add -A src e2e
git -C <root> commit -m "feat: tasks with New task, Close session and reopening after a restart"
```

---

### Task 6: The board: Needs you, Working and Closed, and cards that move

**Files:**
- Create: `src/renderer/src/board/lanes.ts` (+ `lanes.test.ts`), `src/renderer/src/board/cardMoves.ts` (+ `cardMoves.test.ts`), `src/renderer/src/board/Board.tsx`, `src/renderer/src/board/TaskCard.tsx`, `src/renderer/src/board/StatusGlyph.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app.css`, `e2e/terminal.e2e.ts` and `e2e/tasks.e2e.ts` (expected card texts), `THIRD_PARTY_NOTICES.md` (lists `StatusGlyph.tsx`, from `src/components/StatusDot.tsx`, and the board styles, from `src/components/task-board.css`)
- Create test: `e2e/board.e2e.ts`

**Interfaces:**
- Consumes: `TaskView` with `closedAt` (Task 4), `SessionState` with `since` (Task 5).
- Produces in `lanes.ts`, each function taking `(task: TaskView, s: SessionState | undefined)`:
  - `type Lane = 'needs-you' | 'working' | 'closed'`, `type Glyph = 'ask' | 'error' | 'spin' | 'start' | 'ready' | 'wait' | 'dot'` and `type Tone = 'warn' | 'error' | 'strong' | 'muted' | 'subtle' | 'accent'`.
  - `laneOf(…): Lane`, `glyphOf(…): Glyph`, `stateLabel(…): { text: string; tone: Tone }` and `cardActivity(…): { text: string; kind: 'msg' | 'busy' | 'branch' }`.
  - `cardAge(task: TaskView, s: SessionState | undefined, now: number): string`. It counts from `closedAt` when the task is closed, else from `s.since`, and is `''` without either. Under a minute it reads `just now`, under an hour `N min`, else `N h` (floored).
  - `laneOrder(tasks: TaskView[], sessions: Record<string, SessionState>): Record<Lane, TaskView[]>`. Needs you and Working go by `createdAt` ascending, which stands in for to-do order until plan 2b. Closed goes by `createdAt` descending.
- Produces in `cardMoves.ts`:
  - `interface CardSpot { left: number; top: number; lane: string }`.
  - `planMove(prev: CardSpot | undefined, now: CardSpot): { kind: 'enter' | 'slide' | 'fly' | 'none'; arrives: boolean }`.
    - No `prev` gives `enter`.
    - A changed lane gives `fly` when the card moved more than 1 px, else `none`. The same lane gives `slide` when it moved more than 1 px, else `none`.
    - `arrives` is true when the card is now in `needs-you` and wasn't before, a new card included.
  - `snapshotCards(root: HTMLElement): Map<string, CardSpot>` and `playCardMoves(root: HTMLElement, before: Map<string, CardSpot>, reducedMotion: boolean): void`, described under Step 3.
- Produces, test ids: `lane` (with `data-lane`), `task-card` (adds `data-lane`), `task-glyph` (with `data-glyph`), `task-activity`, `task-age`, `task-ask` (the state label, on Needs you and Closed cards), `answer` (on Needs you cards), `reopen` (on Closed cards). `task-status` goes.

The lane rules come from the findings (consequence 7, OSC 7501 → lanes), plus one rule of the plan's own. In a session started with the opening prompt, an `idle` before the first other report counts as starting. Without that rule, every new task would flash through Needs you before Claude submits its prompt.

| Task and session | Lane | Glyph | State label (tone) | Activity without a `msg` |
|---|---|---|---|---|
| `session` null | closed | dot | `Closed` (subtle) | the branch |
| no report yet | working | start | `Starting…` (muted) | `Starting…` (busy) |
| `idle`, `startedWithPrompt` and not `started` | working | start | `Starting…` (muted) | `Starting…` (busy) |
| `idle` otherwise | needs-you | wait | `Waiting for you` (muted) | the branch |
| `working` | working | spin | `Working` (accent) | the branch |
| `blocked` | needs-you | ask | `Needs input` (warn) | by kind: permission `Waiting for your permission`, question `Asking you a question`, auth `Needs you to sign in`, none `Blocked` |
| `done` | needs-you | ready | `Finished its turn` (strong) | the branch |
| `error` | needs-you | error | `Stopped` (error) | `Stopped with an error` |

The activity is the session's `msg` (kind `msg`) whenever it has one, except on Closed and starting cards. The branch is `task.branch` (kind `branch`). Blocked and error keep a reason when there is no `msg`, because spec §7.1 wants each Needs you card to say why.

- [ ] **Step 1: Write the failing tests**

`lanes.test.ts`:
- One `it.each` over the table above, one row per line, checking lane, glyph, label, tone and activity.
- `blocked` with `msg: 'approve Bash: git status'` has the activity `approve Bash: git status` (kind `msg`) and the label `Needs input`.
- A reopened session (`startedWithPrompt: false`) at `idle` is in needs-you with the glyph `wait`.
- A closed task whose last state had a `msg` shows its branch.
- `cardAge reads closedAt for closed tasks and since otherwise`. With `now` = 10 000 000: `since` 30 s earlier reads `just now`, 12 min earlier `12 min`; a closed task with `closedAt` 140 min earlier reads `2 h`; an open task without a session state reads `''`.
- `laneOrder sorts open lanes oldest first and Closed newest first`.

`cardMoves.test.ts`, `planMove`:
- no `prev`, now in working: `enter`, not arriving; now in needs-you: `enter`, arriving;
- the same lane, 40 px lower: `slide`; 0.5 px off: `none`;
- working to needs-you, moved: `fly`, arriving; needs-you to working: `fly`, not arriving.

In the e2e tests:
- Every `task-status` check becomes a `task-ask` check. `closed` becomes `Closed`.
- The two OSC tests in `terminal.e2e.ts` expect `task-ask` to read `Needs input` with `task-activity` reading `Asking you a question`, then `task-ask` to read `Finished its turn`.
- The card is in the lane `[data-lane=needs-you]`, then `[data-lane=closed]`.
- New in `tasks.e2e.ts`: `cards move between lanes as the session reports, and Reopen brings a closed one back`.
  - A new task's card is in Working.
  - After `printf '\033]7501;state=blocked:kind=permission:msg=YXBwcm92ZSBCYXNoOiBscw==\033\\'` (the base64 of `approve Bash: ls`), it is in Needs you. `task-glyph` has `data-glyph="ask"`, `task-activity` reads `approve Bash: ls` and `task-ask` reads `Needs input`. Clicking its `answer` selects it.
  - After Close session, it is in Closed, with `task-ask` reading `Closed` and `task-age` reading `just now`. Its `reopen` button puts it back in Working, and `launches()` gains a `--resume` entry.
- New `board.e2e.ts`: `a card that changes lanes flies there once, and nothing flies with reduced motion`.
  - Start a task. In the page, a `MutationObserver` on `document.body` counts added `.card-fly` elements.
  - `printf` a `blocked` report. Once the card is in Needs you, the count is 1. After 1 s, no `.card-fly` is left and no `task-card` has `visibility: hidden`.
  - Then `page.emulateMedia({ reducedMotion: 'reduce' })` and `printf` a `working` report. Once the card is in Working, the count is still 1. If `emulateMedia` has no effect in Electron, use CDP `Emulation.setEmulatedMedia` via `page.context().newCDPSession(page)`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/renderer/src/board` then `npm --prefix <root> run test:e2e`
Expected: FAIL.

- [ ] **Step 3: Implement the board**

Invoke `frontend-design:frontend-design` first. Build to the mockup.

**Lanes:**
- No boxes. The lanes sit 20 px apart, with `12px 20px 16px` padding around them. Each lane is `flex: 1 1 240px; min-width: 212px; max-width: 360px`.
- The title is 14 px, weight 500, with the count in `--fg-subtle`. Empty lanes have their title in `--fg-muted` and their text in `--fg-subtle`: `Nothing needs you`, `Nothing running`, `No closed tasks`.
- Needs you's title has a 6 px dot. Dot and count are `--warning` while the lane holds cards; otherwise the dot is `--fg-subtle`.
- Beside the pinned panel, the lanes fade out over their last 20 px (`mask-image`). Leave room for plan 2b's TODO lane on the left.
- Cards are buttons, in lists labelled with their lane's name.

**Cards:**
- 14 px text, `10px 12px` padding, 5 px between rows, 6 px between cards, an 8 px radius.
- The fill is `color-mix(in srgb, var(--fg) 4.5%, transparent)`, 7% on hover. The selected card has a 12% `--accent` tint (16% on hover). A keyboard-focused card gets a 1 px `--border-focus` ring, and an error card a 9% `--error` tint.
- Rows, top to bottom:
  1. **Title:** the `StatusGlyph` in a 12 px lane, a 5 px gap, then the title in weight 500 on an 18 px line, two lines at most. The title is the card's button and stretches over the card (`::after`, inset 0), so a click anywhere selects it.
  2. **Meta**, 13 px, `--fg-subtle`, indented 17 px like the rows below: a 3×11 px project colour bar and the project name in `--fg-muted`, then `task-age` on the right in tabular figures. Ages refresh every 30 s.
  3. **Activity:** one 16 px line with an ellipsis, 12 px JetBrains Mono in `--fg-muted`. A branch is in `--fg-subtle`; `busy` text uses the interface font.
  4. **Ask row**, on Needs you and Closed cards only, 24 px tall: the state label (weight 500, its tone's colour, ellipsis), and on the right **Answer** or **Reopen**. The button is 24 px tall with a `color-mix(in srgb, var(--fg) 7%, transparent)` fill (11% on hover) and full-strength text.

**`StatusGlyph`** takes `glyph` and `size: 'sm' | 'md'` (a 12 px or 16 px lane). It has `role="img"`, with the state label as its `aria-label` and `title`. Shape carries the state; colour only backs it up:
- `ask`, `error`: a filled 10 px circle (13 px at md) in `--warning` / `--error`, with a bold `?` / `!` in `--bg` and a 2 px halo of its colour at 22%.
- `spin`, `start`: a 10 px ring (13 px at md), whose 2 px border is its colour at 28% with a full-colour top, turning every 0.9 s. `spin` is `--accent`, `start` is `--fg-muted`. It stands still under reduced motion.
- `ready`: a 10 px check in `--success`, Parallel Code's `StatusCheckIcon` (path `M2.5 6.3 4.9 8.7 9.6 3.5`, stroke 2).
- `wait`: a 7 px ring (9 px at md) with a 1.5 px border, `--fg-subtle`.
- `dot`: a 6 px dot (8 px at md), `--fg-subtle`.

**Card moves** (`cardMoves.ts`):
- **When to measure.** `Board` takes a snapshot before Solid updates the DOM and plays the moves after. A `createComputed` keyed on the lane order (each lane's ids, joined) calls `snapshotCards` when that order changes, because Solid runs computations before it updates the DOM. A `createEffect` on the same key calls `playCardMoves`, because effects run after. An unchanged order measures nothing, so the frequent `msg` updates cost nothing.
- **`snapshotCards`** records each `task-card`'s position and `data-lane` by `data-task-id`. A card in flight is recorded where its copy is, and the copy's animation is cancelled.
- **`playCardMoves`** acts on `planMove` for each card, with the easing `cubic-bezier(0.2, 0, 0, 1)` (Parallel Code's `--ease-out`):
  - `slide`: the Web Animations API, from `translate(dx, dy)` to none, 230 ms.
  - `fly`: a copy of the card animates from the old position to the new one over 270 ms, with a `0 10px 28px rgba(0, 0, 0, 0.45)` shadow that fades out.
    - The copy has the class `card-fly` and is `position: fixed` at the new rect, above the board, with `pointer-events: none`, `aria-hidden="true"` and `inert`. It has no `data-testid` or `data-task-id`.
    - It flies above the board because each lane's list clips its overflow. Its fill is opaque, `color-mix(in srgb, var(--fg) 7%, var(--bg))` (14% `--accent` when selected), because card fills are see-through.
    - The real card stays `visibility: hidden` until the copy lands or is cancelled.
  - `enter`: from opacity 0 and `translateY(6px) scale(0.98)`, 170 ms.
  - `arrives`: a ring shown once, `0 0 0 1px` plus `0 0 14px` of `--warning`, from 80% and 22% down to 0 over 1400 ms ease-out. It starts when the card lands.
  - Under reduced motion only `arrives` plays.

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test`, `npm --prefix <root> run typecheck`, `npm --prefix <root> run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/renderer e2e THIRD_PARTY_NOTICES.md
git -C <root> commit -m "feat: board lanes for sessions that need the owner, are working or are closed"
```

---

### Task 7: The session panel: full height, resizable, pinnable

Spec §7.1, the owner's note of 2026-11-05. Build the panel as a shell (`SidePanel`) that takes its content as children: the manager's panel in build step 3 reuses it.

**Files:**
- Create: `src/renderer/src/panel/SidePanel.tsx`, `src/renderer/src/panel/panelPrefs.ts` (+ `panelPrefs.test.ts`)
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app.css`, `src/renderer/src/tasksStore.ts` (adds `panelOpen`), `e2e/tasks.ts`
- Create test: `e2e/panel.e2e.ts`

**Interfaces:**
- Consumes: `StatusGlyph`, `glyphOf` and `stateLabel` (Task 6), for `panel-show`.
- Produces in `panelPrefs.ts`:
  - `interface PanelPrefs { width: number; pinned: boolean }` and `DEFAULT_PANEL_PREFS = { width: 640, pinned: true }`.
  - `clampWidth(width: number, windowWidth: number, pinned: boolean): number`. The range is from 420 to `windowWidth − 360` when pinned (room for the board), or to `windowWidth − 80` when unpinned. The minimum wins when the window is too narrow.
  - `loadPanelPrefs(storage: Pick<Storage, 'getItem'>): PanelPrefs`, which falls back to the defaults on a missing or bad value, and `savePanelPrefs(storage: Pick<Storage, 'setItem'>, prefs: PanelPrefs): void`. The key is `thesource.panel`.
- Produces in `tasksStore`: `panelOpen: boolean` and `setPanelOpen(open: boolean)`. Selecting a task (card, Answer, Reopen, New task, Ctrl+Tab) sets it to true.
- Produces, test ids: `side-panel` (with `data-pinned` and `data-open`), `panel-resize` (`role="separator"`, `aria-orientation="vertical"`, `aria-valuenow` = the width, focusable; ArrowLeft and ArrowRight change the width by 16), `panel-pin` (`aria-pressed`), `panel-hide`, `panel-show`, `board`.

Layout:
- The toolbar and board form the left column. The panel runs the full height of the window on the right; the toolbar doesn't cross it.
- **Pinned:** the panel is the left column's flex sibling at `width`.
- **Unpinned:** the panel is positioned over the board's right edge at `width`, with a shadow, and the board takes the full width.
  - It shows while `panelOpen` is true. A `mousedown` on the board outside any card sets `panelOpen` to false.
  - It hides with `transform: translateX(100%)` and then `visibility: hidden`, never `display: none` and never a width change, so the terminals keep their size (Review Focus 3). The slide takes 220 ms with Parallel Code's `--ease-out`.
  - `panel-hide` is a 16×44 px pill straddling the panel's left edge, vertically centred, shown only while unpinned (title `Hide panel`, a › chevron). It sets `panelOpen` to false and moves the focus to `panel-show`.
  - `panel-show` is the hidden panel's way back: a half pill on the window's right edge, vertically centred, shown only while unpinned and hidden (title `Show panel`). It holds the selected task's `StatusGlyph` above a ‹ chevron, so a hidden session that needs the owner shows from there. It fades in once the panel has slid out. It sets `panelOpen` to true and moves the focus to `panel-hide`, so the keyboard never ends up in a hidden panel.
- Dragging `panel-resize` sets the width live (`clampWidth`) and saves it on release. A window resize re-clamps it.
- With nothing selected, the panel shows `Select a session on the board` (the manager comes in step 3).

- [ ] **Step 1: Write the failing tests**

`panelPrefs.test.ts`:
- `clampWidth keeps room for the board when pinned`: `clampWidth(2000, 1400, true)` is 1040, `clampWidth(100, 1400, true)` is 420, `clampWidth(1350, 1400, false)` is 1320 and `clampWidth(700, 600, true)` is 420.
- `prefs round-trip, and a bad stored value gives the defaults`, for `'{'`, `'{"width":"x"}'` and a missing key.

`panel.e2e.ts`:
- `dragging the panel's edge sets its width, and a restart keeps it`. Use `page.mouse` from the separator's centre 200 px to the left. The panel is 200 px wider, within 2 px. After a relaunch with the same `dataDir`, it is still that width.
- `the pinned panel sits beside the board`: the board's right edge is at or left of the panel's left edge.
- `unpinned, the panel hides when the board is clicked and comes back when a card is clicked, without resizing the terminal`.
  - Record `termSize` first, then click `panel-pin`. Click the board's empty area: `data-open` is `false`. Click the card: `data-open` is `true`.
  - Click `panel-hide`: `data-open` is `false`, and `panel-show` is visible and focused. Click it: `data-open` is `true`.
  - `termSize` is unchanged throughout, and `stty size` in the shell matches it.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/renderer/src/panel` then `npm --prefix <root> run test:e2e -- panel`
Expected: FAIL.

- [ ] **Step 3: Implement `SidePanel` and the layout**

Invoke `frontend-design:frontend-design` first.
- The panel has an 8 px margin from the window's edges, a `--task-container-bg` fill, a 1 px `--island-border` border and a 12 px radius. Unpinned, it adds the shadow `-24px 0 60px rgba(0, 0, 0, 0.6)`.
- The resize handle is an 8 px strip over the panel's left edge. It shows a 2 px `--accent` line on hover, on focus and while dragging.
- The pin button sits at the top right of the panel. It is an icon toggle, `--accent` while pinned, with the title `Unpin panel` or `Pin panel`.

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test`, `npm --prefix <root> run typecheck`, `npm --prefix <root> run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/renderer e2e
git -C <root> commit -m "feat: full-height session panel with a draggable width and pin/unpin"
```

---

### Task 8: Panel contents: header, changed files, message field

**Files:**
- Create: `src/renderer/src/panel/SessionPanel.tsx`, `src/renderer/src/panel/ChangedFiles.tsx`, `src/renderer/src/panel/MessageField.tsx`, `src/renderer/src/terminal/sendMessage.ts` (+ `sendMessage.test.ts`)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` (adds `changedFiles`), `src/renderer/src/App.tsx`, `src/renderer/src/app.css`, `THIRD_PARTY_NOTICES.md` (lists `sendMessage.ts`, from `src/store/tasks.ts` `sendPrompt`)
- Create test: `e2e/session-panel.e2e.ts`

**Interfaces:**
- Consumes: `TaskService.changedFiles` (Task 4), the terminal registry's `getTerminal(sessionId)` (plan 1).
- Produces on the bridge: `changedFiles(taskId: string): Promise<ChangedFile[] | null>`, on channel `tasks:changed-files`.
- Produces in `sendMessage.ts`:
  - `cleanMessageText(text: string): string`. It turns CRLF and CR into LF. It strips C0 controls except `\n` and `\t`, DEL, C1 controls, and the invisible characters U+200B–U+200F, U+202A–U+202E, U+2060–U+2064 and U+FEFF. Claude Code holds a paste that contains them instead of submitting it (Parallel Code).
  - `submitDelayMs(text: string): number` is `min(500, max(50, lines × 15))`.
  - `sendMessage(term: Terminal, text: string, schedule?: (fn: () => void, ms: number) => void): void`.
    1. When `term.modes.sendFocusMode` is on, `term.input('\x1b[I')`, because the message field holds the focus and xterm told the program it lost it.
    2. `term.paste(cleaned)`, which adds bracketed-paste markers when the program asked for them and turns LF into CR.
    3. After `submitDelayMs`, `term.input('\r')`.
- Consumes: `StatusGlyph`, `glyphOf`, `stateLabel` and `cardAge` (Task 6).
- Produces, test ids: `panel-title`, `panel-project`, `panel-branch`, `panel-state`, `close-session`, `panel-reopen`, `changed-files` (with `data-count`), `changed-file` (with `data-status`), `message-field`, `message-send`.

Header (two rows, then the header's one divider, a 1 px `--border-subtle` line):
- **Title bar:** the task's `StatusGlyph` at md, then the title in Sora 600 at 17 px, one line with an ellipsis (its `title` attribute holds the whole title). On the right: **Close session** (a stop-square icon) while running, **Reopen** (a circular-arrow icon) when closed, then the pin toggle from Task 7. Its empty space is a window drag region (`-webkit-app-region: drag`, buttons `no-drag`), like the top bar.
- **Branch bar:** the project colour bar and name, the branch with a branch icon in 12 px JetBrains Mono (`--fg-subtle`), and on the right `panel-state`: the `stateLabel` in its tone and `cardAge` in `--fg-subtle`.
- A closed task that has no terminal in this app run (closed before the last start) shows `Closed. Reopen continues this chat.` in the well instead.

Changed files:
- A pane heading, 32 px tall, 12 px weight 500 in `--fg-muted`: a chevron, `N files changed`, and on the right the summed `+added` (`--success` mixed 75% with `--fg-muted`) and `−removed` (`--error` mixed 65%), in 11 px JetBrains Mono. It reads `No changes yet`, or `Worktree removed` when the result is null; then it has no chevron and doesn't toggle.
- The list is open by default, and the heading collapses it. It scrolls after 128 px.
- Each row shows the status letter, the path and the row's `+added −removed` on the right, in 12 px JetBrains Mono on a 22 px line. A is `--success`, M `--warning`, D `--error`, and `?` shows as `U` in `--fg-subtle`. Paths are cut from the start when long. Null counts show nothing.
- It refreshes when the task is selected, and every 5 s while it stays selected and `document.visibilityState` is `visible` (Parallel Code `ChangedFilesList.tsx` polls the same way).

Terminal: the well has an 8 px radius and a 1 px `--island-border` border. While the terminal has the focus, the border is `--border-focus` with a 1 px ring of it.

Message field:
- A box under the terminal: `--bg-input`, a 1 px `--border-subtle` border and an 8 px radius. While it has the focus, the border is `--border-focus` with a 2 px ring of `--accent` at 12%.
- It holds a textarea, 14 px Inter, that grows to 8 lines. Under it is a footer with the hint `Enter sends it to the session. Shift+Enter adds a line.` (12 px, `--fg-subtle`) and `message-send`, a 28 px ↑ button, disabled while the text is blank.
- Enter or `message-send` sends; Shift+Enter adds a line (as in Parallel Code).
- The placeholder is `Message this session`, or `Claude is waiting for your answer in the terminal` while the session is blocked.
- While the task is closed, the field is disabled with the placeholder `Reopen the session to send it a message`, and the hint is hidden.
- An empty or blank message is not sent. The field clears after sending and keeps the focus.

- [ ] **Step 1: Write the failing tests**

`sendMessage.test.ts`:
- `cleanMessageText keeps text, newlines and tabs and drops what holds a paste`: `'a\r\nb\rc\td​e\x1b[31mf\x7f'` gives `'a\nb\nc\tde[31mf'`.
- `submitDelayMs grows with the lines, from 50 to 500 ms`: one line gives 50, 10 lines 150, 100 lines 500.

`session-panel.e2e.ts`:
- `the header shows the task, project and branch, with Close session and then Reopen`.
- `changed files lists what the task changed in its worktree`.
  - On `makeRepo()`, start `Fix login`. Then the test does what `claude -w` would: `git -C <main> worktree add -b worktree-fix-login <main>/.claude/worktrees/fix-login origin/stage`, a committed `a.txt`, and an untracked `u.txt`.
  - Within 7 s, `changed-files` has `data-count="2"`, and its open list shows `a.txt` (A, `+1`) and `u.txt` (?, no counts).
- `the message field sends one line as typed`: `echo msg-$((2+2))` then Enter gives `msg-4` on screen. `echo msg-$((3+3))` sent with `message-send` gives `msg-6`.
- `several lines arrive as one bracketed paste, then Enter`. Run `printf '\033[?2004h'; cat -v`, then type `first`, Shift+Enter, `second` into the field and press Enter. The screen shows `^[[200~first` and `second^[[201~`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/renderer/src/terminal/sendMessage.test.ts` then `npm --prefix <root> run test:e2e -- session-panel`
Expected: FAIL.

- [ ] **Step 3: Implement the panel contents**

Invoke `frontend-design:frontend-design` first. The panel is laid out from top to bottom: the header, the changed files, the terminal (filling the rest) and the message field.

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test`, `npm --prefix <root> run typecheck`, `npm --prefix <root> run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src e2e THIRD_PARTY_NOTICES.md
git -C <root> commit -m "feat: session header, changed files and a message field in the panel"
```

---

### Task 9: Ctrl+Tab to the next session that needs you

**Files:**
- Create: `src/renderer/src/board/shortcuts.ts`
- Modify: `src/renderer/src/board/lanes.ts` (+ test), `src/renderer/src/App.tsx`, `THIRD_PARTY_NOTICES.md` (lists `lanes.ts` `nextNeedsYou`, from `src/components/next-attention-task.ts`)
- Create test: `e2e/shortcuts.e2e.ts`

**Interfaces:**
- Produces in `lanes.ts`: `nextNeedsYou(queue: string[], current: string | null, step: 1 | -1): string | null`.
  - It wraps around and returns null for an empty queue.
  - When `current` isn't in the queue, it starts from the first entry (step 1) or the last (step −1).
- Produces in `shortcuts.ts`: `installBoardShortcuts(target: Window, jump: (step: 1 | -1) => void): () => void`.
  - A capture-phase `keydown` listener. Ctrl+Tab gives `jump(1)` and Ctrl+Shift+Tab gives `jump(-1)`, without Cmd or Option. Each calls `preventDefault` and `stopPropagation`, so the terminal never sees the key.
  - On macOS it is Ctrl, because Cmd+Tab is the system app switcher (as in Parallel Code).
  - The jump selects the task, opens the panel and focuses its terminal. Nothing happens when nothing needs the owner.
- Produces, test id: `jump-next`. It's a quiet button in the top bar after the project chip, showing the keys `Ctrl` `Tab` as keycaps and the words `Next that needs you`, in `--fg-subtle`. It calls `jump(1)`, and makes the shortcut easy to find.

The queue is the Needs you lane in board order (spec §7.1). Ctrl+Shift+Tab, going backwards, is Parallel Code's, and costs one condition.

- [ ] **Step 1: Write the failing tests**

`lanes.test.ts` gains `nextNeedsYou cycles the queue and starts at its end when nothing in it is selected`. With queue `['a','b','c']`:
- `(…, 'a', 1)` gives `'b'` and `(…, 'c', 1)` gives `'a'`.
- `(…, 'a', -1)` gives `'c'`.
- `(…, null, 1)` gives `'a'`, `(…, 'x', 1)` gives `'a'` and `(…, null, -1)` gives `'c'`.
- `(['a'], 'a', 1)` gives `'a'`, and `([], null, 1)` gives `null`.

`shortcuts.e2e.ts`: `Ctrl+Tab goes through the sessions that need you, from the terminal too`.
- Start tasks A, B and C, and make A and C blocked with `printf`.
- Select B and type `ech` into its terminal, without Enter.
- `Control+Tab` selects A. Again, it selects C, then A. `Control+Shift+Tab` selects C. Clicking `jump-next` selects A.
- Then select B and press Enter. The screen shows `ech: command not found`. A Tab that reached B's shell would have completed `ech` to `echo`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/renderer/src/board` then `npm --prefix <root> run test:e2e -- shortcuts`
Expected: FAIL.

- [ ] **Step 3: Implement `nextNeedsYou` and `installBoardShortcuts`**, installed once in `App` with `onCleanup`.

- [ ] **Step 4: Run them to see them pass**

Run: `npm --prefix <root> test`, `npm --prefix <root> run typecheck`, `npm --prefix <root> run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src e2e THIRD_PARTY_NOTICES.md
git -C <root> commit -m "feat: Ctrl+Tab jumps to the next session that needs the owner"
```

---

### Task 10: Acceptance with the owner, in Damela, with real Claude Code

**Files:**
- Create: `docs/superpowers/findings/<YYYY-MM-DD>-plan-2a-acceptance.md`

The e2e tests run a fake `claude`, so they can't check five things: what Claude Code does with the launch forms, the hook in real use, the merge flow, startup timing, and the feel. Here the owner works at the keyboard on one small real Damela card that they pick, and the agent records what happens.
- Start the app with `THESOURCE_LOG_OSC=1 npm --prefix <root> start`, after `npm --prefix <root> run build`.
- Check the results with `git -C <damela> worktree list`, `git -C <damela> branch --list 'worktree-*'` and the files under `<dataDir>/tasks/<taskId>/`.
- Record each check as a row with what was done, what was seen, and pass or fail, in the style of `docs/feel-test.md`.

- [ ] **Step 1: Write the checklist file and run it with the owner**

1. **New task.**
   - The session starts in `<damela>/.claude/worktrees/<slug>` on `worktree-<slug>`, and its `pwd` shows that path.
   - The card goes to Working.
   - Copy the `[osc7501]` lines from startup. Does an `idle` come before the first `working`? Does the card stay in Working, without flashing through Needs you?
2. **Needs you.**
   - A permission prompt or a question puts the card under Needs you, with Claude's own line.
   - Answer opens the session, and Ctrl+Tab cycles through the sessions that need the owner.
3. **Message field.** A multi-line message arrives as one prompt (`[Pasted text …]` for long text) and is submitted.
4. **Changed files** match `git -C <worktree> status` plus the branch's commits.
5. **Close session, then Reopen.** This is the combination the findings didn't try (findings §11.4, "For plan 2").
   - Close shows no keep/remove question. The worktree and branch are still listed, with the worktree locked.
   - Reopen runs `claude --worktree <slug> --resume <id>`. The same chat continues, and `pwd` is the worktree.
   - If this fails, switch `reopenArgv` to plain `--resume` while the branch exists. Row d showed that it returns to the worktree after a kill. Add a test for the switch, and record it.
6. **`/clear`, then Close, then Reopen.**
   - `session-start.json` holds the new `session_id` with `"source":"clear"`.
   - Reopen continues the conversation after the clear. Docs imply this, but it wasn't tested (research of 2026-11-05).
7. **Quit with two tasks running, then start again.** Both come back in their worktrees and continue their chats.
8. **One real merge, from start to finish** (findings, consequence 5).
   1. In the session: `/code-review high`, the merge menu (the owner picks merge locally), ExitWorktree keep, the squash merge into `stage` in the main checkout, `git push origin stage`, and removing the symlinks, the worktree and the branch, all as Damela's CLAUDE.md says.
   2. While the session waits for the owner's merge choice, what does its card say? If the merge menu comes as a question (AskUserQuestion), the card shows it as `answer: …`. If it comes as plain text, the card shows `Finished its turn`. Spec §7.3 wants "ready: asks to merge", and OSC 7501 alone can't tell that apart from any other turn end. Record which one happens: it decides whether plan 2b adds a Stop hook (its `last_assistant_message`) for the card line.
   3. Afterwards, New task shows no start-check warning.
   4. Close and Reopen continue the chat in the main checkout (plain `--resume`).
9. **Feel.** Dragging the panel, pinning and unpinning, the board with 6–8 sessions, typing in the panel's terminal. Same as in the feel test, or worse? Do the card moves help you follow what changed, or distract while you type? Do they stay smooth while several sessions report at once? Does the board match the mockup?

- [ ] **Step 2: Fix what failed**

A failure with a clear cause gets a test where one can pin it, the fix, `npm --prefix <root> test` and `npm --prefix <root> run test:e2e`, a fresh build, and the owner re-checks that row. Anything else goes in the file as open, for the owner to decide.

- [ ] **Step 3: Commit**

```bash
git -C <root> add docs/superpowers/findings src e2e
git -C <root> commit -m "docs: plan 2a acceptance in Damela"
```

---

## After this plan

- **Plan 2b, Trello:**
  - The TODO lane left of Needs you, with card details and Start.
  - Start next card, the top card without the "You" label. Moving the card to In Progress.
  - The API key and token in the macOS Keychain.
  - The opening prompt gains the card's link, number, labels and checklists, and Needs you sorts Blocker cards first, then by TODO rank.
  - The panel header gets the card link.
- **Step 2, the merge turn:** spec §8, with the waiting `request_merge_turn` MCP call (findings §11.6). `--mcp-config` joins the launch forms. Mind that `--mcp-config` takes several values, so the prompt must not come right after it.
- **Step 3, the manager:** runs in the same `SidePanel` shell (Task 7) when no session is selected, full height, resizable and pinnable as the owner asked.
- **Left out on purpose:**
  - Discard (spec §7.7) and History (spec §10 step 4).
  - Sessions outside the app (spec §7.7, from `claude agents --json`): the step 1 list in §10 doesn't name them.
  - Hiding Closed tasks: until step 2 adds Merged today, the Closed lane keeps every closed task.
  - The "ready: asks to merge" card line (spec §7.3) depends on Task 10, check 8.
