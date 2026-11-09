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

Runs 6 and 7 diagnosed them. A recorder in the e2e helpers (test only, since removed) kept each session's PTY traffic in main: the keys written, the resizes, the pauses and resumes, and the output per second, and wrote it out when a test failed. A unit test (also removed) measured the same things through a bare PTY, with no Electron or xterm.js. Both causes are in Git Bash, which the tests run where Claude Code would run. Mainframe's flow control and resizes worked in every recorded case.

- **The flood: Git Bash writes to Windows' console slowly.** Under the bundled ConPTY, `yes mainframe | head -c 3000000` arrives at a steady 80 KB/s or so: 41.9 s and 46.8 s with the task hidden, 45.4 s with it shown (run 6), against the test's 30 s. Through the bare PTY, with no Mainframe at all, it took 42.6 s. The recorder showed Mainframe never paused the session and output flowed the whole time, so the failure was not the product bug it could have meant: a hidden task's output stalling under Mainframe's pause and resume. Node writing the same 3 MB took 0.2 s through the bare PTY and 1.1–1.2 s through Mainframe (run 7). macOS and Linux take under 1.6 s either way. Fix: node writes the flood, as Claude Code writes its output (test only, `0a48516`). The test passed 4 of 4 in run 7, 8 of 8 in run 8, and in run 9's whole suite.
- **The size checks and the manager's report: Git Bash loses its first key after a resize.** Under ConPTY, Git Bash sometimes notices a resize only when its next key arrives; then it redraws its prompt and drops that key. In the recorder's session-panel failure (run 6), the terminal reported a focus-out (`ESC [ O`), Mainframe resized the PTY 25 ms later and Git Bash showed nothing; when `stty size` arrived, Git Bash redrew its prompt and ran `tty size` (`tty: extra operand`). Run 7's session-panel failure was the same. In its manager failure, the focus-out came half a second before the resize, and Git Bash ran `rintf` for `printf`. Wherever Git Bash redrew at once (2–17 ms after the resize), no key was lost.
  - Through the bare PTY, Git Bash lost the first key in 2 of 8 resizes that came shortly after a focus report, and in none of 4 without one.
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
- **Task 6:** the SEA build and `FAKE_CLAUDE_EXE` reach the workers (sessions start on Windows); Git Bash under ConPTY runs the typed commands (all but mouse input, above); Windows' `stoppedSyncs` passes in the Todo tests. `terminal.e2e.ts:142`'s doubled first key was not seen in runs 2–4.
- **Task 7:** the manager e2e's mode check, guarded as above.
- **Task 8:** both Linux start steps pass: the runner's AppArmor restriction is on by default (the first step said it starts without the sandbox), and Ubuntu 24.04 accepts the setuid helper. `allowScripts` silences npm's install-script warning on all three. The Mac runner's screen fits the e2e window now (89 of 89).

## For the owner, 2c and the owner's Windows PC check (spec §10.4)

- **Done:** the Windows failures were diagnosed and fixed by cause (runs 6–9, above). Both causes were in the tests' shell; Mainframe needed no change.
- **2c:** `npm run dev` on a fresh clone (Electron's binary isn't there yet); the README's Linux note, since the setuid helper exists only after the first `npm start`; Ctrl+click opens a link on Windows and Linux (spec §6), and `e2e/links.e2e.ts`'s click, which holds the Meta key on every system, must follow it.
- **The owner's Windows PC:** a real Claude Code under the bundled ConPTY with its status on the board; that the layout, widths and pins survive a quit and a Windows shutdown (`session-end`); clicking in a Claude Code session that asks for the mouse; closing a project while one of its sessions is busy, then checking that no `claude.exe` is left (the one case where the one-kill-per-pty rule could leak a process).
