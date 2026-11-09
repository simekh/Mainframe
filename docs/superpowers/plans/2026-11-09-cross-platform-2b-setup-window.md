# Cross-platform plan 2b: the setup window

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first time someone runs Mainframe, the main window opens on a terminal-style setup screen that finds git and Claude Code, asks only for what it can't find, and asks for the first project; later starts check silently and come back to the screen only at a step that fails. Every session, the manager and the sync then launch the saved, checked claude.

**Architecture:** Main creates the window before anything else and runs a `SetupFlow` (pure, unit-tested, Electron-free) that reads an app-wide `settings.json`, checks git and claude (`git --version`, `claude --version` against a minimum, run directly with no shell), and either starts the projects at once or publishes a `SetupView` that the renderer shows as the setup screen. The screen's buttons call back into the flow; once it has a checked claude and (on a first start) a project, the flow calls `start` with the absolute claude path, as 2a's `findPrograms` lookup did.

**Tech Stack:** TypeScript 5.9, Electron 44, SolidJS, vitest 5, Playwright 1.64, Node 26 LTS.

**Spec:** `docs/superpowers/specs/2026-11-09-mainframe-cross-platform-design.md` §4 (all of it), with §3 (what a user needs) and §12–§13. Approved mockup: `docs/superpowers/mockups/2026-11-09-cross-platform-setup.html` (screens 1–2; screen 3 is plan 2c). Plan 2a (`docs/superpowers/plans/2026-11-09-cross-platform-2a-windows-runs-and-ci.md`) is done; its findings are `docs/superpowers/findings/2026-11-09-cross-platform-2a-ci.md`.

## Global Constraints

- **Newest versions only (owner):** Node's newest LTS and its npm, current Claude Code, Windows 11, current macOS and Linux. No workaround for an older version.
- **Minimum Claude Code: `2.1.295`** (OSC 7501 status reports and hook `onFailure` need it; exec-form hooks 2.1.139; `--permission-prompts none` 2.1.259). One constant, `MIN_CLAUDE_VERSION`.
- **No shell anywhere in the product.** Programs are run directly (`execFile`, never `shell: true`). Mainframe never runs a `.cmd` or `.bat`.
- **Nothing changes on the Mac** for an existing install (spec anti-goal): the owner's Mac with projects open never sees the welcome; its start-up check is silent when everything works.
- **Project-agnostic and several projects at once** (root `CLAUDE.md`): setup texts name generic places only (`~/.local/bin`, `%USERPROFILE%\.local\bin`, "npm's global folder"); the settings file is app-wide, the same for every open project.
- **`MAINFRAME_CLAUDE_BIN` wins over everything:** when set, only that path is checked (version included) and nothing is saved.
- **Test-only paths stay behind `MAINFRAME_E2E=1`.** Platform logic takes the platform (and the env it reads) as parameters, so a test on any system can pass `'win32'`.
- **UI work uses the `frontend-design` skill** (owner's global `CLAUDE.md`), within Mainframe's own tokens (`app.css` `:root`) and its monospace font.
- **No dependency upgrades.**
- **No e2e run on the owner's Mac while their Mainframe runs:** run `pgrep -fl "Simmesolo/Mainframe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"` as its own command first; run e2e only if it prints nothing.
- **Dead code the change makes unreachable is removed** (listed per task); dead code elsewhere is pointed out.
- **Commits:** `type: what it does`; no attribution. Bash: absolute paths, `git -C <worktree>`, never `cd` chained with a command.
- **Pushes happen only in Task 7**, each after recording the tip in both gate records and a `Skip record:` line in this plan's ledger (spec §11). `/simplify` and `/code-review high` run once for the whole branch after plan 2c.

**Facts checked 2026-11-09** (re-check anything else against current docs while building):
- Claude Code's native installer puts `claude` at `~/.local/bin/claude` (macOS, Linux; a symlink into `~/.local/share/claude/versions/`) and `%USERPROFILE%\.local\bin\claude.exe` (Windows), and doesn't edit PATH. Homebrew and WinGet put it on PATH. npm on Windows: the real executable is `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` once its postinstall has run; before that (npm 12 skips postinstall by default) that file is a small placeholder script that doesn't run. `claude.cmd` is npm's launcher and is never run.
- `claude --version` prints `2.1.319 (Claude Code)` and needs no TTY, login or network (~30 ms). Judge by the output, not the exit code.
- `git --version` prints `git version 2.56.0` (Windows: `git version 2.56.0.windows.1`).
- Electron 44 `dialog.showOpenDialog`: `message` shows only on macOS, `title` everywhere; filter extensions have no dot (`['exe']`). Setup docs: `https://code.claude.com/docs/en/setup`. Git downloads: `https://git-scm.com/downloads`.

## Review Focus

1. **A saved claude that has moved, with a working claude elsewhere on the search list** (Claude Code reinstalled another way): the start stays silent, saves the new path, and shows no setup screen. Task 2.
2. **`MAINFRAME_CLAUDE_BIN` set:** only that path is checked, nothing is written to `settings.json` (a saved path stays as it was), and Find claude… isn't offered. Tasks 2 and 6.
3. **An old or broken claude first in the search order** (an old npm install on PATH, the npm placeholder on Windows) while a good one sits in the native folder: the good one is used; with no good one anywhere, the screen says too old or doesn't run, with the matching advice, never "found". Task 1.
4. **A `settings.json` that is garbled, or written by a newer Mainframe:** garbled is treated as missing with a warning; newer stops the start with a clear message and is left untouched (as `projects.json` does). Task 2.
5. **Cancelling a dialog or quitting mid-setup:** a cancel leaves the screen where it was; a quit before the first project is chosen records no welcome, so the welcome shows again on the next start, and ends the app cleanly with no project started. Tasks 2 and 6.

## Before Task 1

Create this plan's ledger, `.superpowers/sdd/2026-11-09-cross-platform-2b-setup-window/progress.md`, and copy into it every `Skip record:` line from plan 2a's ledger (`.superpowers/sdd/2026-11-09-cross-platform-2a-windows-runs-and-ci/progress.md`, including the Windows diagnosis pushes). Baseline: `npm test` and `npm run typecheck` pass on the Mac.

---

### Task 1: Finding and checking git and claude

**Files:**
- Create: `src/main/setup/programChecks.ts`, `src/main/setup/programChecks.test.ts`

**Interfaces:**
- Consumes: `findExecutable`, `ExecutableFiles`, `ExecutableLookup` (`src/main/pty/findExecutable.ts`).
- Produces, in `programChecks.ts`:
  - `const MIN_CLAUDE_VERSION = '2.1.295'`
  - `type CheckState = 'found' | 'missing' | 'too-old' | 'broken'` and `interface ProgramCheck { state: CheckState; path?: string; version?: string }` (exported from `src/shared/types.ts`, so the renderer shares them)
  - `type VersionRunner = (file: string, args: string[]) => Promise<string | null>` (stdout, or null when it can't run, times out or fails)
  - `runVersion(env: Record<string, string>): VersionRunner`: `execFile(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 10_000 })`, stdout on success, null on any error
  - `parseClaudeVersion(stdout: string): string | null` (`/^(\d+\.\d+\.\d+) \(Claude Code\)$/` on the trimmed output, so a wrong file picked by hand that prints some other version isn't taken for claude)
  - `isAtLeast(version: string, min: string): boolean` (numeric, part by part)
  - `claudePlaces(lookup: ExecutableLookup): string[]`: the search list after the saved path, in order, without duplicates: `findExecutable('claude', lookup)` (PATH), then the native installer's file (`<HOME>/.local/bin/claude` on POSIX, `<USERPROFILE>\.local\bin\claude.exe` on win32, from `lookup.env`), then on win32 npm's `<APPDATA>\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`; a place whose env key is missing is left out; built with `path.win32` / `path.posix` for `lookup.platform`. (On macOS and Linux npm's `claude` sits beside `node`, whose folder is on PATH since Mainframe found node there, so PATH covers it.)
  - `checkClaude(path: string, run: VersionRunner, files: ExecutableFiles): Promise<ProgramCheck>`: not an executable file → `missing`; no parseable version → `broken`; below the minimum → `too-old` (with `version`); else `found` (with `version`); `path` always set
  - `findClaude(o: { fromEnv?: string; saved?: string; lookup: ExecutableLookup; run: VersionRunner }): Promise<ProgramCheck>`: with `fromEnv`, only `checkClaude(fromEnv)`; else `saved` (when set) then `claudePlaces`, returning the first `found`; with none found, the most useful failure: `too-old` before `broken` before `missing` (a `missing` result carries no path)
  - `checkGit(lookup: ExecutableLookup, run: VersionRunner): Promise<ProgramCheck>`: `findExecutable('git', lookup)`; not found → `missing`; `git --version` not matching `/git version (\S+)/` → `broken`; else `found` with `path` and `version` (`2.56.0.windows.1` → keep the whole token)

- [ ] **Step 1: Write the failing tests.** A fake `files(...paths)` and a fake `run` mapping path → stdout (or null). Cases: `parseClaudeVersion('2.1.319 (Claude Code)\n') === '2.1.319'`, `parseClaudeVersion('nope') === null`, `parseClaudeVersion('v26.1.0') === null`, `parseClaudeVersion('1.2.3') === null`; `isAtLeast('2.1.295', MIN_CLAUDE_VERSION)`, `isAtLeast('2.10.0', '2.9.9')`, `!isAtLeast('2.1.294', MIN_CLAUDE_VERSION)`; `claudePlaces` on `'darwin'` with `{ PATH: '/usr/bin', HOME: '/Users/x' }` → `['/Users/x/.local/bin/claude']` when PATH has none, and PATH's hit first when `/usr/bin/claude` exists; on `'win32'` with `{ Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }` → `['C:\\Users\\x\\.local\\bin\\claude.exe', 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe']`; `checkClaude` for each state; `findClaude` with `fromEnv` never looks elsewhere (even when the saved path is good); a saved path that's gone falls through to the native folder (Review Focus 1's lookup half); **Review Focus 3:** PATH's claude prints `2.1.100 (Claude Code)` and the native one `2.1.319 (Claude Code)` → the native one, `found`; with only the win32 npm placeholder (`run` → null) → `broken` with its path; with only the old one → `too-old`; nothing anywhere → `{ state: 'missing' }`; `checkGit` found / missing / broken, and `git version 2.56.0.windows.1` → version `2.56.0.windows.1`. One test runs `runVersion(process.env)` on `process.execPath` with `['--version']` and gets Node's version string; one runs it on a missing file and gets null.
- [ ] **Step 2: Run:** `npx vitest run src/main/setup/programChecks.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `programChecks.ts` and move `CheckState`/`ProgramCheck` into `src/shared/types.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5: Commit:** `feat: Mainframe finds git and claude, checks claude's version against the minimum, and never runs a launcher script`

### Task 2: The settings file and the setup flow

**Files:**
- Create: `src/main/setup/settings.ts`, `src/main/setup/settings.test.ts`, `src/main/setup/setupFlow.ts`, `src/main/setup/setupFlow.test.ts`
- Modify: `src/main/config.ts`, `src/main/config.test.ts`, `src/main/projects.ts`, `src/main/projects.test.ts`, `src/shared/types.ts`, `src/main/index.ts` (only what `claudeBin?: string` needs to compile)

**Interfaces:**
- Consumes: Task 1's `findClaude`, `checkGit`, `checkClaude`, `VersionRunner`, `ProgramCheck`.
- Produces:
  - `settings.ts`: file `settings.json` in the data folder, `{ "version": 1, "claudeBin"?: string, "welcomeSeen"?: true }`. `interface AppSettings { claudeBin?: string; welcomeSeen?: boolean }`; `readSettings(dataDir: string, warn: (m: string) => void): AppSettings` (missing → `{}`; unreadable or wrong shape → warn, `{}`; `version > 1` → throws `settings.json was written by a newer Mainframe; update this one, or move the file away`); `writeSettings(dataDir: string, s: AppSettings): void` via `writeJsonAtomic`. Copy `projects.ts`'s reading pattern.
  - `config.ts`: `AppConfig.claudeBin` becomes `claudeBin?: string` (undefined when `MAINFRAME_CLAUDE_BIN` is unset; an empty value still throws).
  - `projects.ts` gains `rememberedProjects(dataDir: string, warn: (m: string) => void): string[]` (the remembered folders that still exist; no picker, no write) and `hasProjectsFile(dataDir: string): boolean`. `chooseProjects` stays until Task 4 stops calling it and removes it.
  - `src/shared/types.ts`: `interface SetupView { intro: 'welcome' | 'moved'; git: ProgramCheck; claude: ProgramCheck; claudeFromEnv: boolean; lookedAgain: boolean; askProject: boolean; platform: NodeJS.Platform }`.
  - `setupFlow.ts`: `interface SetupDeps { dataDir: string; envClaudeBin?: string; lookup: ExecutableLookup; run: VersionRunner; pickClaude(): Promise<string | undefined>; pickFolder(): Promise<string | undefined>; onChange(view: SetupView | null): void; start(claudeBin: string, projectDirs: string[]): Promise<void>; warn(m: string): void }` and `class SetupFlow { constructor(deps: SetupDeps); begin(): Promise<void>; view(): SetupView | null; lookAgain(): Promise<void>; findClaude(): Promise<void>; chooseProject(): Promise<void> }`. `view()` is null while no screen is needed (before `begin` settles and once started).

Behaviour of `SetupFlow` (spec §4.4):
- **First start** = no `projects.json` and no `welcomeSeen`. Anything else is a later start.
- `begin` reads the settings and runs `checkGit` and `findClaude({ fromEnv: envClaudeBin, saved: settings.claudeBin, … })` concurrently.
  - Later start, both found: save the claude path if it differs from the saved one and isn't `envClaudeBin`, publish nothing, and `await start(claude.path, rememberedProjects(...))` before `begin` resolves (an empty list starts the board on its "No project open" state).
  - First start, both found: publish `{ intro: 'welcome', askProject: true }`.
  - Any check failing: publish `{ intro: firstStart ? 'welcome' : 'moved', askProject: false }`.
- `lookAgain` re-runs the failing checks; sets `lookedAgain` when one is still failing; when all pass, continues as `begin` would (later start → start; first start → `askProject`).
- `findClaude` (not offered with `envClaudeBin`): `pickClaude()`; undefined → nothing changes; else `checkClaude(picked)`; `found` → saved and shown; otherwise shown with its state and path.
- `chooseProject`: `pickFolder()`; undefined → nothing changes (Review Focus 5); else write `{ claudeBin (unless envClaudeBin), welcomeSeen: true }`, `await start(claude.path, [dir])`, then publish null (so the board appears only once its projects answer). `welcomeSeen` is written only here, so quitting earlier shows the welcome again.

- [ ] **Step 1: Write the failing tests.** `settings.test.ts`: round trip; missing → `{}`; garbled JSON and a wrong shape → `{}` and one warning; `version: 2` → throws, file untouched (Review Focus 4). `config.test.ts`: unset → `claudeBin: undefined`. `projects.test.ts`: `rememberedProjects` keeps existing folders and drops a gone one; `hasProjectsFile` true/false. `setupFlow.test.ts`, with fake `run`/files and spy deps: first start all found → view welcome+askProject, `start` not called; `chooseProject` → settings hold `claudeBin` and `welcomeSeen: true`, `start(path, [dir])` called before the null view is published; cancel → unchanged, no write; later start all found → `start` called with remembered projects before `begin` resolves, view stays null; **Review Focus 1:** saved path gone, native folder good → `start` with the native path, settings updated, no view ever published; **Review Focus 2:** `envClaudeBin` set (and a different saved path) → only it checked, settings' `claudeBin` never written, `claudeFromEnv: true` in a failing view; later start with claude missing → `intro: 'moved'`; `lookAgain` still missing → `lookedAgain: true`; `lookAgain` after a fix on a later start → `start`; `findClaude` picking a too-old file → shown `too-old`, not saved; git missing → view with git `missing`.
- [ ] **Step 2: Run:** `npx vitest run src/main/setup src/main/config.test.ts src/main/projects.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `index.ts`, the only change is what `claudeBin?: string` needs (`findPrograms` looks up `config.claudeBin ?? 'claude'` until Task 4 replaces it).
- [ ] **Step 4: Run** the same command, then `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: an app-wide settings file and a setup flow that starts silently when everything works and says what to fix when not`

### Task 3: The e2e stand-in answers `--version`, and launches skip the welcome

**Files:**
- Modify: `e2e/fake-claude.cjs`, `e2e/launch.ts`, `e2e/tasks.e2e.ts`

**Interfaces:**
- Produces: `fake-claude.cjs` answers `--version` (as `args[0]`) with `${process.env.FAKE_CLAUDE_VERSION ?? '2.1.999'} (Claude Code)\n` and exit 0, **before** it writes `<pid>.argv` (so the check is never counted as a launch) and before the bridge branch. `launchApp(env = {}, projects = os.tmpdir(), o: { firstStart?: boolean; settings?: AppSettings } = {})`: by default it writes `settings.json` with `{ welcomeSeen: true }` (through `writeSettings` from `src/main/setup/settings`, which must stay Electron-free) beside `projects.json`; `settings` is written instead when given; with `firstStart` it writes neither file. An `env` value of `undefined` removes that variable from the app's environment (for the setup tests to unset `MAINFRAME_CLAUDE_BIN`).

- [ ] **Step 1:** Add the `--version` branch and the launch option.
- [ ] **Step 2:** `tasks.e2e.ts:176` and `:198` launch with `MAINFRAME_CLAUDE_BIN: '/nonexistent/claude'` to show a task whose claude can't start. The setup check now catches that path at start (spec §4.4), so they copy the stand-in (`process.env.FAKE_CLAUDE_EXE ?? e2e/fake-claude.cjs`, keeping its executable bit) into the test's temp folder, launch with `MAINFRAME_CLAUDE_BIN` at the copy, delete the copy once the board shows, then start the task, and expect the terminal to name the copy's path (`resolveExecutable`'s "was not found, or is not an executable file"). Same assertions otherwise.
- [ ] **Step 3: Smoke-check:** `/Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform/e2e/fake-claude.cjs --version` prints `2.1.999 (Claude Code)`; with `FAKE_CLAUDE_LOG_DIR` set to a scratch folder, no `.argv` file appears.
- [ ] **Step 4:** `npm run typecheck`, `npm test`; the e2e suite only after the pgrep check (Global Constraints). Expected: 90 passed (unchanged behaviour; nothing in main reads `settings.json` yet).
- [ ] **Step 5: Commit:** `test: the e2e stand-in answers --version, launches record the welcome as seen, and the missing-claude tests remove claude after the start check`

### Task 4: Main opens the window first and runs the setup before the projects

**Files:**
- Modify: `src/main/index.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/projects.ts`, `src/main/projects.test.ts`

**Interfaces:**
- Consumes: Task 2's `SetupFlow`, `rememberedProjects`, `readSettings`; Task 1's `runVersion`.
- Produces: IPC `setup:get` → `SetupView | null` (awaits `begin`, so the page never flashes a screen it doesn't need, and a null answer means the projects are already started), event `setup:changed` (`SetupView | null`), and invokes `setup:look-again`, `setup:find-claude`, `setup:choose-project` (→ `Promise<void>`). `MainframeApi` gains `getSetup()`, `onSetup(cb)`, `setupLookAgain()`, `setupFindClaude()`, `setupChooseProject()`.

- [ ] **Step 1: Restructure `whenReady`:** config → `findPrograms` (now `{ env, nodeBin }` only; its `claudeBin` lookup and the `?? config.claudeBin` pass-through go) → `createWindow(config.e2e)` → `ipcMain.handle(IPC.getConfig, …)` (moved out of `registerIpc`, which no longer registers it) and the setup handlers → `app.on('second-instance', …)` focusing the window (moved out of `start`, so a second launch during setup brings the window forward) → `new SetupFlow({ …, lookup: { env, cwd: process.cwd(), platform: process.platform, files: localFiles }, run: runVersion(env), envClaudeBin: config.claudeBin, pickClaude, pickFolder, onChange: (v) => send(IPC.setupChanged, v), start: (claudeBin, dirs) => start(config, { ...programs, claudeBin }, dirs, win) })` → `flow.begin()`. `readSettings`'s newer-version error and `findPrograms`' no-node error still reach the "Mainframe could not start" box. Quitting during setup (the window closed, or Quit) ends the app with no project started; `beginQuit` copes with none.
- [ ] **Step 2: `start` takes the window** instead of creating it. Dead now, and removed: `chooseProjects` with its `pick` dependency and its tests (`rememberedProjects` replaces it), the zero-projects quit, and `pickProjectFolder`'s windowless branch. The folder dialog sets `title: 'Choose a project folder'` beside the Mac-only `message`. `pickClaude`: `dialog.showOpenDialog(win, { title: 'Find Claude Code', buttonLabel: 'Use this', properties: ['openFile'], filters: win32 ? [{ name: 'Programs', extensions: ['exe'] }] : undefined })`. Both dialogs are looked up at each call (e2e stubs them).
- [ ] **Step 3:** Wire preload and `MainframeApi`. The renderer doesn't use them until Task 5; with the welcome seeded, every existing e2e start still goes straight to the board.
- [ ] **Step 4:** `npm run typecheck`, `npm test`, then (after the pgrep check) `npm run test:e2e`. Expected: 90 passed.
- [ ] **Step 5: Commit:** `feat: Mainframe opens its window first and checks git and claude before any project starts, launching the saved, checked claude`

### Task 5: The setup screen

**Files:**
- Create: `src/renderer/src/setup/SetupScreen.tsx`, `src/renderer/src/setup/setupStore.ts`, `src/renderer/src/setup/setupCopy.ts`, `src/renderer/src/setup/setupCopy.test.ts`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app.css`

**Interfaces:**
- Consumes: Task 4's `MainframeApi` setup methods, `SetupView`, `ProgramCheck`.
- Produces: `setupCopy.ts`, pure: `checkLine(name: 'git' | 'claude', check: ProgramCheck | 'looking'): string` and `explanations(view: SetupView): { check: 'git' | 'claude' | 'project'; lines: string[]; buttons: SetupButton[] }[]` with `type SetupButton = 'find-claude' | 'install-claude' | 'install-git' | 'look-again' | 'choose-project'`: one block per failing check, git's first, then the new-terminal hint when it applies; `look-again` appears only in the last block (one Look again re-runs every failing check); each block's first button is its primary one. With every check found and `askProject`, the one block is the project question. Paths are shown in full.

Use the `frontend-design` skill. The screen fills the window (replacing `ProjectRail` + `Panes` while a view is set), keeps a top drag row for the Mac's window buttons (as `.rail-titlebar` does), and follows the mockup: `--font-mono` 13px/1.6 on `--terminal`, colours from the tokens (accent, fg, `--fg-subtle` for dim, success, error), `.btn`/`.btn.primary` buttons, selectable text. Lines appear one after another (about 60 ms apart); a click or any key shows the rest at once; under `prefers-reduced-motion: reduce` all lines show at once. While Look again runs, the failing lines read `looking…`; a new view (after Look again or Find claude…) updates the lines in place without retyping the welcome. `App` asks `getSetup()` after `getConfig()` (keeping `installE2eHooks` where it is, so `launchApp` still finds `__mainframeE2E`) and renders neither the screen nor the board until it answers; it shows the screen while the view is non-null; `loadProjects()` moves from `onMount` to the moment the view is null (from `getSetup()` or `onSetup(null)`), because main registers the project calls only once the projects start. Buttons: `find-claude` → `setupFindClaude()`; `install-claude` → `openLinkLogged('https://code.claude.com/docs/en/setup', …)`; `install-git` → `https://git-scm.com/downloads`; `look-again` → `setupLookAgain()`; `choose-project` → `setupChooseProject()`. The `data-testid`s: `setup`, `setup-git`, `setup-claude`, and `setup-<button>` for each button.

Copy (exact; `{…}` are values; the welcome's logo and three paragraphs are the mockup's screen 1, verbatim):
- Check lines: `› git`/`› claude`, then `found  {detail}  ✓` (git detail `git {version}`; claude `{path} · v{version}`), `looking…`, `not found  ✗`, `{path} · v{version}, too old  ✗`, `{path} doesn't run  ✗`.
- `intro: 'moved'` replaces the welcome with: `Something moved since last time, so I had another look around.`
- git missing: `I couldn't find git on your PATH. Every task runs in its own git worktree, so I need it. Install git, then I'll look again.` Buttons: install-git, look-again.
- git broken: `I found git at {path}, but it didn't run.` On darwin add: `On a Mac that usually means Apple's command line tools aren't installed yet: run xcode-select --install in a terminal, then I'll look again.` Buttons: install-git, look-again.
- claude missing, win32: `Hmm. I looked on your PATH, in %USERPROFILE%\.local\bin and in npm's global folder, and Claude Code wasn't in any of them.`; macOS/Linux: `Hmm. I looked on your PATH and in ~/.local/bin, and Claude Code wasn't in either.` Then `If it's installed somewhere else, point me to it.` / `If it isn't, install it and I'll look again.` Buttons: find-claude (primary; label `Find claude.exe…` on win32, `Find claude…` elsewhere), install-claude, look-again.
- claude too old: `This Claude Code is v{version}, and I need v2.1.295 or newer (MIN_CLAUDE_VERSION). Run claude update in a terminal, then I'll look again.` Buttons: look-again (primary), find-claude.
- claude broken: `{path} is there, but it didn't tell me its version.` On win32 add: `If Claude Code came from npm, its launcher can't run on its own; Anthropic's native installer gives me a claude.exe I can use.` Buttons: find-claude, install-claude, look-again.
- With `claudeFromEnv` and claude not found: `MAINFRAME_CLAUDE_BIN is set to {path}, so that's the only place I look.` then the state's reason line, then `Change it or unset it, then start Mainframe again.` Buttons: look-again only.
- `lookedAgain` with git `missing`, or claude `missing` without `claudeFromEnv`, adds: `Just installed it? A program installed after Mainframe started is often invisible to it: close Mainframe, open a new terminal and run npm start again.`
- `askProject`: `All here. Last thing: which project should we start with?` then dim `Any folder that's a git repository. You can open more later.` Button: choose-project (`Choose a folder…`, primary).

- [ ] **Step 1: Write the failing tests** in `setupCopy.test.ts`: each check line above; each block's lines and buttons (win32 and darwin for claude missing and broken, and for git broken; `claudeFromEnv`; `lookedAgain`; `askProject`; `moved`); git and claude both missing → two blocks, git's first, `look-again` only in the second.
- [ ] **Step 2: Run:** `npx vitest run src/renderer/src/setup`. Expected: FAIL.
- [ ] **Step 3: Implement** `setupCopy.ts`, then the store, the screen and the styles; then `App`.
- [ ] **Step 4:** `npm test`, `npm run typecheck`; look at the screen by hand only with a scratch `MAINFRAME_DATA_DIR` and after the pgrep check (`npm start` in the background, then stop the PIDs you started).
- [ ] **Step 5: Commit:** `feat: the setup screen: a friendly look around, a line per check, and buttons for what it couldn't find`

### Task 6: The setup screen's e2e tests and the README

**Files:**
- Create: `e2e/setup.e2e.ts`
- Modify: `README.md`

Each test controls what the check can find: unset `MAINFRAME_CLAUDE_BIN` (Task 3's `undefined` value), a `PATH` holding only node's folder (and git's, when git should be found; on POSIX a temp folder of symlinks to `process.execPath` and the system git, so no claude on the developer's PATH can leak in; on Windows node's and Git's own folders), and `HOME`/`USERPROFILE`/`APPDATA` pointed at an empty temp folder. Dialogs are stubbed per test as `e2e/app.e2e.ts` does.

- [ ] **Step 1: Write the tests:**
  - "a first start welcomes you, finds everything and asks for the first project": `firstStart`, the stand-in at `<HOME>/.local/bin/claude` (`claude.exe` on Windows) → `setup` visible, both lines `found`, `setup-choose-project` → stub picks a temp repo → the board shows that project; `settings.json` holds `welcomeSeen` and the claude path.
  - "claude missing: Find claude… checks the file and saves it": no claude anywhere → `not found`; stub picks the stand-in → `found`; choose a folder → board; `settings.json` holds the picked path.
  - "a claude too old says to update": `FAKE_CLAUDE_VERSION=2.1.200` → `too old`, the update line; Look again with `FAKE_CLAUDE_VERSION` unchanged → still too old.
  - "git missing offers only How to install and Look again".
  - "a later start whose claude has moved comes back with 'Something moved'": `settings: { welcomeSeen: true, claudeBin: <gone> }`, projects seeded, nothing findable → the moved line, not the welcome; put the stand-in in `<HOME>/.local/bin` and Look again → the board with the seeded project.
  - "with MAINFRAME_CLAUDE_BIN set nothing is saved" (Review Focus 2): a first start with it set → choose a folder → `settings.json` has `welcomeSeen` and no `claudeBin`.
  - "cancelling the folder dialog keeps the screen; quitting before choosing shows the welcome again" (Review Focus 5): stub returns canceled → still `setup-choose-project`; close the app; launch again on the same data folder → the welcome again.
- [ ] **Step 2: Run** (after the pgrep check): `npx playwright test e2e/setup.e2e.ts` after `npm run build`, then the whole suite. Expected: all pass.
- [ ] **Step 3: README:** replace "At the first start, Mainframe asks for a project folder" with a short description of the setup screen and that it remembers the claude it found in `settings.json` in the data folder; `MAINFRAME_CLAUDE_BIN` now reads "checked at every start, wins over the saved path, and is never saved". The rest of the README rewrite is 2c.
- [ ] **Step 4: Commit:** `test: the setup screen on a first start, with claude missing, too old or moved, git missing, and MAINFRAME_CLAUDE_BIN set`

### Task 7: Push, and keep CI green on all three systems

**Files:** whatever the runs show is wrong, by cause; the findings file `docs/superpowers/findings/2026-11-09-cross-platform-2a-ci.md` gets a short 2b section.

- [ ] **Step 1:** `npm test`, `npm run typecheck`.
- [ ] **Step 2:** Record the tip (`git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform rev-parse HEAD | tee -a /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified >> /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-reviewed`) and append `Skip record: <sha> (2b CI push N: …; remove from both records before the final /simplify run)` to this plan's ledger.
- [ ] **Step 3:** Push as its own command: `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform push origin cross-platform`.
- [ ] **Step 4:** Read the run (`gh run list --branch cross-platform --workflow Tests --limit 1`, `gh run view <id> --json jobs`, `--log-failed`), fix by cause (TDD), repeat. Expected: green on all three systems, as plan 2a's last run was. The setup tests must pass on all three, or say in a comment why one can't behave as on the Mac (spec §10.2).
- [ ] **Step 5:** Add what the runs found to the findings file (Markdown, its own commit), and tell the owner what the setup does on each system and that plan 2c (native feel) comes next.
