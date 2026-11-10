# Mainframe on macOS, Windows and Linux

Design, 2026-11-09. Written after a brainstorm with the owner and a read-only review of the whole codebase for Windows and Linux (four reviewers on 2026-11-08: main process, renderer, tests and tooling, and current docs). Decisions the owner made are stated plainly or marked **(owner)**. Decisions the designer made on the owner's behalf are marked **(designer's call)**; the owner may overturn them.

Approved mockup: `docs/superpowers/mockups/2026-11-09-cross-platform-setup.html` (the setup window's welcome, the setup window when `claude` is missing, and the window frame on Windows and Linux). Its paths and versions are made up.

Branch: `cross-platform`, in the worktree `.claude/worktrees/cross-platform`, cut from local `main` at `ecdbb51`. See §11 for when the code starts.

## 1. Why

Mainframe is meant for friends to run on their own projects (root `CLAUDE.md`, "Mainframe is project-agnostic"). Today it runs only on macOS: on Windows no session can even start, and on Linux nobody has tried. The owner wants it to work on macOS, Windows and Linux **(owner)**.

People run it from a terminal, as the README says today: `git clone`, `npm install`, `npm start`. No installer for now **(owner)**.

Nobody can try it on Windows by hand soon: the owner has a Windows PC that isn't set up, so a friend may be the first real Windows user **(owner)**. So the code has to be right before anyone runs it there, and automatic tests on all three systems carry most of the checking.

## 2. Goals, non-goals, anti-goals

**Goals**
- Mainframe installs with `npm install`, starts with `npm start`, and works on macOS, Windows and Linux: tasks, the manager, the board's status, the Todo panel's sync, quit and restore.
- A first-start setup window that finds what Mainframe needs, asks the user only for what it can't find, and asks for the first project (§4) **(owner)**.
- Shortcuts that feel native on each system (§6) and a window that looks right on each (§7).
- The typecheck, unit tests and end-to-end tests run on macOS, Windows and Linux on every push to GitHub (§10).

**Non-goals**
- An installer, code signing, auto-update or app packaging **(owner: "no installer needed for now")**.
- Running `claude` inside WSL. Claude Code in WSL must be launched from inside WSL, and Electron's docs advise against developing Electron apps under WSL.
- Windows 10, and any other older system or tool version **(owner, 2026-11-09)**. Mainframe is mainly for the owner and their friends, not a large crowd, so it targets current versions only (§3). 32-bit Windows is out too (neither Electron 44 nor Claude Code supports it).
- Dependency upgrades. Electron 45, TypeScript 7 and the others are separate decisions under the shared package rule; none goes into this branch **(designer's call)**.
- Agents other than Claude Code.
- Checking whether Claude Code is logged in. The first session asks for a login itself if needed **(designer's call, owner agreed)**.

**Anti-goals**
- Anything on the Mac getting worse or changing. Mac shortcuts, the Mac window and Mac behaviour stay exactly as they are **(owner)**.
- A setup window that asks for something it could have found.
- Windows users needing more than Node.js, git and Claude Code. In particular, Mainframe must not depend on Git Bash or any shell being present (§5.2) **(designer's call, owner agreed)**.
- Any value from the owner's machine, project or tooling in the product (root `CLAUDE.md`). Setup texts name generic places only (`%USERPROFILE%\.local\bin`, `~/.local/bin`).

## 3. What a user needs on each system

| | macOS | Windows | Linux |
|---|---|---|---|
| Node.js, the newest LTS (26 as of 2026-11, with npm 11.20) | yes | yes | yes |
| git on PATH | yes | yes (Git for Windows, or any git.exe on PATH) | yes |
| Claude Code | native installer, Homebrew or npm | native installer or WinGet (`claude.exe`); npm installs see §4.3 | native installer or npm |
| A compiler for `npm install` | no | no (node-pty 1.1.0 ships win32-x64 and win32-arm64 builds) | **yes**: node-pty 1.1.0 has no Linux build, so `build-essential` (or the distro's equivalent) and Python 3 |

**Mainframe is built for the newest versions, not old ones** **(owner, 2026-11-09)**: the newest LTS of Node.js and the npm it ships, a current Claude Code (the setup asks for `claude update` when it finds an older one), and current versions of each system: current macOS, current Windows 11 (no Windows 10), and a current Linux. Nothing is added only to support an older version. npm 11 (11.16 and later) warns about dependencies' install scripts that the project's `allowScripts` (in `package.json`) doesn't cover, but still runs them; a later npm is to stop running them, and `strict-allow-scripts` already turns the warning into an error. node-pty needs its install script on Linux, where it has no prebuild and compiles itself (CI on 2026-11-09, npm 11.20, showed the warning and a working build). On macOS and Windows it loads its prebuilds, and the Windows prebuild already carries the bundled ConPTY (§5.3), so neither needs the script. Mainframe's `package.json` allows node-pty's scripts explicitly, and the install stays free of that warning **(designer's call; check the field's exact form in npm's docs when building)**.

`git` must be on PATH, not just somewhere on disk: Claude Code's own `-w` worktrees use the git on PATH, so Mainframe pointing at a git elsewhere wouldn't help **(designer's call)**.

## 4. The setup window

### 4.1 What the user sees

The first time someone runs Mainframe, the main window opens on a terminal-style screen instead of the board **(owner)**. It has a friendly, slightly quirky introduction to Mainframe, then it looks around the computer, then it asks for what it couldn't find **(owner)**. The mockup has a first draft of the text.

- **Look:** Mainframe's own colours and its monospace font, inside the main window (not a separate window) **(designer's call, owner agreed)**. Lines appear one after another, as if typed.
- **Answers are buttons, never a typed prompt (owner, option B).** Nobody types a path.
- **Order:**
  1. The welcome.
  2. One line per check (§4.2), each ending in a ✓ with what was found (path, version) or a friendly "not found" ✗.
  3. For each ✗, a short explanation of where Mainframe looked and buttons:
     - for `claude`: **Find claude…** (a file dialog), **How to install ↗** (the Claude Code setup docs, opened in the browser), **Look again**;
     - for `git`: **How to install ↗** and **Look again** only, since git must be on PATH (§3).
  4. When every check passes: "which project should we start with?" with **Choose a folder…**. This replaces today's bare folder picker at first start (`chooseProjects` in `src/main/index.ts`) **(designer's call, owner agreed)**.
- **Then** the board appears, as today.
- **Installing while Mainframe waits:** a program installed after `npm start` (Git for Windows, Claude Code through WinGet or npm) is often invisible to the running Mainframe, because it and the terminal that started it keep the old PATH. **Look again** still searches the places it can check directly (such as Claude's installer folder). When it still finds nothing, the ✗ text says that a fresh install may need a new terminal: close Mainframe, open a new terminal and run `npm start` again **(designer's call)**. Mainframe does not re-read PATH from the system itself.
- **Tone:** friendly and a little playful, never cute at the expense of clarity. Every ✗ says plainly what is wrong and what to do.

### 4.2 What it checks

1. **git:** runs on PATH (`git --version`).
2. **claude:** an absolute path to a Claude Code executable that runs (`claude --version`), and whose version is at least the minimum Mainframe needs. If it finds an older one, it says so and suggests `claude update`, instead of failing quietly later **(designer's call, owner agreed)**. The minimum is the highest version any feature Mainframe uses needs; known today: OSC 7501 status reports need 2.1.295, `--permission-prompts none` needs 2.1.259, hook `onFailure` needs 2.1.295 (Claude Code CHANGELOG).

It looks before it asks **(designer's call, owner agreed)**. Where it looks for `claude`, in order:
- `MAINFRAME_CLAUDE_BIN`, if set. It still wins over everything, and the e2e tests depend on it **(designer's call, owner agreed)**.
- The answer saved last time (§4.4).
- PATH. On Windows the lookup must use the `Path` key whatever its case, split on `;`, and try PATHEXT (preferring `.exe`).
- The native installer's folder: `~/.local/bin/claude` on macOS and Linux, `%USERPROFILE%\.local\bin\claude.exe` on Windows (the Windows installer does not add it to PATH).
- npm's global folder (§4.3).

### 4.3 npm-installed Claude Code on Windows

`npm i -g @anthropic-ai/claude-code` on Windows puts `claude.cmd` and `claude.ps1` launchers on PATH. Neither node-pty nor Node's `child_process` can start a `.cmd` without a shell, and going through `cmd.exe` would mangle Mainframe's multi-line prompts and JSON arguments. So Mainframe never runs a `.cmd` **(designer's call, owner agreed)**:
- The setup looks for the real executable behind npm's launcher, inside the npm package (`node_modules\@anthropic-ai\claude-code\bin\claude.exe`), and uses it if it is a real executable. It looks in every npm prefix on PATH that holds a `claude.cmd` (a version manager's, say), and in the default prefix, `%APPDATA%\npm` **(plan 2b's ruling R14)**. (The package's `bin/claude.exe` stays a placeholder script until its postinstall has run, and npm 12 skips postinstall by default, so it may not be.)
- If there is none, the ✗ says that this kind of install can't be used and suggests Anthropic's native installer.

On macOS and Linux, npm's `claude` is a normal executable script and works as it does today.

### 4.4 What it remembers, and when it shows again

- The resolved claude path is saved in a small settings file in Mainframe's data folder, the same for every open project **(designer's call, owner agreed)**. It is app-wide, so it fits "several projects at once" (root `CLAUDE.md`): every project's tasks, manager and sync use the same path.
- **The full welcome shows only on a true first start:** no `projects.json` in the data folder and no record that the welcome was seen. The record is its own entry, separate from the saved claude path, so it holds even when `MAINFRAME_CLAUDE_BIN` is set. An existing install, such as the owner's Mac with projects open, never sees the welcome; it gets only the start-up check below, which is silent when everything works **(designer's call)**.
- **In the e2e tests,** `launchApp` pre-seeds the "welcome seen" record, so every existing test still opens straight onto the board. The fake `claude`s (including `bridge.e2e.ts`'s) answer `--version` with a version at or above the minimum. The setup window's own e2e tests control PATH and HOME to make `git` or `claude` go missing **(designer's call)**.
- **At every later start,** Mainframe checks quickly that git and the saved claude still work. If one doesn't (Claude Code moved or was uninstalled, git disappeared), the setup window comes back at the step that failed, with a short "something moved" text instead of the welcome, before any session starts **(designer's call, owner agreed)**. Sessions never fail one by one for a reason the setup could have caught.
- With projects already open, it skips the "first project" step.
- With `MAINFRAME_CLAUDE_BIN` set, the claude check still runs on that path (version included), but nothing is saved.

## 5. Starting and running sessions on Windows

### 5.1 Launching `claude`

Every place that starts `claude` (task sessions and the manager through node-pty; the Todo sync and any other background run through `child_process`) uses the absolute path from §4. node-pty on Windows searches only the exact file name on the Electron process's own `Path`, with no PATHEXT, so a bare `claude` is never found; an absolute path always is.

The launch check in `src/main/pty/sessionHost.ts` (`checkLaunch`) and the PATH cleaning in `src/main/pty/spawnEnv.ts` must work on Windows: `Path` whatever its case (never adding a second `PATH` key beside it), `path.delimiter`, PATHEXT, `path.isAbsolute`, and both slash directions.

Windows caps a command line at 32,767 characters. The opening prompt carries the task's description, and the New task box's description has no cap today (the manager's `start_task` brief is capped at 20,000). Long descriptions must never make a launch fail on Windows.

### 5.2 No shell anywhere

Mainframe writes two hooks today as POSIX shell commands:
- the SessionStart hook in `src/main/tasks/launch.ts` (`cat > tmp && mv tmp target`), which records the session id so a task reopens and restores its conversation and the manager keeps its chat;
- the sync's PreToolUse guard (`echo … >&2; exit 2`; on the `todo` branch, `src/main/todo/syncRun.ts`).

On Windows, Claude Code runs a shell-form hook in Git Bash, or in PowerShell when Git Bash isn't installed, where both of these fail; the SessionStart one fails silently. Both hooks must work with no shell on every system **(designer's call, owner agreed)**. Claude Code also offers exec-form hooks (`command` plus `args`, no shell, a real executable) and HTTP hooks; Mainframe already runs a local server per project with a token. Which to use is left to the builder (§13), checked against the current hooks docs.

### 5.3 The board's status on Windows (check first)

The board knows whether a session is working or needs you from OSC 7501, a terminal sequence Claude Code sends once Mainframe answers its `OSC 7501;?` query before the terminal's answer to the `CSI c` query that follows (`sessionHost.ts`). On Windows, node-pty runs every session through ConPTY. Older ConPTY versions answered `CSI c` themselves and dropped unknown OSC sequences. If the Windows ConPTY does that, Claude Code concludes the terminal doesn't support OSC 7501 and the board never sees any status. Nobody can tell without trying.

So **the first step of the work is a check on a Windows machine** (a GitHub Windows runner, §10) **(owner)**: a small test program, run through node-pty, sends the query and `CSI c` and prints OSC 7501 reports, and the test records what reaches Mainframe, in which order, with Windows' own ConPTY and with the newer ConPTY that node-pty 1.1.0 bundles (`useConptyDll: true`).
How the result decides what every Windows user gets. Mainframe supports current Windows 11 only **(owner, 2026-11-09)**, and the runner (Windows Server 2025, build 26100) is built on the same core as current Windows 11, so its result for Windows' own ConPTY stands for friends' machines **(designer's call, from the owner's Windows 11 decision)**:
- **If Windows' own ConPTY passes,** Mainframe uses it, as today, with no option. The board works as on the Mac.
- **If only the bundled ConPTY passes,** Mainframe uses it (`useConptyDll: true`) on Windows. Its `conpty.dll` ships in node-pty's Windows prebuild, so it needs no install script (§3).
- **If neither passes,** Claude Code reports its status to Mainframe's local server through hooks instead, on Windows **(owner)**. Mac and Linux keep OSC 7501.
- **The hook route** covers task sessions and the manager. It must tell the board's lanes apart exactly (working versus needs you, and when a session is done), and give the kind of "needs you" (a permission, a question, a login) wherever Claude Code's hooks can tell; where they can't, an approximation is accepted.
- The owner's Windows PC check (§10.4) confirms the choice with a real Claude Code on a desktop Windows.

**Result (2026-11-09): only the bundled ConPTY passed, so Windows uses it** (`docs/superpowers/findings/2026-11-09-windows-status-check.md`). Windows' own ConPTY answers `CSI c` itself and never passes Mainframe's reply on. The hook route isn't needed.

The e2e tests' fake `claude` also prints OSC 7501 sequences, so this check decides whether those tests can pass on Windows as they are.

A real Claude Code on Windows is then checked by hand on the owner's Windows PC or by a friend (§10.4).

### 5.4 Stopping sessions, quitting and restoring

- node-pty's Windows `kill(signal)` throws for any signal. `SessionHost.kill(id, 'SIGKILL')` (called from `projectRegistry.ts` at quit) must never pass a signal on Windows. A second `kill()` on the same Windows pty can crash the process (node-pty issue #983), so each pty is killed at most once.
- Every kill on Windows is a hard stop; Claude Code gets no graceful hang-up. Accepted.
- A cancelled or timed-out background run on Windows must also end the processes it started (for example stdio MCP connectors), not just `claude.exe` itself.
- A resize or write that arrives just after a Windows pty has exited (node-pty reports exits up to about a second late) must not raise an error.
- Electron sends no `before-quit` when Windows shuts down, restarts or logs off. Mainframe's quit bookkeeping (`projects.beginQuit()`) must still run then, so tasks come back at the next start, as they do after Quit.
- Child processes Mainframe starts on Windows (git, background `claude`) must not flash a console window.

## 6. Shortcuts

Mac keeps everything it has today. Windows and Linux get the same Ctrl-based set, modelled on Windows Terminal and VS Code **(owner agreed the whole table)**.

| What it does | Mac (unchanged) | Windows and Linux |
|---|---|---|
| Jump to project 1–9 | Cmd+1…9 | Ctrl+1…9 |
| Take the focused pane off screen | Cmd+W | Ctrl+Shift+W. Plain Ctrl+W stays "delete word" in a terminal. |
| Open Project… | Cmd+O | Ctrl+Shift+O. Plain Ctrl+O is Claude Code's. |
| Next / previous session that needs you | Ctrl+Tab / Ctrl+Shift+Tab | the same |
| Start a task from the New task box | Cmd+Enter | Ctrl+Enter |
| Open a link in a terminal | Cmd+click | Ctrl+click |
| Copy in a terminal | Cmd+C | Ctrl+C copies when text is selected, otherwise it interrupts as usual. Ctrl+Shift+C always copies. |
| Paste in a terminal (text, files, images) | Cmd+V | Ctrl+V or Ctrl+Shift+V, through the same paste handling Cmd+V uses |
| Right-click in a terminal | nothing | a small Copy / Paste menu |
| Start / end of the line | Cmd+← / Cmd+→ | Home / End |
| Scroll a line | Cmd+Shift+↑ / ↓ | Ctrl+Shift+↑ / ↓ |
| Scroll a page | Cmd+Shift+PgUp / PgDn | Shift+PgUp / PgDn |

Rules that go with it:
- **AltGr must never trigger a shortcut.** On Windows, AltGr arrives as Ctrl+Alt, and on Nordic and German layouts AltGr+2/7/8/9/0 type `@ { [ ] }`. Every Ctrl shortcut excludes Alt, as the Cmd ones already do.
- **The standard Window menu's Ctrl+W (close the window, which quits Mainframe and ends every session) and Ctrl+M (minimise) must not exist on Windows and Linux.** §7 removes the menu bar there, which removes them.
- **On-screen hints show each system's key** ("Ctrl+Enter starts it" on Windows and Linux).
- Today, copy and paste in a terminal reach Mainframe through the Mac Edit menu firing DOM `copy`/`paste` events. On Windows and Linux, xterm turns Ctrl+C and Ctrl+V into control codes before any menu sees them, so these keys must be handled in the terminal's own key handling there.
- The renderer needs to know which system it runs on: today `RendererConfig` (`src/shared/types.ts`) carries no platform.

## 7. The window on Windows and Linux

**The system's own title bar (owner, option A).** On Windows and Linux, the operating system draws a normal title bar with its own minimise, maximise and close, following the desktop's theme. Mainframe's content starts below it. The Mac keeps `titleBarStyle: 'hiddenInset'` and its window dots in Mainframe's top row.

- **No menu bar on Windows and Linux.** Open project is already a button at the bottom of the project list (`ProjectRail.tsx`), and Ctrl+Shift+O opens it. Pressing Alt must not move the focus to a hidden menu.
- **No gap for the Mac's window dots.** The 80 px left padding of the project list's top row (`.rail-titlebar` in `app.css`) is Mac-only.
- `titleBarStyle: 'hiddenInset'` is a Mac-only value and must not be passed on Windows and Linux. The reviewers disagreed on what it does there today (a normal frame, or a frameless window with no buttons); either way it goes.
- The folder dialog's `message` shows only on the Mac; Windows and Linux need its `title` set too.

## 8. Smaller fixes that come along

- **Paths put into a terminal** (dropped files, pasted files and images): `terminal/escapePath.ts` backslash-escapes for a POSIX shell, which garbles every Windows path. On Windows, quote with double quotes when needed and never backslash-escape. macOS and Linux keep today's escaping.
- **Saving files on Windows:** writing `state.json`, `projects.json` and the other JSON files by renaming a temporary file over the old one (`writeJsonAtomic` in `tasks/taskStore.ts`) can fail now and then on Windows while another program (antivirus, the indexer, a sync tool) holds the file. It must retry instead of failing. Emptying the pasted-images folder at start (`index.ts`) must not stop Mainframe from starting when a file in it is still open.
- **Task names:** a task's folder name must never be a name Windows reserves (`con`, `nul`, `aux`, `prn`, `com1`–`com9`, `lpt1`–`lpt9`).
- **Long paths:** `<project>\.claude\worktrees\<name>\…` can pass Windows' 260-character limit in deep repos. The README tells Windows users about `git config core.longpaths true`.
- **git missing** must not be read as "this branch doesn't exist" (`git.ts`), which today would reopen a task in the main checkout.
- **Environment:** sessions started from Windows Terminal must not inherit its identity variables (`WT_SESSION`, `WT_PROFILE_ID`, and the like), as Mainframe already drops other terminals' variables.
- **Terminal on Windows:** xterm's `windowsPty` option set with the Windows build number; a wheel step that scrolls a normal amount on a Windows mouse; terminals re-fitting when the window moves to a screen with different scaling.
- **Fonts and scrollbars:** font fallbacks that exist on Windows and Linux, not only macOS ones (the bundled Inter, Sora and JetBrains Mono stay the first choice); the board's lanes and card columns get the thin scrollbars the other scroll areas have, since Windows scrollbars take up space.

## 9. Linux

- The main process works as on the Mac (a real pty, POSIX paths and shells), so starting sessions and the board's status should carry over.
- Keys and the window follow Windows (§6, §7).
- `npm install` needs a compiler (§3); the README says so.
- **Mainframe must start on a current Ubuntu without anyone changing system settings.** Ubuntu 24.04 and later block the unprivileged user namespaces Electron's sandbox needs, so Electron stops at launch on a friend's machine. The CI job switches that block off (§10.1), which hides the problem. Once it is handled, the CI step that switches the block off comes out, so CI tests what a friend gets.
  - **Decision (owner, 2026-11-09): start without the sandbox where Ubuntu blocks it, and say how to keep it.** `npm start` runs a small start script. On Linux, when `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` reads `1` and Electron's sandbox helper isn't set up (below), it starts Electron with `--no-sandbox` (electron-vite's `preview --noSandbox`) and prints one line saying so. Macs, Windows and other Linuxes keep the sandbox. The flag has to be on the command line: Chromium sets up its sandbox before any of Mainframe's code runs, so `app.commandLine.appendSwitch` is too late.
  - **Keeping the sandbox: Electron's setuid helper (owner, 2026-11-09).** The README gives the one-time admin step: make `node_modules/electron/dist/chrome-sandbox` owned by root with mode 4755, which Chromium uses when user namespaces are blocked. The start script sees that (the file's owner and setuid bit) and then keeps the sandbox on by itself. The step is repeated after an `npm install` that reinstalls Electron; the start script's line shows again as a reminder. An AppArmor profile was the first idea, but a normal user can't tell whether one is loaded, so the start script would turn the sandbox off anyway.
  - Playwright adds `--no-sandbox` on Linux by itself, so the e2e tests can't show that `npm start` works; CI gets a step that runs `npm start` the way a friend does, on Ubuntu with the block left on.

## 10. Tests and checks

### 10.1 On every push: GitHub Actions on all three systems

The repo is public, so GitHub's runners are free. A workflow runs on every push and pull request, on `macos-latest`, `windows-latest` and `ubuntu-latest`, with the newest Node.js LTS (`lts/*`): `npm ci`, `npm run typecheck`, `npm test`, `npm run test:e2e` **(designer's call, owner agreed)**. It keeps the test results when a run fails. The Windows and Linux jobs are expected to fail until the tasks that fix them land; that is fine, since nothing on GitHub requires them to pass **(designer's call)**.
- Linux needs a virtual display for Electron (for example `xvfb-run`, given a full-HD screen, since its default is far smaller than Mainframe's window) and builds node-pty from source. Until §9's sandbox item lands, the job switches off Ubuntu's user-namespace block; that step is temporary.
- Windows runners have a desktop session. Their default screen may be too small for the e2e tests' 1600–1700 px windows, so the job may need a larger resolution.
- A `.gitattributes` keeps line endings LF in the repo (Git for Windows defaults to `core.autocrlf=true`, which breaks shell scripts and makes content checks flaky).

### 10.2 The e2e tests' stand-in for `claude`

`e2e/fake-claude.sh` is a bash script, which Windows can't start. It becomes a Node script that behaves the same on every system (its behaviour today: recording its arguments and working folder, the sync mode with its reply file, hold file and SIGTERM handling, and the interactive mode that writes `session-start.json` and then becomes a shell the tests type into). `e2e/bridge.e2e.ts`'s small `#!/bin/sh` fake goes the same way.
- On Windows it must be started as an executable. How (a test-only way to run a script, or building a small `.exe`) is left to the builder; any test-only path in the product stays behind `MAINFRAME_E2E=1`.
- The interactive mode's shell: the tests type bash commands. Git Bash is preinstalled on the Windows runners, so it can be used there; Windows developers running e2e then need Git for Windows, and the README's Develop section says so.
- Things that can't behave the same on Windows: a process can't run a handler when it is stopped (so "a stopped sync still prints its reply" stays a POSIX-only check, and Windows checks that the process is gone instead), and file permission checks (`0o600`) don't apply.

### 10.3 Unit tests

Seven unit-test files assume POSIX today (shell scripts as fake binaries, `/bin/sh`, `chmod`, `/tmp`, `:`-separated PATHs, POSIX paths as expected values, `0o600` checks). They must run on all three systems. Tests of Windows-only behaviour (PATH lookup with PATHEXT, quoting, reserved names, shortcuts) are written so they run on every system, by passing the platform in, not by detecting it.

### 10.4 By hand

- **Mac:** the owner checks that nothing changed: shortcuts, window, sessions, quit and restore.
- **Windows:** once all three CI runs pass, the owner on their Windows PC when it is set up, or a friend's first try: setup window, a real Claude Code session with status on the board, copy and paste, quit and restore.
- **Linux:** a friend's first try.

## 11. Order of work

1. **Now:** this design and plan 1 (`docs/superpowers/plans/2026-11-09-cross-platform-1-status-check-and-ci.md`: the status check and CI) are committed on `cross-platform`.
2. **Start now: the Windows status check (§5.3) and the GitHub Actions workflow (§10.1)** **(owner, 2026-11-09)**. Both only add new files, so they don't collide with `todo`, and the check's answer shapes §5.3's half of the work.
3. **Everything else starts once `todo` has merged into `main`** **(owner)**. `todo` is about 29 commits ahead of `main` and still being worked on, and it changes files this work touches (the background sync, the fake `claude`, the terminal code). Before that work starts, `cross-platform` is moved onto the new `main`.
4. **Plan 2 covers everything else.** It is written once `todo` has merged and plan 1's findings are in, because both change what it says: the files `todo` brings (the sync's guard hook, its spawn and stop, the fake `claude`'s sync mode, `todo.e2e.ts`, the README) and the status route on Windows **(designer's call)**.
5. The rest, in the order the plan decides. The setup window and §5 make Windows usable; §6–§8 make it feel right; §10 runs throughout.

**Pushing to see CI results** **(owner, 2026-11-09):** GitHub's runners are the only Windows and Linux machines available, so the work is pushed to `origin` (`cross-platform` only) whenever a CI result is needed, and the results are read with `gh`. The owner allows these pushes without `/simplify` and `/code-review high`: before each one, the tip is recorded in `.git/claude-reviewed` and `.git/claude-simplified` without a run. Both runs still happen once, on the whole branch, after its last code task and before the owner's acceptance, as the root `CLAUDE.md` says.

The gate can't tell a skip record from a real run, so a commit covered by a skip would also pass a merge into `main`. To keep the gate meaningful, every skipped tip is listed by its commit id in the running plan's ledger (`.superpowers/sdd/<plan>/progress.md`, lines starting `Skip record:`). **Before the final `/simplify` run, exactly those ids are removed from both record files**, so only the real runs can let the branch into `main` (owner's side note, 2026-11-09).

## 12. Constraints

- The root `CLAUDE.md` rules apply in full: project-agnostic (every task review asks whether the change works unchanged for a friend whose project uses another language, a `master` branch and none of the owner's plugins), several projects at once, code in proportion, and `/simplify` then `/code-review high` before the owner's acceptance.
- UI work uses the `frontend-design` skill (the owner's global `CLAUDE.md`).
- External APIs (node-pty, Electron, Claude Code's hooks and CLI, Playwright, GitHub Actions) are checked against their current docs during implementation, not taken from memory or from §14 alone.
- No e2e run on the owner's machine while the owner's own Mainframe is running (ask for Cmd+Q first).
- Dead code that this change makes unreachable is removed; dead code elsewhere is pointed out, not removed.

## 13. Left to the builder

- How the two hooks run without a shell (§5.2): exec form, HTTP hooks to the project's local server, or something else that the current docs support.
- How the Windows status fallback reports (§5.3), if the check says it's needed.
- How to find the real executable behind npm's Windows launcher (§4.3), and the setup's exact search list per system, from Claude Code's current install docs.
- The minimum Claude Code version (§4.2).
- The settings file's name and shape (§4.4), and how quick the start-up check is.
- How the window is restructured so the setup can show before any project opens (today the folder picker runs before the window exists).
- The welcome's final text, within the tone of §4.1 and the mockup's draft; whether the typing animation can be skipped with a key or click, and how it respects reduced motion.
- The cap or other handling for long task descriptions on Windows (§5.1).
- How the e2e fake `claude` is started on Windows (§10.2).
- How Ctrl+Backspace behaves in a terminal on Windows and Linux, following what Claude Code expects on each.
- Whether DevTools keeps a shortcut on Windows and Linux once the menu bar is gone.
- The plan's task order after step 3 of §11.

## 14. Facts checked on 2026-11-08 (verify again while building)

- node-pty 1.1.0 (latest stable; 1.2.0 is in beta): ships `prebuilds/` for darwin-arm64, darwin-x64, win32-x64 and win32-arm64, none for Linux; Node-API, so the same build loads in Node and Electron. Uses ConPTY on Windows build 18309+, otherwise winpty. `useConptyDll` (experimental) uses the bundled conpty.dll 1.23. `kill(signal)` throws on Windows. Relative file names are searched on the parent process's `Path` with no PATHEXT. Open issues: #983 (double kill crashes), #966 (console window flash on kill). Source: the npm tarball and github.com/microsoft/node-pty.
- Claude Code: Windows 10 1809+; installs by `install.ps1`/`install.cmd` to `%USERPROFILE%\.local\bin\claude.exe` (not added to PATH), WinGet, or npm (`claude.cmd`/`claude.ps1`). Git for Windows is optional. Shell-form hooks run in Git Bash, or PowerShell without it; exec-form hooks need a real `.exe`. OSC 7501 since 2.1.295. Image paste is Alt+V on Windows. Sources: code.claude.com/docs/en/setup, /troubleshoot-install, /hooks, /terminal-config, the CHANGELOG.
- Electron 44: `hiddenInset` is macOS-only; `Cmd` accelerators do nothing on Windows and Linux; on Windows the `windowMenu` role holds Minimize (Ctrl+M) and Close (Ctrl+W); `appMenu` is macOS-only; on Windows and Linux menu accelerators fire only for keys the page didn't handle; dialog `message` is macOS-only; `text/uri-list` maps to CF_HDROP on Windows; no `before-quit` on Windows shutdown. Source: electronjs.org docs and the `44-x-y` branch.
- Node: spawning a `.cmd` without a shell throws EINVAL; libuv tries only `.com` and `.exe`; `kill()` is always a hard stop on Windows; `windowsHide` defaults to false; `fs` `X_OK` acts like `F_OK` on Windows.
- GitHub `windows-latest`: Windows Server 2025, Git 2.56 with Git Bash at `C:\Program Files\Git\bin\bash.exe`, Node 22. Playwright has `ControlOrMeta`.

## Appendix: where the review found each issue

- Launching: `src/main/pty/sessionHost.ts` (`DEFAULT_PATH`, `checkLaunch`, `kill`, `resize`), `src/main/pty/spawnEnv.ts`, `src/main/config.ts`, `src/main/index.ts` (`spawnPty: pty.spawn`).
- Hooks: `src/main/tasks/launch.ts` (SessionStart), `src/main/todo/syncRun.ts` on `todo` (guard, `child.kill('SIGTERM')`, `spawn`).
- Quit: `src/main/projectRegistry.ts` (`kill(sessionId, 'SIGKILL')`), `src/main/index.ts` (`before-quit`), `src/main/tasks/taskService.ts` (`onSessionExit`).
- Files: `src/main/tasks/taskStore.ts` (`writeJsonAtomic`, `keepAside`), `src/main/index.ts` (paste folder), `src/main/tasks/naming.ts`, `src/main/git.ts`.
- Window and menu: `src/main/index.ts` (`titleBarStyle`, `pickProjectFolder`), `src/main/menu.ts`, `src/renderer/src/app.css` (`.rail-titlebar`), `src/shared/types.ts` (`RendererConfig`).
- Keys: `src/renderer/src/board/shortcuts.ts`, `src/renderer/src/board/NewTaskDialog.tsx`, `src/renderer/src/terminal/keybindings.ts`, `terminalLinks.ts`, `TerminalView.tsx` (copy, paste, link clicks, fit), `terminalOptions.ts`.
- Paths into terminals: `src/renderer/src/terminal/escapePath.ts`.
- Tests: `e2e/fake-claude.sh`, `e2e/launch.ts` (`cleanUp`, `setWindowWidth`), `e2e/bridge.e2e.ts`, `e2e/manager.e2e.ts`, `e2e/terminal.e2e.ts`, `e2e/todo.e2e.ts`, `e2e/projects.e2e.ts`, `e2e/app.e2e.ts`, `e2e/links.e2e.ts`, `e2e/board.e2e.ts`; unit tests `sessionHost.pty.test.ts`, `sessionHost.test.ts`, `syncRun.test.ts` (on `todo`), `launch.test.ts`, `managerService.test.ts`, `config.test.ts`, `clipboard.test.ts`, and the key tests `shortcuts.test.ts`, `keybindings.test.ts`, `terminalLinks.test.ts`, `escapePath.test.ts`.
- Docs: `README.md` (macOS only, `~/Library` data folder, ⌘O, POSIX-style settings, `claude` on PATH).
