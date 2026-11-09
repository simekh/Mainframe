# Cross-platform plan 1: the Windows status check and CI on three systems

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out whether Claude Code's OSC 7501 status sequences get through Windows' ConPTY (spec §5.3), and run the typecheck, unit tests and e2e tests on macOS, Windows and Linux on every push (spec §10.1), so plan 2 is written from evidence.

**Architecture:** A new vitest test drives the real `SessionHost` with a tiny Node child program (the probe) that behaves like Claude Code at start-up: it sends the OSC 7501 query and `CSI c`, records which answer reaches it first, and prints status reports. The test runs once with the system's own pty layer and, on Windows, once more with the ConPTY bundled in node-pty (`useConptyDll: true`). A GitHub Actions workflow runs every suite on all three systems, each as its own step so one red step never hides another. Product code does not change in this plan.

**Tech Stack:** TypeScript, vitest 5, node-pty 1.1.0, Electron 44, Playwright 1.64, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-09-mainframe-cross-platform-design.md` (§5.3, §10.1, §11). This plan is the first of two; plan 2 (everything else) is written once `todo` has merged into `main` and this plan's findings are in (spec §11).

## Global Constraints

- Only new files, plus `.gitattributes`. Nothing under `src/` changes except the two new test files; `package.json` and `package-lock.json` stay untouched (spec §2: no dependency upgrades; §11: this step only adds files).
- Mainframe is project-agnostic: the workflow and tests name no project, path, branch or tool of the owner's (root `CLAUDE.md`). The workflow runs on every branch, not on a named one.
- Node 22.12 or later (README; Electron, vite and vitest need ^22.12). CI uses Node `22`.
- GitHub Actions versions checked 2026-11-09: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`. Verify any other action or runner command against its current docs before using it (owner's global `CLAUDE.md`).
- Do not run the e2e suite on the owner's machine (their own Mainframe may be running; ask for Cmd+Q first). In this plan e2e runs only on GitHub.
- Pushes: only `cross-platform` to `origin`. The owner allows these without `/simplify` and `/code-review high` (spec §11, 2026-11-09): before each push, record the tip in both records. Write literal absolute paths, and run `git commit` and `git push` as separate commands (root `CLAUDE.md`, "The gate").
- Commit messages: `type: what it does`, no card number, and no mention of Claude, Anthropic or AI (owner's global `CLAUDE.md`).
- Bash: absolute paths, never `cd` chained with another command.

## Review Focus

1. **The probe hangs on Windows** because ConPTY never delivers the replies: the probe must time out after 3 s and still print its result, and the test must fail with that result logged, not hang the CI job. Covered in Task 1 (the probe's timeout, and the test's own 20 s timeout).
2. **One red step hides the rest:** on Windows the unit tests will fail, and the e2e results must still appear. Covered in Task 2 (every step after `npm ci` runs with `if: ${{ !cancelled() }}`; Task 3 checks every step ran on every system).
3. **`.gitattributes` rewrites committed files:** adding `* text=auto eol=lf` must not change any file already in the repo. Covered in Task 2 (renormalize check).
4. **Electron can't launch on the Linux runner** (Ubuntu 24.04 restricts the unprivileged user namespaces Electron's sandbox needs), which would make every e2e test fail for a reason that says nothing about Mainframe. Covered in Task 2 (the sysctl step) and Task 3 (the findings say whether e2e tests actually ran on Linux).
5. **`npm ci` on Windows needs a compiler:** it must not (node-pty ships win32 builds). Covered in Task 3 (the findings record whether `npm ci` passed on Windows with no build-tools step).

---

### Task 1: The status passthrough test

**Files:**
- Create: `src/main/pty/fixtures/statusProbe.mjs`
- Create: `src/main/pty/statusPassthrough.pty.test.ts`

**Interfaces:**
- Consumes: `SessionHost`, `SpawnPty`, `LaunchFiles` from `src/main/pty/sessionHost.ts`; `buildSpawnEnv` from `src/main/pty/spawnEnv.ts`; `OSC7501_SUPPORT_REPLY` from `src/main/status/osc7501.ts` (the reply `SessionHost` writes when it sees a query); `ProgramStatus` from `src/shared/types.ts`.
- Produces: one `[status-check]` log line per run, read by Task 3:
  `[status-check] <mode> {"exitCode":0,"queryReachedHost":true,"da1QueryReachedHost":true,"sawReply":true,"sawDa1":true,"replyFirst":true,"states":["working","blocked:question"]}`
  where `<mode>` is `own` (the system's own pty layer) or `bundled` (node-pty's bundled ConPTY, Windows only).

- [ ] **Step 0: Install and check the baseline**

Run, from the worktree (the session's working directory): `npm ci`, then `npm test` and `npm run typecheck`.
Expected: install succeeds without changing `package.json` or `package-lock.json`; tests and typecheck pass. If anything fails before any change, stop and report it.

- [ ] **Step 1: Write the probe, `src/main/pty/fixtures/statusProbe.mjs`**

A plain Node script with no imports beyond Node's own. Exact behaviour, in order:
1. If `process.stdin.isTTY`, call `process.stdin.setRawMode(true)`. Set stdin's encoding to `utf8`, resume it, and append every chunk to a string `input`.
2. Write `\x1b]7501;?\x1b\\` (the query), then `\x1b[c` (DA1), as two writes, back to back.
3. Wait until `input` holds both `\x1b]7501;?:` (Mainframe's reply) and a match of `/\x1b\[\?[\d;]*c/` (a DA1 answer), or until 3000 ms have passed, whichever comes first.
4. Compute `sawReply`, `sawDa1`, and `replyFirst` (true only when both were seen and the reply's index in `input` is lower than the DA1 answer's).
5. Write `\x1b]7501;state=working\x1b\\`, then `\x1b]7501;state=blocked:kind=question\x1b\\`.
6. Write `PROBE ` + `JSON.stringify({ sawReply, sawDa1, replyFirst })` + `\r\n`, and in that write's callback wait 300 ms, then `process.exit(0)` (the wait lets ConPTY flush before the process ends).

- [ ] **Step 2: Write the test, `src/main/pty/statusPassthrough.pty.test.ts`**

`async function runProbe(useConptyDll: boolean): Promise<ProbeResult>` starts the probe through a real `SessionHost` and plays the terminal (xterm's part) itself:
- `spawnPty: (file, args, opts) => pty.spawn(file, args, { ...opts, useConptyDll })`.
- `files: { isExecutableFile: () => true, isDirectory: () => true }`, with a comment: the launch check isn't portable until plan 2, and node-pty checks the absolute path itself.
- `env: buildSpawnEnv(process.env)`, `outputBatchMs: 8`, `log: (line) => logLines.push(line)`.
- `argv: [process.execPath, <absolute path of statusProbe.mjs>]` (resolve it with `fileURLToPath(new URL('./fixtures/statusProbe.mjs', import.meta.url))`), `cwd: os.tmpdir()`, `cols: 80`, `rows: 24`.
- On each `onData`, append to `output`. The first time `output` contains `\x1b[c`, set `da1QueryReachedHost` and, 20 ms later, `host.write(id, '\x1b[?1;2c')` (xterm answers after a round trip to the renderer; Mainframe's own reply goes out at once in main).
- Collect each non-null `onStatus` as `state` or `state:kind` (for example `blocked:question`).
- Resolve on `onExit` with `ProbeResult`: `exitCode`, `queryReachedHost` (some log line ends with ` query`), `da1QueryReachedHost`, the three fields parsed from the `PROBE {...}` line in `output` (all false when the line is missing), and `states`.

Before any assertion, each test calls `log(mode, result)`, a one-line helper doing `console.log('[status-check]', mode, JSON.stringify(result))`, so the CI log shows every field even when the test fails.

```ts
it('status gets through the system\'s own pty layer', async () => {
  const r = await runProbe(false);
  log('own', r);
  expect(r.exitCode).toBe(0);
  expect(r.queryReachedHost).toBe(true);
  expect(r.sawReply).toBe(true);
  expect(r.replyFirst).toBe(true);
  expect(r.states).toEqual(expect.arrayContaining(['working', 'blocked:question']));
}, 20_000);

it.runIf(process.platform === 'win32')('status gets through the ConPTY bundled with node-pty', async () => {
  const r = await runProbe(true);
  log('bundled', r);
  // the same five expectations
}, 20_000);
```

- [ ] **Step 3: Run it on the Mac**

Run: `npx vitest run src/main/pty/statusPassthrough.pty.test.ts` (from the worktree root)
Expected: 1 passed, 1 skipped. The log shows `[status-check] own {... "replyFirst":true, "states":["working","blocked:question"]}`. This is a check of existing behaviour, so it passes at once on macOS; its value is on Windows. If it fails on the Mac, the test or the probe is wrong: fix them before going on.

- [ ] **Step 4: Run the whole unit suite and the typecheck**

Run: `npm test` and `npm run typecheck`
Expected: both pass, with no other test changed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform add src/main/pty/fixtures/statusProbe.mjs src/main/pty/statusPassthrough.pty.test.ts
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform commit -m "test: a status probe through a real pty, with node-pty's bundled ConPTY on Windows"
```

### Task 2: CI on macOS, Windows and Linux

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `.gitattributes`

**Interfaces:**
- Consumes: the npm scripts `typecheck`, `test`, `test:e2e`; Task 1's test file.
- Produces: a workflow named `Tests` whose jobs are named `test (macos-latest)`, `test (windows-latest)` and `test (ubuntu-latest)`, with steps named exactly as below (Task 3 reads them).

- [ ] **Step 1: Write `.gitattributes`**

```
* text=auto eol=lf
```

- [ ] **Step 2: Check it rewrites nothing**

Run: `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform add --renormalize .` then `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform status --porcelain`
Expected: only `A  .gitattributes` (plus the untracked workflow once written). Any other file listed means it was committed with CRLF: stop and report it, don't commit a mass rewrite.

- [ ] **Step 3: Write `.github/workflows/test.yml`**

- `name: Tests`; `on:` `push` (every branch), `pull_request`, `workflow_dispatch`.
- One job `test`, `strategy.fail-fast: false`, `matrix.os: [macos-latest, windows-latest, ubuntu-latest]`, `runs-on: ${{ matrix.os }}`, `timeout-minutes: 45`.
- Steps, in order, with these names:
  1. `actions/checkout@v7`.
  2. `actions/setup-node@v7` with `node-version: 22` and `cache: npm`.
  3. **Screen size (Windows):** `if: runner.os == 'Windows'`, `shell: pwsh`, `Set-DisplayResolution -Width 1920 -Height 1080 -Force`. The e2e tests size windows up to 1700 px wide. Check this command against the current `windows-latest` image docs first; if it isn't available there, leave the step out and say so in Task 3's findings.
  4. **Allow Electron's sandbox (Linux):** `if: runner.os == 'Linux'`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. Check against current Electron/Ubuntu runner guidance first.
  5. `Install` — `npm ci`.
  6. `Status check` — `npx vitest run src/main/pty/statusPassthrough.pty.test.ts`, `if: ${{ !cancelled() }}`.
  7. `Typecheck` — `npm run typecheck`, `if: ${{ !cancelled() }}`.
  8. `Unit tests` — `npm test`, `if: ${{ !cancelled() }}`.
  9. `E2E tests` — on Linux `xvfb-run -a npm run test:e2e`, elsewhere `npm run test:e2e` (two steps with `if: ${{ !cancelled() && runner.os == 'Linux' }}` and `if: ${{ !cancelled() && runner.os != 'Linux' }}`, both named `E2E tests`).
  10. `actions/upload-artifact@v7`, `if: ${{ failure() }}`, name `test-results-${{ matrix.os }}`, path `test-results/`, `if-no-files-found: ignore`.

- [ ] **Step 4: Commit** (GitHub checks the workflow's syntax on the push in Task 3; a syntax error shows there as a run that fails at once.)

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform add .gitattributes .github/workflows/test.yml
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform commit -m "ci: typecheck, unit and e2e tests on macOS, Windows and Linux"
```

### Task 3: Push, read the results, write the findings

**Files:**
- Create: `docs/superpowers/findings/2026-11-09-windows-status-check.md` (use the date of the run)

**Interfaces:**
- Consumes: Task 1's `[status-check]` lines and Task 2's step names.
- Produces: the findings plan 2 is written from: the §5.3 decision, and the failing tests per system.

- [ ] **Step 1: Record the tip, as the owner allowed for CI pushes**

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform rev-parse HEAD | tee -a /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified >> /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-reviewed
```

- [ ] **Step 2: Push (a command of its own)**

Run: `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform push -u origin cross-platform`
Expected: the push goes through; the gate lets it pass because the tip is recorded.

- [ ] **Step 3: Wait for the run and read it**

Run: `gh run list --branch cross-platform --workflow Tests --limit 1`, then `gh run watch <id> --exit-status` (a non-zero exit is expected: Windows and Linux will fail in places), then `gh run view <id> --log` filtered for `[status-check]`, and `gh run view <id> --json jobs` for each step's conclusion.
Expected: three jobs, each with every step from `Install` on showing a conclusion (none skipped because an earlier step failed).

- [ ] **Step 4: Write the findings**

`docs/superpowers/findings/<date>-windows-status-check.md`, in the style of the other findings files:
- **The decision (spec §5.3):** Windows uses the bundled ConPTY if the `bundled` run passed; otherwise the hook route. Quote both `[status-check]` lines from Windows and the one from macOS and Linux.
- **What it doesn't prove:** the probe reads its input with Node's raw mode, and Claude Code runs on Bun, which may read Windows console input differently. The owner's Windows PC check (spec §10.4) confirms the decision with a real Claude Code.
- **Per system, per step:** pass or fail, with the first error of each failing step.
- **For plan 2:** the failing unit-test files and e2e tests per system, grouped by cause where the log shows it; whether `npm ci` passed on Windows with no build tools; whether Electron launched on Linux; whether the screen-size step worked.

- [ ] **Step 5: Commit (Markdown only, so the gate needs no record) and push**

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform add docs/superpowers/findings/
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform commit -m "docs: findings of the Windows status check and the first CI run on three systems"
```

Then, as its own command: `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform push`

- [ ] **Step 6: Tell the owner** the §5.3 decision in plain words, what failed where, and that plan 2 is written once `todo` has merged.
