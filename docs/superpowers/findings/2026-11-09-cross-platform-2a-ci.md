# Findings: plan 2a's CI runs on three systems

Plan 2a of the cross-platform work, on branch `cross-platform`, 2026-11-09. Runs of the `Tests` workflow (Node 26.13.0, npm 11.20.0 on every system):

| Run | Commit | What it carried |
|---|---|---|
| 1 [42632932632](https://github.com/simekh/Mainframe/actions/runs/42632932632) | 35cef9a | Tasks 1–8, and the manager e2e's mode check guarded on Windows |
| 2 [42636498461](https://github.com/simekh/Mainframe/actions/runs/42636498461) | 49327aa | `npm start` fetches Electron first; the e2e width helper sizes the page; the Windows shell pid; the note test polls its launch |
| 3 [42638803313](https://github.com/simekh/Mainframe/actions/runs/42638803313) | 0b551fa | A quit writes localStorage to disk; the links test's Windows exception; the note test checks Start's focus |
| 4 [42640471196](https://github.com/simekh/Mainframe/actions/runs/42640471196) | ce4d8d5 | The note test waits for Start to be enabled |
| 5 [42647065988](https://github.com/simekh/Mainframe/actions/runs/42647065988) | d3b7874 | The final review's fixes (a stopped sync never kills a run that has exited) and this doc |
| 6 [42654071154](https://github.com/simekh/Mainframe/actions/runs/42654071154) | b32b644 | Windows diagnosis: a record of each session's PTY traffic, flood and first-key measurements; the Windows job runs only the four failing tests, four times each |
| 7 [42658101274](https://github.com/simekh/Mainframe/actions/runs/42658101274) | e7bcc35 | Node writes the flood; focus-out and resize measurements through Mainframe and through a bare PTY. The macOS job never got a runner (GitHub's capacity) and was cancelled with no steps |
| 8 [42661851204](https://github.com/simekh/Mainframe/actions/runs/42661851204) | 420dee1 | Diagnostics removed but the recorder; the Git Bash fix and the raw reader's test; the Windows job runs the five tests eight times each, then the whole suite |
| 9 [42664561097](https://github.com/simekh/Mainframe/actions/runs/42664561097) | be5c17a | The recorder removed; the workflow as in run 5 |

## Where each system stands (run 9)

| Step | macOS | Windows | Linux |
|---|---|---|---|
| Install (`npm ci`) | pass, no warning | pass, no warning | pass, no warning |
| Typecheck | pass | pass | pass |
| Unit tests | pass: 804 | pass: 804 | pass: 804 |
| Start as a friend does | (Linux only) | (Linux only) | pass: says it starts without the sandbox, still up after 90 s |
| Start with the setuid sandbox | (Linux only) | (Linux only) | pass: keeps the sandbox, says nothing, still up after 90 s |
| E2E tests | pass: 90 of 90 | pass: 90 of 90 | pass: 90 of 90 |

macOS and Linux have been green since run 2. Windows went from 80 failed e2e tests (plan 1) to 12 (run 1), 6 (run 2), 3 (runs 3 and 4), 2 (run 5), and none from run 8: all three systems are green.

The status check now runs inside the unit tests, and on Windows it checks the bundled ConPTY that Mainframe uses. Its line from Windows (run 2):

```
[status-check] win32 {"exitCode":0,"killed":false,"queryReachedHost":true,"da1Queries":2,"sawReply":true,"sawDa1":true,"replyFirst":true,"states":["working","blocked:question"]}
```

Windows' screen was 1920x1080 after the screen-size step in every run.

## What failed, by cause, and the fix

- **A fresh clone's `npm start` failed on every system** (Linux's two start steps, run 1: `Error: Electron uninstall`, then `chown: cannot dereference 'node_modules/electron/dist/chrome-sandbox'`). Electron 44 has no install script: it downloads its binary the first time something requires `electron`. electron-vite's preview reads `electron/path.txt` directly, which exists only after that download, and the setuid helper is part of the download too. The e2e tests passed because Playwright requires `electron`. A friend's first `npm start` would have failed the same way on a Mac. Fix: `scripts/start.mjs` requires `electron` first (fix commit `fix: npm start downloads Electron's binary first…`). `npm run dev` on a fresh clone still has the gap (it runs electron-vite directly); 2c's README or a dev script should cover it.
- **localStorage was lost across a restart on Windows** (4 tests in run 2: the projects' layout, the panel's width, the Todo panel's pin, Hide my tasks). Chromium keeps the renderer's latest localStorage writes in memory for a while, and on Windows they never reached the disk at quit. A friend on Windows would have lost these at every quit. Fix: `beginQuit` calls `session.defaultSession.flushStorageData()` first, on every system (it also runs on Windows' `session-end`). All four passed from run 3.
  - Open question: only Windows lost the writes at quit. An unclean Windows exit after `host.killAll()` (node-pty issue #983: a second kill can crash the process) would lose them the same way, and the flush would hide that. A Windows diagnostic run should log Electron's exit code after `app.close()` in a restart test.
- **The e2e width helper set the window's outer size** (7 tests in run 1, `window.innerWidth === w` timeouts). A Windows window's frame is wider than its page. Fix: `setContentSize` (test only).
- **Git Bash's `$$` is an MSYS process id** (run 1, "Close session…": the other tasks' shells read as gone). `process.kill` takes the Windows id, which Git Bash keeps in `/proc/$$/winpid`. Fix: the terminal tests read that on Windows (test only). The quit test that checks the shell is gone now checks a real Windows process too, and passes.
- **The note test raced the session's start and the ticket's start check** (macOS and Linux in run 1, Windows in runs 1–3). It read the launch log once, right after the terminal took the focus, before the fake `claude` had logged its launch (the Node fake starts later than the old shell script did). And it focused Start while the start check that opening a ticket runs still had Start disabled; on Windows git is slower, so the focus never took. Fix: poll the launch log, wait for Start to be enabled, check it has the focus (test only).
- **Mouse reports can't be seen on Windows** (links test, runs 1 and 2: no report reached the screen). ConPTY hands mouse input to the program as console mouse events, not bytes, and the test's reader, Git Bash's `cat -v`, reads none of those. The terminal code that sends the reports is the same on every system and macOS and Linux check it. Fix: on Windows the test checks only that the Cmd+click opens the link, and says why. This cause is inferred from how ConPTY's input works, not proven on a Windows machine.
- **The manager e2e's `0o600` check** (known before run 1): guarded on Windows as the unit test is (spec §10.2).

## The last Windows failures: two causes, both in the tests' shell, both fixed

Four tests failed on Windows now and then, with no change in the code (runs 1–5):

| Test | Failed in (runs 1–5) | What it showed |
|---|---|---|
| `terminal.e2e.ts` "a flood in a hidden task arrives in full" | runs 1, 3, 4, 4's rerun and 5 | After 30 s the hidden task's screen is still all `mainframe` lines; `flood-5` hasn't arrived |
| `session-panel.e2e.ts` "switching tasks resizes no terminal off screen…" | runs 3, 4 and 4's rerun | `stty size` in the shell doesn't show the size the terminal shows, within 5 s |
| `tasks.e2e.ts` "tasks reopened at startup start at the size their terminal shows" | run 4 | The same check as above, after a restart |
| `manager.e2e.ts` "unpinned, the manager floats over the board…" | 4's rerun and 5 | The task's glyph never shows `ask` after the shell reports the state (line 296) |

Runs 6 and 7 diagnosed them. A recorder in the e2e helpers (test only, since removed) kept each session's PTY traffic in main: the keys written, the resizes, the pauses and resumes, and the output per second, and wrote it out when a test failed. A unit test (also removed) measured the same things through a bare PTY, with no Electron or xterm.js. Both causes are in Git Bash, which the tests run where Claude Code would run. Mainframe passed each resize on at once, and its pause and resume worked whenever output was fast enough to need them (below).

- **The flood: Git Bash writes to Windows' console slowly.** Under the bundled ConPTY, `yes mainframe | head -c 3000000` arrives at a steady 80 KB/s or so: 41.9 s and 46.8 s with the task hidden, 45.4 s with it shown (run 6), against the test's 30 s. Through the bare PTY, with no Mainframe at all, it took 42.6 s. The recorder showed Mainframe never paused the session and output flowed the whole time, so the failure was not the product bug it could have meant: a hidden task's output stalling under Mainframe's pause and resume. Node writing the same 3 MB took 0.2 s through the bare PTY and 1.1–1.2 s through Mainframe (run 7). That run is the one that answers whether a hidden task stalls: with node writing, Mainframe paused the hidden session 2 to 4 times, resumed it as often, and all 3,300,146 bytes arrived. (Git Bash's floods were too slow to reach the 256 KB mark, so they never paused at all.) macOS and Linux take under 1.6 s either way. Fix: node writes the flood, as Claude Code writes its output (test only, `0a48516`). The test passed 4 of 4 in run 7, 8 of 8 in run 8, and in run 9's whole suite.
- **The size checks and the manager's report: Git Bash loses its first key after a resize.** Under ConPTY, Git Bash sometimes notices a resize only when its next key arrives; then it redraws its prompt and drops that key. In the recorder's session-panel failure (run 6), the terminal reported a focus-out (`ESC [ O`), Mainframe resized the PTY 25 ms later and Git Bash showed nothing; when `stty size` arrived, Git Bash redrew its prompt and ran `tty size` (`tty: extra operand`). Run 7's session-panel failure was the same. In its manager failure, the focus-out came half a second before the resize, and Git Bash ran `rintf` for `printf`. Wherever Git Bash redrew at once (2–17 ms after the resize), no key was lost.
  - Through the bare PTY, Git Bash lost the first key in 2 of 8 resizes that came shortly after a focus report, and in none of 4 without one. Too few to tell a focus-out just before the resize from a terminal that simply isn't focused when it comes: in the manager failure the focus-out was the unfocused terminal's report at startup, about 480 ms earlier.
  - A program that reads its terminal raw, as Claude Code does, saw each resize within about 1 ms and lost no key in 41 cases (29 through Mainframe, 12 through the bare PTY).
  - With the terminal focused, so with no focus report, neither Git Bash nor the raw reader lost a key in 42 cases (run 6). macOS and Linux never lost one.
  - Mainframe reports the focus because ConPTY asks for it (`ESC [?1004h`), and passes each resize on as it should. So the cause is the tests' shell, not the product.
  - Fix (test only, `1462364`): `sendAfterResize` (`e2e/tasks.ts`) sends a lone Enter before a line that must arrive whole after a resize, for Git Bash to lose. A new test (`708b16b`), "a program that reads the terminal raw, as Claude Code does, sees a resize at once and then every key" (`terminal.e2e.ts`), guards what that rests on, on every system: after a focus-out and a resize, a raw reader sees the new size and reads the next line whole. In run 8 the three fixed tests passed 8 of 8 each and the guard 8 of 8, and then the whole suite passed on Windows, 90 of 90; run 9 passed it again on all three systems. Before the fix, the session-panel test had failed 1 of 4 in runs 6 and 7, and the manager test 1 of 4 in run 7.
  - Why Git Bash notices late is inferred: Cygwin, which Git Bash's MSYS runtime comes from, handles a resize (SIGWINCH) while it reads console input. It was not traced inside the runtime.

Also seen through the bare PTY: the bundled ConPTY waits about 3 s at startup when nothing answers its DA1 query (`ESC [c`). In Mainframe, xterm.js answers it.

Also seen on the Mac, locally: `projects.e2e.ts` "each open project has its own board and manager…" timed out (31.5 s) in 1 of 10 runs, while four e2e files ran at once; it passed alone 8 times, and once in the next full run. It timed out again in a full local run during the Windows diagnosis, and passed alone 6 of 6 right after. That time the failing line was captured: line 48, `rowButton(page, acme, 'rail-beside')`, whose button shows only while the pointer is on the row. The test hovers the row once, then the click waited 30 s with the button "not visible". The manager's terminal had the focus and both projects' managers still showed "Starting…". Not diagnosed further: it has not failed on CI, and it is outside the Windows work.

## What earlier reviews said only CI can prove

- **Task 2:** the bundled ConPTY (`useConptyDll`) works on the runner: sessions start, the status check passes. One kill per pty: "Close session" ends the shell and leaves the others running (run 2 on). `session-end` on shutdown can't happen on CI: owner's Windows check.
- **Task 4:** `taskkill` in `%SystemRoot%\System32` runs: `todo.e2e.ts`'s stopped-sync check passes on Windows, where a held fake ends only when it is stopped, so `stoppedSyncs` passing shows `taskkill` ended it. The unit test of the stop uses a `killTree` spy and never runs `taskkill`. Nothing yet proves the `/T` part: that the run's children end too.
- **Task 6:** the SEA build and `FAKE_CLAUDE_EXE` reach the workers (sessions start on Windows); Git Bash under ConPTY runs the typed commands (all but mouse input, above); Windows' `stoppedSyncs` passes in the Todo tests. The doubled first key once seen locally in `terminal.e2e.ts`'s "Close session" test (`eecho`) was not seen in runs 2–4.
- **Task 7:** the manager e2e's mode check, guarded as above.
- **Task 8:** both Linux start steps pass: the runner's AppArmor restriction is on by default (the first step said it starts without the sandbox), and Ubuntu 24.04 accepts the setuid helper. `allowScripts` silences npm's install-script warning on all three. The Mac runner's screen fits the e2e window now (89 of 89).

## Still open: for 2c, a later Windows run and the owner's Windows PC check (spec §10.4)

The Windows failures themselves are done: diagnosed and fixed by cause (runs 6–9, above). Both causes were in the tests' shell; Mainframe needed no change.

- **A later Windows diagnostic run:** Electron's exit code after `app.close()` in a restart test (the open question under the localStorage fix, above) is answered in the 2b section below: 0xC0000409 at some quits. What stays open is its cause.
- **2c:** `npm run dev` on a fresh clone (Electron's binary isn't there yet); the README's Linux note, since the setuid helper exists only after the first `npm start`; Ctrl+click opens a link on Windows and Linux (spec §6), and `e2e/links.e2e.ts`'s click, which holds the Meta key on every system, must follow it. (The 2c section at the end says where each of these stands.)
- **The owner's Windows PC:** a real Claude Code under the bundled ConPTY with its status on the board; that the layout, widths and pins survive a quit and a Windows shutdown (`session-end`); clicking in a Claude Code session that asks for the mouse; closing a project while one of its sessions is busy, then checking that no `claude.exe` is left (the one case where the one-kill-per-pty rule could leak a process); with a real Claude Code session open, narrowing its panel and typing at once, with no first key lost (the e2e guard uses a raw-reading stand-in for Claude Code, so this checks the real thing).

## 2b: the setup window's CI runs

Plan 2b (the setup screen, Tasks 1–6, then its final review's fixes) was pushed nine times; Node 26.13.0 on every system again. macOS and Linux were green from the first run. Windows found three things in the tests' own set-up, and one bug in the product (the layout lost across a restart), which is fixed.

| Run | Commit | What it carried | macOS | Windows | Linux |
|---|---|---|---|---|---|
| 1 [42690683925](https://github.com/simekh/Mainframe/actions/runs/42690683925) | 3abbe42 | Tasks 1–6 | 99 pass | 89 pass, 10 fail | 99 pass |
| 2 [42692754480](https://github.com/simekh/Mainframe/actions/runs/42692754480) | 83e21a5 | the Windows claude rename, clean-up retries, a launch-environment diagnostic | pass | 92 pass, 8 fail | pass |
| 3 [42694176721](https://github.com/simekh/Mainframe/actions/runs/42694176721) | f385e52 | a profile folder with its AppData folders for the stand-in computer, a narrower diagnostic | pass | 100 pass | pass |
| 4 [42695655131](https://github.com/simekh/Mainframe/actions/runs/42695655131) | c5c113d | diagnostic removed, the profile folder narrowed to `AppData\Roaming` | pass | 97 pass, 2 fail | pass |
| 5 [42697598060](https://github.com/simekh/Mainframe/actions/runs/42697598060) | 48a2bee | the reload test's lone Enter, a quit-survival diagnostic, the reload test repeated 12 times | pass | 99 pass, 1 fail | pass |
| 6 [42699856141](https://github.com/simekh/Mainframe/actions/runs/42699856141) | c9d816d | diagnostics of the layout test, repeated 8 times (its repeat step does not fail the job) | 99 pass | 99 pass; the repeat failed 1 of 8 | 99 pass |
| 7 [42703250267](https://github.com/simekh/Mainframe/actions/runs/42703250267) | 03464dc | the layout fix, and a Windows step repeating the two layout restart tests 15 times each | 99 pass | 99 pass; the repeat 29 of 30 (a hang, below). The same job run again: 99 pass, repeat 30 of 30 | 99 pass |
| 8 [42706910856](https://github.com/simekh/Mainframe/actions/runs/42706910856) | f55721a | the repeat step removed: the fix on its own | 99 pass | 99 pass | 99 pass |
| 9 [42712677180](https://github.com/simekh/Mainframe/actions/runs/42712677180) | 9dacaff | the final review's fixes (an absolute `MAINFRAME_CLAUDE_BIN`, npm prefixes on Windows, a failed pick shows its path, the Find claude… dialog's options) and this doc's corrections | 99 pass | first attempt 98 pass, 1 fail: `shortcuts.e2e.ts:49` (Tab-completion after Ctrl+Tab, a flake); the same job run again: 99 pass | 99 pass |

Run 8 is green on all three systems, 921 unit tests and 99 e2e tests each. Run 9 is too, with 933 unit tests and 99 e2e tests each, once its Windows job had run again.

- **Electron crashes at launch on Windows when `USERPROFILE` names a folder with no `AppData\Roaming` in it** (run 1, all 8 setup tests: `electron.launch: Process failed to launch`, exit code 0x80000003, a Chromium CHECK). The setup tests give the app a stand-in computer: empty home, `HOME`, `USERPROFILE` and `APPDATA` pointing at it. Run 2's diagnostic launched Electron with one variable changed at a time: `PATH` restricted (with and without System32), `HOME` and `APPDATA` alone launched; `USERPROFILE` alone crashed. Run 3 gave `USERPROFILE` a folder with `AppData\Roaming` alone (launched), `AppData\Local` alone (crashed), both (launched), a full profile skeleton (launched), an empty folder (crashed) and `C:\Users\Public` (crashed). Why Electron needs it was not traced; Windows resolves the roaming-AppData known folder from `USERPROFILE`, so the cause is probably in what Electron does with that folder at start. Fix (test only): `computer()` in `e2e/setup.e2e.ts` creates `AppData\Roaming` in the stand-in home on Windows, with the evidence as a comment. After it, all 8 setup tests pass on Windows (the Windows paths: `claude.exe` in `.local\bin`, the `Path` key, a PATH of node's and Git's folders), and the git-missing and moved-claude tests behave as on the Mac.
- **`rmSync` of a running program fails on Windows** (run 1, two tasks tests, `EPERM` at `rmSync(claude)` in `launchWithClaudeGone`). The copied stand-in `claude.exe` is what the project's manager is running when the test deletes it, and Windows won't delete a running program. Windows does let one be renamed, which takes it off its path just the same (the folder goes with the test). Fix (test only): rename on Windows, delete elsewhere; clean-up's folder removal retries (`maxRetries`), since Windows keeps a program's file locked until its process has gone. Both tests pass from run 2.
- **Git Bash lost the first key of a line after the reload** (run 4: `bash: cho: command not found` in "reloading the window keeps running tasks running"). It is the 2a cause (a resize, then Git Bash drops its next key): the card click brings the task's terminal on screen at its size there. Fix (test only): `sendAfterResize`, as in the other tests; 12 of 12 in run 5's repeat (it had failed in 1 of the 4 earlier runs).
- **The layout was lost across a restart on Windows now and then; fixed** (`projects.e2e.ts` "each open project has its own board and manager…": the second project is not on screen after the restart. Failed in runs 4 and 5, passed in runs 1–3 and in run 6's full suite, failed 1 of 8 in run 6's repeat; it is not among the failures listed above for plan 2a's nine runs). What run 6's diagnostics showed, in the failing restart: the layout Chromium kept is complete (the page held both projects, and the database file on disk held the same list, before the restart), and after the restart the page's layout holds only the first project to have opened, with the weights and the manager flag of that project alone, which is `fitLayout` run on a list of one project, followed by the whole list. So a list of the projects open so far reached the renderer's layout fit after the renderer had asked for the list: the bug R9 fixed in Task 5 by ignoring `projects:changed` until `loadProjects()` was called. That fix rested on the page seeing each `projects:changed` event before the reply to `getSetup`, and Electron's documentation says nothing about the order of a `webContents.send` and an `ipcRenderer.invoke` reply. Which message came late (the reply or an event) was not shown, because the page logged nothing. Fix (product, `4116ddc`): main sends no `projects:changed` while `start` opens the projects (the page takes the whole list from `listProjects()` once the setup is over, and a later Open Project… still sends its whole-list event), and the renderer's `asked` guard is gone, since no partial list is sent any more. The slow-check restart test (`projects.e2e.ts`, `FAKE_CLAUDE_VERSION_DELAY_MS`) is the regression test: on the Mac, with the guard removed and main unchanged it failed 3 of 3, and with main's change it passed (10 of 10, and 24 of 24 beside the layout test). On Windows, the layout test passed 30 of 30 repeats (15 in run 7, 15 in its rerun) and the full suite passed three times (run 7, its rerun, run 8); the other restart test, the slow-check one, passed 14 of 15 in run 7 (the hang below) and 15 of 15 in the rerun. Before the fix the layout test failed in 2 of the 6 full runs (runs 1–6) and in 1 of 8 repeats. It is not shown that the cause was an event arriving after the reply and not an early reply; main now sends nothing the order could matter for, and `getSetup` still waits for the start, so an early reply is not how it would happen.
- **Electron's exit code after `app.close()` on Windows (2a's open question) is 0xC0000409 at some quits** (run 5's diagnostic: 2 of 24 quits with one project open; run 6: 6 of 9 quits with two projects and a task's session). That is `STATUS_FAST_FAIL`, a crash at exit; the quit takes about 500 ms instead of 160 ms when it happens. No data was lost in any of them: all 24 localStorage writes made just before a quit were on disk after it (the flush at quit works, with the write made at once or 6 s before), and it does not correlate with the layout failure (5 of the 8 passing restarts in run 6 had it too). The cause was not traced; the sessions' kill at quit (`host.killAll()`, node-pty's second-kill crash, issue #983, from 2a's note) is the first suspect. For the owner's Windows check (spec §10.4): whether a quit then shows an error dialog, and whether the next start is clean.
- **One hang, once, in a Windows restart test** (run 7's repeat: "a restart whose start-up check is slow…" ran into the 60 s test timeout, then clean-up's `rmSync` of its data folder failed with `EPERM` after its retries, and the worker's teardown timed out: an Electron process was still running). It did not come back in the rerun of the same commit (30 of 30), and the layout assertion was not what failed. The cause was not traced; a quit that does not end, next to the 0xC0000409 crash above, is the first suspect. On the Mac the same test took 31 s and failed once in 18 local runs, which looks like the Mac flake in the 2a note above (its failing line was not captured this time).

**What cannot behave as on the Mac:** the stand-in computer on Windows has the `AppData\Roaming` folder Electron needs; the "claude can't start" tests rename the file where POSIX deletes it; the stand-in computer's PATH on Windows holds node's own folder and Git's own folder, where POSIX has a folder of links to them. Nothing in the product differs.

**For 2c, and the owner's Windows PC:** look into the 0xC0000409 at quit and the one hang; a real Claude Code under the setup screen on Windows (`%USERPROFILE%\.local\bin\claude.exe` found without any PATH) is still unchecked. (2c traced the crash to node-pty; see the 2c section below.)

## 2c: native keys, window and terminals on Windows and Linux

Plan 2c (Tasks 1–6: the window per system, Ctrl-based keys, terminal copy and paste, the Windows terminal, the Windows file and git fixes, the README) was pushed four times, the last for its task review's fix, and a fifth time for its final review's fixes (push 5 of the 9 the owner's waiver allows); Node 26.13.0 on every system, 1055 unit tests on each in runs 1–4 and 1074 in run 5.

| Run | Commit | What it carried | macOS | Windows | Linux |
|---|---|---|---|---|---|
| 1 [42805058246](https://github.com/simekh/Mainframe/actions/runs/42805058246) | c93943f | Tasks 1–6, and a temporary Windows step that repeated quits (the crash, below) | 101 pass | 104 pass, 1 fail: `todo.e2e.ts:285` | 104 pass, 1 fail: `terminal.e2e.ts:157` |
| 2 [42808065681](https://github.com/simekh/Mainframe/actions/runs/42808065681) | 08f5438 | the quit step removed; the Todo panel test waits for the panel's slide; a temporary diagnostic in the scaling test | 101 pass | 105 pass | 104 pass, 1 fail: the scaling test again |
| 3 [42809769043](https://github.com/simekh/Mainframe/actions/runs/42809769043) | 5091b6d | the scaling test's fix, the diagnostic removed | 101 pass | 105 pass | 104 pass, the scaling test skipped (no WebGL2, below) |
| 4 [42813197626](https://github.com/simekh/Mainframe/actions/runs/42813197626) | 543f286 | the scaling test skips only on Linux, and only when the fit after the change is the size before it; this section's first version (`2165f40`) | 101 pass | 105 pass, the scaling test among them | 104 pass, the scaling test skipped on its precondition (the fit after the change is the size before it) |
| 5 [42824535442](https://github.com/simekh/Mainframe/actions/runs/42824535442) | fd42c27 | the final review's fixes: the Mac's menu from the first moment, the rename retry on Windows only, Windows' stand-in shell from the git on PATH, Ctrl letters on layouts without Latin letters, the clipboard given back, a Mac test of the scaling re-fit's exclusion | 102 pass, 4 skipped | 105 pass, 1 skipped | 104 pass, 2 skipped |

macOS skips the four tests of Windows and Linux keys and behaviour (below) in every run. In run 1, six more tests were skipped on every system: the quit step's own tests, which the e2e step leaves out. Runs 3, 4 and 5 are green on all three systems. Both Linux start steps passed in every run. Run 5 added one test, the Mac's: a terminal keeps its size when the scaling changes. It ran on the Mac (102 passed) and skips on Windows and Linux, so Windows' one skip and Linux's second are that test, and Windows still skipped none of the others. (CI's reporter does not name skipped tests; this is read from the counts: 106 tests on each system, 105 before.) On Windows, run 5 also derived the stand-in's Git Bash from the git on PATH instead of the fixed Program Files path: every shell-based test passed.

**What the tests showed off the Mac.** The four tests that skip on the Mac all ran on Windows, in every run. They all ran on Linux too, but the scaling test skips there from run 3 on (below). Run 1's six quit-step tests, left out of its e2e step on every system, ran only in the separate quit step. The tests with a Mac branch and a Windows/Linux branch took their Windows/Linux branch. All of them passed, but for the scaling test on Linux:

- Task 1, the window: `app.e2e.ts`'s window test (no application menu, `isMenuBarVisible()` false, the project list's top row with no room for window buttons, the top bar no drag region, `data-platform`); the setup screen's 8 px title row; no drag regions in `manager.e2e.ts` and `session-panel.e2e.ts`; Open Project… through the project list's button.
- Task 2, the keys: Ctrl+Shift+O opens Open Project… (`app.e2e.ts`), and on the setup screen opens no dialog and raises no error (`setup.e2e.ts`); the Control branches of `projects.e2e.ts`, `links.e2e.ts` (Ctrl+click) and `tasks.e2e.ts`.
- Task 3, copy and paste: `terminal.e2e.ts`'s Ctrl+Shift+C, Ctrl+C with and without a selection, Ctrl+V and Ctrl+Shift+V. On Windows the Ctrl+C that interrupts `cat` left the stand-in `claude` running: ConPTY's Ctrl+C did not end it, so `e2e/fake-claude.cjs` is unchanged. `board.e2e.ts`'s Shift+PageUp.
- Task 4: the scaling re-fit on Windows (with WebGL, 54x41 became 50x41 at twice the pixel ratio). On Linux CI it can't be shown (below).

### What failed, by cause, and the fix

- **The Todo panel test measured the floating panel while it slid in** (Windows, run 1: `todo.e2e.ts:285`, width 303.99998474121094 where 304 was expected). The floating panel is visible from the start of its 220 ms slide (`transform: translateX`), and under a fractional transform Chromium's box is off by one float32 step (304 − 2⁻¹⁶). The slower Windows runner measured it mid-slide. Fix (test only, `230ecc2`): the test waits for the panel's animations to finish before both width checks, as `panel.e2e.ts` already does. It passed on Windows in runs 2–4.
- **The scaling re-fit test can't show a re-fit on Linux CI** (runs 1 and 2: the fit after the pixel ratio went from 1 to 2 was still 50x43). Run 2's diagnostic showed the cause.
  - Linux CI's virtual display has no WebGL2, so xterm keeps its DOM renderer there. That renderer rounds a character's height up to whole device pixels at each ratio (`DomRenderer._updateDimensions`), so its cells do follow the ratio when the character's height isn't a whole number: a 16.4 px character gives 17 px at 1x and 16.5 px at 2x. With Linux CI's font, though, the DOM renderer's rounded cell is 17 px high at 1x and at 2x, so the fit is the same at both ratios.
  - The page did see the change, through the same media query xterm listens to (`screen and (resolution: 1dppx)` fired its change).
  - On Windows CI, WebGL's cells are whole device pixels, and the same change gave 54x41, then 50x41.
  - So the product is right: Mainframe compares the ratio and fits again on any renderer, and on Linux CI that fit is the size the terminal already has.
  - Fix (test only, `5091b6d`, narrowed in `543f286` after the task review): the test skips on Linux only, and only when the fit after the change is the size before it, saying why (spec §10.2). Everywhere else it asserts that the fit changes, with a message saying a same fit means the renderer changed, as when WebGL is missing. A broken re-fit still fails wherever the fit changes, since the terminal would stay at its old size.
  - It passes on Windows and skips on Linux CI (runs 3 and 4; in run 4 on the narrowed precondition). Whether a Linux desktop re-fits when its scaling changes is for a friend's first try.

No known flake came back in runs 1–4 (`projects.e2e.ts`' row-button hover, `session-panel.e2e.ts:117`'s 12 s budget, `shortcuts.e2e.ts:49` and `:109`, `board.e2e.ts:139`, `todo.e2e.ts:254`).

### The crash at a Windows quit (0xC0000409): node-pty's, at a quit with sessions still running

Run 1's temporary Windows step quit Mainframe over and over and logged Electron's exit code each time. Its stderr was taken with `ELECTRON_ENABLE_STACK_DUMPING=1`.

| Quit | Exit 0xC0000409 |
|---|---|
| At the setup screen, no project and no session (through Playwright's `app.close()`) | 0 of 8 |
| With the manager's and a task's session running | 6 of 10 |
| After both sessions ended on their own (`exit` typed) | 0 of 8 |
| 3 s after Close project ended both sessions | 0 of 8 |
| A user's close of the window (`taskkill` without `/F` sends WM_CLOSE; no Playwright), two projects' managers running | 2 of 10 |
| A user's close of the window at the setup screen | 0 of 5 |

So the crash comes only when sessions are still running at the quit, and a user's own quit gets it too, so it isn't something Playwright causes. A crashing quit took about 600 ms; the others took about 160 ms (WM_CLOSE: about 210 ms). None of the 49 quits hung, and 2b's one hang did not come back.

- **What crashes.** stderr says `Received fatal exception 0xe06d7363`, a C++ exception, raised through `KERNELBASE!RaiseException`. The exception record's image base and type pointer point into node-pty 1.1.0's `prebuilds/win32-x64/conpty.node`. Its type information there names `Napi::Error`, and the frames, mapped with the package's own `conpty.pdb`, are `_CxxThrowException` called from `Napi::Error::ThrowAsJavaScriptException`. A C++ exception that nothing catches ends the process with `abort()`, which is the 0xC0000409 (`FAST_FAIL_FATAL_APP_EXIT`).
- **Why.** This is node-pty's open issue [#951](https://github.com/microsoft/node-pty/issues/951). On Windows, node-pty reports a pty's exit through a thread-safe function. When that exit arrives while Node's environment is being torn down, node-addon-api can no longer throw to JavaScript and throws a C++ exception instead, which aborts the process. node-addon-api has a guard for exactly this, `NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS`, and node-pty doesn't build with it. The one-line fix, [PR #954](https://github.com/microsoft/node-pty/pull/954), is open and in no release: 1.1.0 is the latest, and 1.2.0-beta.18 is a beta.
- **Mainframe's part.** At a quit, `beginQuit` kills every pty and Electron exits at once, so the ptys' exits land in the teardown. Sessions that had ended before the quit never crashed it.
- **What it costs today.** Nothing was lost in any quit seen: `beginQuit` records the tasks and flushes the page's storage before the kills (2b checked 24 of 24 writes). What a user sees is for the owner's Windows PC (below).
- **The owner's open choice.** (a) Leave it until a node-pty release carries PR #954; updating node-pty is the owner's separate decision anyway. Or (b) a Windows-only quit that holds Electron's exit until every killed pty has reported its exit, with a time limit of a second or two, so no exit lands in the teardown. (b) makes a Windows quit with sessions slower by about the time the exits take, and is code that works around a dependency's bug. Not done in 2c: the crash is node-pty's, and the plan said to record it and stop there. (b) is Trello card #12 on the Mainframe board, "Windows: investigate the quit crash while sessions run (node-pty #951)": https://trello.com/c/zmQ786Th.

### Still open: the owner's Windows PC, and a friend's Linux

On Windows (spec §10.4), with a real Claude Code:

- A session under the bundled ConPTY, with its status on the board. The setup screen finds `%USERPROFILE%\.local\bin\claude.exe` with no PATH.
- Copy and paste in a session:
  - Ctrl+C with a selection copies once and clears it, and the next Ctrl+C interrupts.
  - Ctrl+Shift+C always copies.
  - Ctrl+V and Ctrl+Shift+V paste once.
- The right-click menu over a terminal:
  - Copy is enabled only with a selection, and it copies the cleaned text.
  - Copy is disabled with nothing selected.
  - Paste pastes once: text, an image, a file.
- Paths into a session:
  - A file or an image copied in Windows' Explorer pastes as its path at all.
  - Claude Code attaches a dropped or pasted image path in double quotes.
  - A dropped path with spaces (`C:\Users\Anna Berg\Pictures\shot 1.png`) is attached.
  - Two files dropped at once go in as two paths, one space apart, each in double quotes when it has a space, and Claude Code attaches both. No test covers this join.
- Ctrl+Backspace deletes a word.
- A wheel notch scrolls about three rows.
- Alt moves the focus nowhere, since there is no menu bar.
- AltGr on a Nordic or German layout types `@ { [ ] } \ |` in a terminal and in the New task box, and no shortcut fires.
- On a Russian layout (or any without Latin letters), Ctrl+C copies a selection, Ctrl+V pastes, and Ctrl+Shift+W and Ctrl+Shift+O take a pane off screen and open a project. The final review's fix makes them take the letter on the key itself there (`e.code`); a Latin layout's own letters (Dvorak, AZERTY) still count as they are. Only unit tests cover it.
- A real change of scaling re-fits the terminal: the window moved to a screen with other scaling, or Windows' scaling changed.
- A quit with sessions running:
  - whether Windows shows a crash dialog or report (the 0xC0000409 above);
  - that the next start is clean, with every task back.
- How long a quit takes with several sessions, when a data file is held for good by another program (an antivirus or a sync tool): each save then costs about a second.
- The layout, widths and pins survive a quit and a Windows shutdown (`session-end`).
- Clicking in a session that asks for the mouse.
- Closing a project while one of its sessions is busy leaves no `claude.exe` behind.
- Narrowing a session's panel while typing loses no first key.
- `npm run dev` on a fresh clone: CI runs only `npm start` and the e2e build.
- The README's note on Windows PowerShell's execution policy works as written.

On Linux, a friend's first try:

- The README's Linux note (run its two sandbox lines after the first `npm start`, which downloads Electron and its `chrome-sandbox`) is what CI's two Linux start steps do, in that order, and both passed in every run. A friend checks it on a desktop.
- A terminal re-fits when the desktop's scaling changes.

**What cannot behave as on the Mac in 2c's tests:** on Linux the scaling re-fit test skips when the change can't show there (above). The Mac skips the four tests of Windows and Linux keys and behaviour, since Playwright's keys never reach the Mac's menu and the Mac keeps today's fit.
