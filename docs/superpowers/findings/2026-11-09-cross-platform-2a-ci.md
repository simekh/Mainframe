# Findings: plan 2a's CI runs on three systems

Plan 2a of the cross-platform work, on branch `cross-platform`, 2026-11-09. Runs of the `Tests` workflow (Node 26.13.0, npm 11.20.0 on every system):

| Run | Commit | What it carried |
|---|---|---|
| 1 [42632932632](https://github.com/simekh/Mainframe/actions/runs/42632932632) | 35cef9a | Tasks 1–8, and the manager e2e's mode check guarded on Windows |
| 2 [42636498461](https://github.com/simekh/Mainframe/actions/runs/42636498461) | 49327aa | `npm start` fetches Electron first; the e2e width helper sizes the page; the Windows shell pid; the note test polls its launch |
| 3 [42638803313](https://github.com/simekh/Mainframe/actions/runs/42638803313) | 0b551fa | A quit writes localStorage to disk; the links test's Windows exception; the note test checks Start's focus |
| 4 [42640471196](https://github.com/simekh/Mainframe/actions/runs/42640471196) | ce4d8d5 | The note test waits for Start to be enabled |

## Where each system stands (run 4)

| Step | macOS | Windows | Linux |
|---|---|---|---|
| Install (`npm ci`) | pass, no warning | pass, no warning | pass, no warning |
| Typecheck | pass | pass | pass |
| Unit tests | pass: 803 | pass: 803 | pass: 803 |
| Start as a friend does | (Linux only) | (Linux only) | pass: says it starts without the sandbox, still up after 90 s |
| Start with the setuid sandbox | (Linux only) | (Linux only) | pass: keeps the sandbox, says nothing, still up after 90 s |
| E2E tests | pass: 89 of 89 | 86 of 89, in run 4 and its rerun; the ones that fail change from run to run, below | pass: 89 of 89 |

macOS and Linux have been green since run 2. Windows went from 80 failed e2e tests (plan 1) to 12 (run 1), 6 (run 2), 3 (runs 3 and 4).

The status check now runs inside the unit tests, and on Windows it checks the bundled ConPTY that Mainframe uses. Its line from Windows (run 2):

```
[status-check] win32 {"exitCode":0,"killed":false,"queryReachedHost":true,"da1Queries":2,"sawReply":true,"sawDa1":true,"replyFirst":true,"states":["working","blocked:question"]}
```

Windows' screen was 1920x1080 after the screen-size step in every run.

## What failed, by cause, and the fix

- **A fresh clone's `npm start` failed on every system** (Linux's two start steps, run 1: `Error: Electron uninstall`, then `chown: cannot dereference 'node_modules/electron/dist/chrome-sandbox'`). Electron 44 has no install script: it downloads its binary the first time something requires `electron`. electron-vite's preview reads `electron/path.txt` directly, which exists only after that download, and the setuid helper is part of the download too. The e2e tests passed because Playwright requires `electron`. A friend's first `npm start` would have failed the same way on a Mac. Fix: `scripts/start.mjs` requires `electron` first (fix commit `fix: npm start downloads Electron's binary first…`). `npm run dev` on a fresh clone still has the gap (it runs electron-vite directly); 2c's README or a dev script should cover it.
- **localStorage was lost across a restart on Windows** (4 tests in run 2: the projects' layout, the panel's width, the Todo panel's pin, Hide my tasks). Chromium keeps the renderer's latest localStorage writes in memory for a while, and on Windows they never reached the disk at quit. A friend on Windows would have lost these at every quit. Fix: `beginQuit` calls `session.defaultSession.flushStorageData()` first, on every system (it also runs on Windows' `session-end`). All four passed from run 3.
- **The e2e width helper set the window's outer size** (7 tests in run 1, `window.innerWidth === w` timeouts). A Windows window's frame is wider than its page. Fix: `setContentSize` (test only).
- **Git Bash's `$$` is an MSYS process id** (run 1, "Close session…": the other tasks' shells read as gone). `process.kill` takes the Windows id, which Git Bash keeps in `/proc/$$/winpid`. Fix: the terminal tests read that on Windows (test only). The quit test that checks the shell is gone now checks a real Windows process too, and passes.
- **The note test raced the session's start and the ticket's start check** (macOS and Linux in run 1, Windows in runs 1–3). It read the launch log once, right after the terminal took the focus, before the fake `claude` had logged its launch (the Node fake starts later than the old shell script did). And it focused Start while the start check that opening a ticket runs still had Start disabled; on Windows git is slower, so the focus never took. Fix: poll the launch log, wait for Start to be enabled, check it has the focus (test only).
- **Mouse reports can't be seen on Windows** (links test, runs 1 and 2: no report reached the screen). ConPTY hands mouse input to the program as console mouse events, not bytes, and the test's reader, Git Bash's `cat -v`, reads none of those. The terminal code that sends the reports is the same on every system and macOS and Linux check it. Fix: on Windows the test checks only that the Cmd+click opens the link, and says why (spec §10.2). This cause is inferred from how ConPTY's input works, not proven on a Windows machine.
- **The manager e2e's `0o600` check** (known before run 1): guarded on Windows as the unit test is (spec §10.2).

## Still failing on Windows: timing, not fixed

None of these fails in every run, and none changed result for a reason in the code:

| Test | Failed in | What it shows |
|---|---|---|
| `terminal.e2e.ts` "a flood in a hidden task arrives in full" | 4 of 5: runs 1, 3, 4 and 4's rerun (passed in 2) | After 30 s the hidden task's screen is still all `mainframe` lines; `flood-5` hasn't arrived |
| `session-panel.e2e.ts` "switching tasks resizes no terminal off screen…" | 3 of 5: runs 3, 4 and 4's rerun | `stty size` in the shell doesn't show the size the terminal shows, within 5 s |
| `tasks.e2e.ts` "tasks reopened at startup start at the size their terminal shows" | 1 of 5: run 4 (passed in its rerun) | The same check as above, after a restart |
| `manager.e2e.ts` "unpinned, the manager floats over the board…" | 1 of 5: run 4's rerun | The task's glyph never shows `ask` after the shell reports the state (line 296); it passed in runs 2–4 |

The rerun of run 4's Windows job (attempt 2, no change) failed the flood, session-panel and manager tests and passed the tasks one, so these change result with no change: flaky. No retries were added. The flood test either runs slower than 30 s through ConPTY and Git Bash, or its output stops under Mainframe's pause and resume (`sessionHost.ts` `pause`/`resume`, which on Windows go to node-pty's ConPTY socket). The two size tests point at ConPTY passing a resize on to the program late, or Git Bash's `stty` reading it late. Telling these apart needs a Windows machine, or a CI run that logs throughput and resize timing; it is plan 2b's first job.

Also seen once on the Mac, locally: `projects.e2e.ts` "each open project has its own board and manager…" timed out (31.5 s) in 1 of 10 runs, while four e2e files ran at once; it passed alone 9 times. The failing line wasn't captured.

## What earlier reviews said only CI can prove

- **Task 2:** the bundled ConPTY (`useConptyDll`) works on the runner: sessions start, the status check passes. One kill per pty: "Close session" ends the shell and leaves the others running (run 2 on). `session-end` on shutdown can't happen on CI: owner's Windows check.
- **Task 4:** `taskkill` in `%SystemRoot%\System32` works: the sync's tree-kill unit test passes on Windows.
- **Task 6:** the SEA build and `FAKE_CLAUDE_EXE` reach the workers (sessions start on Windows); Git Bash under ConPTY runs the typed commands (all but mouse input, above); Windows' `stoppedSyncs` passes in the Todo tests. `terminal.e2e.ts:142`'s doubled first key was not seen in runs 2–4.
- **Task 7:** the manager e2e's mode check, guarded as above.
- **Task 8:** both Linux start steps pass: the runner's AppArmor restriction is on by default (the first step said it starts without the sandbox), and Ubuntu 24.04 accepts the setuid helper. `allowScripts` silences npm's install-script warning on all three. The Mac runner's screen fits the e2e window now (89 of 89).

## For 2b, 2c and the owner's Windows PC check (spec §10.4)

- **2b:** the Windows timing failures above, by cause; the Windows job stays red until they are fixed.
- **2c:** `npm run dev` on a fresh clone (Electron's binary isn't there yet); the README's Linux note, since the setuid helper exists only after the first `npm start`.
- **The owner's Windows PC:** a real Claude Code under the bundled ConPTY with its status on the board; that the layout, widths and pins survive a quit and a Windows shutdown (`session-end`); clicking in a Claude Code session that asks for the mouse; which key opens a link on Windows (the e2e clicks with the Meta key on every system).
