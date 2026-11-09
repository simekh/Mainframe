# Findings: the Windows status check and the first CI runs on three systems

Plan 1 of the cross-platform work, on branch `cross-platform`, 2026-11-09. Three GitHub Actions runs of the `Tests` workflow:

| Run | Commit | Node / npm | What changed |
|---|---|---|---|
| [42598640449](https://github.com/simekh/Mainframe/actions/runs/42598640449) | 817e8d0 | 22 | The first run |
| [42599576558](https://github.com/simekh/Mainframe/actions/runs/42599576558) | f0a078b | 26.13.0 / 11.20.0 (`lts/*`) | Newest LTS. Cancelled once superseded; Linux finished, and Windows got past its unit tests |
| [42601437383](https://github.com/simekh/Mainframe/actions/runs/42601437383) | e6c9ca8 | 26.13.0 / 11.20.0 | The probe answers every CSI c (d3f6f56); Linux gets a full-HD virtual screen; the Mac job prints its screen |

Everything below is from the third run unless it says otherwise. The Node version changed nothing: the first two runs gave the same status-check lines and the same Windows failures.

## The decision (spec §5.3): Windows uses the ConPTY bundled with node-pty

Windows' own ConPTY fails the check and the bundled one passes it, so Mainframe spawns sessions on Windows with `useConptyDll: true`. The hook route isn't needed.

```
windows own      {"exitCode":0,"queryReachedHost":true,"da1Queries":0,"sawReply":false,"sawDa1":true,"replyFirst":false,"states":["working","blocked:question"]}
windows bundled  {"exitCode":0,"queryReachedHost":true,"da1Queries":2,"sawReply":true,"sawDa1":true,"replyFirst":true,"states":["working","blocked:question"]}
macos own        {"exitCode":0,"queryReachedHost":true,"da1Queries":1,"sawReply":true,"sawDa1":true,"replyFirst":true,"states":["working","blocked:question"]}
ubuntu own       {"exitCode":0,"queryReachedHost":true,"da1Queries":1,"sawReply":true,"sawDa1":true,"replyFirst":true,"states":["working","blocked:question"]}
```

- **Windows' own ConPTY** (the runner is Windows Server 2025, build 26100) passes the query out and the reports out, but answers CSI c itself: no CSI c reaches Mainframe (`da1Queries: 0`), and Mainframe's reply never reaches the program (`sawReply: false`). Claude Code would see a terminal that doesn't speak OSC 7501 and send no status.
- **The bundled ConPTY** (node-pty 1.1.0's conpty.dll) passes everything through. It sends a CSI c of its own at start, ahead of the program's (`da1Queries: 2`). The first run's harness answered only the first CSI c, so it answered ConPTY's and left the probe's unanswered (`sawDa1: false`). The fixed harness answers every one, as xterm does, and the reply arrives first.
- **macOS and Linux** pass through their own pty.

### What it doesn't prove

- The probe reads its input with Node's raw mode. Claude Code runs on Bun, which may read Windows console input differently. The owner's Windows PC check (spec §10.4) confirms the decision with a real Claude Code.
- The runner is Windows Server 2025, not Windows 11. Both are build 26100, but the check on a Windows 11 PC is the one that counts.
- The bundled ConPTY works only once node-pty's postinstall has copied conpty.dll into `build/Release/conpty`. npm 11.20 still runs that script, with a warning (below).

## Per system, per step

| Step | macOS | Windows | Linux |
|---|---|---|---|
| Install (`npm ci`) | pass | pass, with no build tools | pass (node-pty compiles itself) |
| Status check | pass | fail: the `own` test, as above; `bundled` passes | pass |
| Typecheck | pass | pass | pass |
| Unit tests | pass: 750, 1 skipped | fail: 29 tests in 8 files | pass: 750, 1 skipped |
| E2E tests | fail: 20 of 89 | fail: 80 of 89 | pass: 89 of 89 |

- **npm's warning.** On every system `npm ci` prints `npm warn install-scripts 1 package has install scripts not yet covered by allowScripts: node-pty@1.1.0`. npm 11 still runs them: node-pty has no Linux prebuild, yet it compiled and loaded there. A later npm is to stop running them, so spec §3 now has Mainframe's `package.json` allow node-pty's scripts.
- **Electron starts on all three.** On Linux the job first switches off Ubuntu's block on unprivileged user namespaces, so this doesn't show that Mainframe starts on a friend's Ubuntu (spec §9). No run has tried without that step.
- **Screens.** The Windows runner's screen is 1920x1080 (`Set-DisplayResolution` didn't throw, and the screen was already that size). `xvfb-run`'s default screen was too small for the window, which was all of Linux's 16 e2e failures in the first run; `--server-args="-screen 0 1920x1080x24"` fixed every one. The Mac runner's `system_profiler SPDisplaysDataType` lists no display, so its screen size is still unknown.

## For plan 2

### macOS: 20 e2e tests fail on the runner's small screen

All 20 fail because the window is narrower than the tests ask for: the panel can't pin ("No room to pin the panel beside the board"), and the unpinned panel covers the buttons the tests click (`locator.click` timeouts on `new-task`, with the panel's resize edge on top). They pass on the owner's Mac. The files: board, manager, panel (2), projects, session-panel, shortcuts (4), tasks (5), terminal (3), todo (2). Plan 2 has to find the runner's real screen size (Electron's `screen.getPrimaryDisplay()` can print it) and then either enlarge it or give the tests a window that fits.

### Windows: unit tests, 29 failures in 8 files, by cause

- **No `/bin/sh` and POSIX paths in launching** (spec §5.1, §5.2):
  - `sessionHost.test.ts` (11): the launch check looks on a POSIX `PATH` (`claude was not found on PATH (/usr/bin)`).
  - `sessionHost.pty.test.ts` (1): runs `/bin/sh`.
  - `launch.test.ts` (1): the hook command runs through `/bin/sh` (`spawnSync /bin/sh ENOENT`).
- **Shell-script stubs can't run.** `syncRun.test.ts` (9): the stand-in `claude-stub` is a shell script, which Windows can't spawn (`ENOENT`). One of these tests expects exit code 2 from a hook command run through a shell. Another, "a program that is missing rejects with why", builds a regular expression from a path, and the path's backslashes act as regex escapes.
- **POSIX paths in expectations.** `config.test.ts` (2): `/data` becomes `D:\data`.
- **POSIX file modes.** `managerService.test.ts` (2): Windows reports `mcp.json`'s mode as 0o666 (438) where the test expects 0o600 (384); Windows has no owner-only mode bits, so the test needs another way to check "only the owner can read it", or an exception.
- **The Mac clipboard.** `clipboard.test.ts` (2): the Finder file-copy formats are macOS-only (spec §8).
- **The status check.** `statusPassthrough.pty.test.ts` (1): the `own` test, which can't pass on Windows. Plan 2 makes the test check the mode Mainframe uses on each system.

### Windows: e2e, 80 of 89 fail, by cause

- **Sessions don't start** (about 47 tests): `Could not start the session: Cannot create process`. The e2e stand-in for `claude`, `fake-claude.sh`, isn't a program Windows can start (spec §10.2 plans a Node stand-in). This hides whatever else these tests would find.
- **The Todo sync never runs** (about 15 tests, in `todo.e2e.ts`): its stand-in is a shell script as well, so the panel never reaches the step that asks to allow the read tools (`todo-confirm-tools` not found).
- **Windows paths in CSS selectors** (at least 7 tests, most in `projects.e2e.ts`, one in `todo.e2e.ts`): the tests find a project with `[data-project="${dir}"]`. In a CSS string a backslash starts an escape (`\A` is a newline), so a `C:\Users\…` path never matches, although the page shows the rows. The page itself is fine; the e2e helpers must escape the path or match it another way.
- The rest fail after one of these, or on timing that may follow from them (seven `page.waitForFunction` timeouts). Re-read them once the first three causes are fixed.
