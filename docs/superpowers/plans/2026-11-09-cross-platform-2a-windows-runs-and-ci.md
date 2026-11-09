# Cross-platform plan 2a: Windows runs, and CI is green on all three systems

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions, the manager, the board's status, the Todo sync, quit and restore work on Windows; Mainframe starts on a current Ubuntu as a friend gets it; the typecheck, unit tests and e2e tests pass on macOS, Windows and Linux in CI.

**Architecture:** Programs are found once at start, on the sessions' own PATH, by one lookup that knows Windows' `Path` and `.exe` rules, and every launch gets an absolute path. Windows sessions run through node-pty's bundled ConPTY (plan 1's finding). The two hooks become exec-form command hooks that run Node with inline code, so no shell is involved anywhere. Background runs end their whole process tree on Windows. The e2e stand-in for `claude` becomes a Node script, built into a real `.exe` on Windows. A start script turns Chromium's sandbox off only where Linux blocks it and the setuid helper isn't set up.

**Tech Stack:** TypeScript 5.9, Electron 44, node-pty 1.1.0, vitest 5, Playwright 1.64, Node 26 LTS (npm 11.20), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-09-mainframe-cross-platform-design.md` (§3, §5, §9, §10, §11), with plan 1's findings `docs/superpowers/findings/2026-11-09-windows-status-check.md`. Plan 2 is split in three: 2a (this one: spec §5, §9's start-up, §10), 2b (the setup window, §4; it replaces 2a's start-up lookup of `claude` with the saved, checked path), 2c (native feel: §6, §7, the rest of §8, the README rewrite).

## Global Constraints

- **Newest versions only (owner):** Node's newest LTS (26) and the npm it ships, current Claude Code, Windows 11, current macOS and Linux. No workaround for an older version.
- **No shell anywhere in the product.** Every program is spawned directly. Mainframe never runs a `.cmd` or `.bat` (spec §4.3).
- **Nothing changes on the Mac** (spec anti-goal): same behaviour, keys and window. Where a task changes what macOS code computes (an absolute path where a bare name went), the result on the Mac is the same program.
- **Project-agnostic and several projects at once** (root `CLAUDE.md`): every task review asks whether the change works unchanged for a friend's project in another language with a `master` branch and none of the owner's plugins, and with Damela and Word² open side by side.
- **Test-only paths stay behind `MAINFRAME_E2E=1`.**
- **Platform logic takes the platform as a parameter** (`NodeJS.Platform`) and computes paths with `path.win32` or `path.posix` for the platform it is given, so a test on any system can pass `'win32'` (spec §10.3).
- **No dependency upgrades.** `package.json` changes only by `allowScripts` and the `start` script (Task 8). The package report of 2026-11-09 found no advisories; the owner said to go on without updates.
- **Minimum Claude Code: 2.1.295** (exec-form hooks need 2.1.139, `onFailure` needs 2.1.295).
- **No e2e run on the owner's Mac while their Mainframe runs:** ask them to quit it (Cmd+Q) first; otherwise e2e runs on CI in Task 9.
- **Dead code the change makes unreachable is removed** (for example `e2e/fake-claude.sh`); dead code elsewhere is pointed out.
- **Commits:** `type: what it does`; no attribution, no mention of Claude, Anthropic or AI. Bash: absolute paths, `git -C <worktree>`, never `cd` chained with a command.
- **Pushes happen only in Task 9**, each after recording the tip in both gate records and a `Skip record:` line in this plan's ledger (spec §11). `/simplify` and `/code-review high` run once for the whole branch after plan 2c's last code task, after the skip-recorded ids are taken out of both records.

**Facts checked 2026-11-09** (re-check anything else against current docs while building):
- node-pty on Windows: `kill(signal)` throws `Signals not supported on windows.`; `resize` after the exit throws `Cannot resize a pty that has already exited`; a second `kill` can crash the process (issue #983); `useConptyDll` is the option for the bundled ConPTY.
- Claude Code hooks: exec form is `{ "type": "command", "command": <executable>, "args": [...] }`, spawned with no shell on any system, and on Windows `command` must be a real `.exe`. `"onFailure": "block"` blocks the action when the hook can't start, times out or exits with an unexpected code. PreToolUse exit 2 blocks the call and its stderr goes to Claude. `timeout` is in seconds. SessionStart takes command hooks (not `http`) and gets its JSON on stdin.
- Node SEA: `node --build-sea <config.json>` (Node 25.5+) builds a runnable executable in one step; the config holds `main`, `output` (ending `.exe` on Windows) and `disableExperimentalSEAWarning`; an unsigned Windows build runs; the main script is CommonJS and can `require` only built-ins; user arguments start at `process.argv[2]`, as for `node script.cjs`.
- npm: `"allowScripts": { "node-pty": true }` in the root `package.json` (npm 11.16+ warns about uncovered install scripts, npm 12 blocks them). The root project's own scripts always run.
- Electron 44: `enableLargerThanScreen` is a macOS-only window option; BrowserWindow's `session-end` event (Windows only) fires on shutdown, restart or log-off, when `before-quit` is not sent.
- Windows' `taskkill /PID <pid> /T /F` ends a process and its children. Its folder (`%SystemRoot%\System32`) is not in Microsoft's docs; the Windows CI run proves it.
- electron-vite 6: `preview --noSandbox`; its package `exports` don't expose `bin/`, so the start script finds the bin through `electron-vite/package.json`.

## Review Focus

1. **Paths with spaces, a quote and non-ASCII letters** in the folder a hook writes to, and **a node path with spaces** (`C:\Program Files\nodejs\node.exe`): the hooks work, because nothing is quoted for a shell. Task 3.
2. **An env with `Path`, not `PATH`, or both:** the lookup reads the key that is there, and the sessions' env never gets a second one. Task 1.
3. **claude installed only as `claude.cmd`** (npm's global install on Windows): it is not picked, and the launch says claude was not found. Task 1.
4. **A Windows pty killed twice** (a project's close, then Quit) **and a resize or write after its exit:** one kill, no throw. Task 2.
5. **A stopped sync on Windows whose connectors still run:** its whole process tree ends. Task 4.

## Before Task 1

The ledger `.superpowers/sdd/2026-11-09-cross-platform-2a-windows-runs-and-ci/progress.md` holds plan 1's three `Skip record:` lines, written with this plan. Keep them, and add one per push in Task 9. Baseline: `npm test` and `npm run typecheck` pass on the Mac.

---

### Task 1: Finding programs on every system

**Files:**
- Create: `src/main/pty/findExecutable.ts`, `src/main/pty/findExecutable.test.ts`
- Modify: `src/main/pty/spawnEnv.ts`, `src/main/pty/spawnEnv.test.ts`, `src/main/pty/sessionHost.ts`, `src/main/pty/sessionHost.test.ts`, `src/main/index.ts`
- Modify (new signatures only; Task 2 rewrites them): `src/main/pty/sessionHost.pty.test.ts`, `src/main/pty/statusPassthrough.pty.test.ts`

**Interfaces:**
- Produces, in `findExecutable.ts`:
  - `interface ExecutableFiles { isExecutableFile(path: string): boolean }`
  - `interface ExecutableLookup { env: Record<string, string>; cwd: string; platform: NodeJS.Platform; files: ExecutableFiles }`
  - `findExecutable(name: string, o: ExecutableLookup): string | null` (the absolute path, or null)
  - `resolveExecutable(name: string, o: ExecutableLookup): string` (the same, but throws with today's messages)
- Produces, in `spawnEnv.ts`: `pathKey(env: Record<string, string | undefined>, platform: NodeJS.Platform): string | undefined` and `buildSpawnEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string>`.
- Produces: `SessionHost`'s options gain `platform: NodeJS.Platform`; `LaunchFiles extends ExecutableFiles`; `spawnPty` gets the resolved absolute path as `file`.

- [ ] **Step 1: Write the failing tests, `findExecutable.test.ts`**

A `files(...paths)` helper returns `{ isExecutableFile: (p) => paths.includes(p) }`. Every case passes its platform:
- `'darwin'`: `claude` on `PATH: '/a:/b'` with `/b/claude` → `'/b/claude'`; the first directory wins; an empty entry is `cwd` (`PATH: ':/b'`, cwd `/repo`, file `/repo/claude`); no `PATH` key → searches `/usr/bin:/bin`; `./bin/claude` is resolved against `cwd`; a missing absolute path → `null`. A name with a backslash is a bare name there.
- `'win32'`: `{ Path: 'C:\\a;C:\\b' }` with `C:\\b\\claude.exe` → `'C:\\b\\claude.exe'`; `.exe` is tried before `.com`; with only `C:\\a\\claude.cmd` and `C:\\a\\claude.bat` → `null` (Review Focus 3); a quoted entry `"C:\\Program Files\\x"` is searched without its quotes; an entry with forward slashes works; `C:\\x\\claude` → `'C:\\x\\claude.exe'`; `C:\\x\\claude.exe` as given; `C:\\x\\claude.cmd` → `null`; a relative `bin\\claude` resolves against `cwd`.
- `'win32'`, Review Focus 2: `{ PATH: 'C:\\a' }` (upper case) is read too; with `{ Path: 'C:\\a', PATH: 'C:\\b' }` only the first key in the object's order, `Path`, is searched.
- `resolveExecutable` throws `claude was not found on PATH (/a:/b)` for a bare name, and `/nowhere/claude was not found, or is not an executable file` for a path, naming the name as given.

- [ ] **Step 2: Run them:** `npx vitest run src/main/pty/findExecutable.test.ts`. Expected: FAIL, the module doesn't exist.

- [ ] **Step 3: Implement `findExecutable.ts`, and `pathKey` in `spawnEnv.ts`**

Rules: a name containing a separator (`/`, and on win32 also `\`) or one that `path.win32.isAbsolute` accepts on win32 is a path, resolved against `cwd`; any other name is searched in the PATH value (`env[pathKey(env, platform)]`, else `/usr/bin:/bin` on POSIX and empty on win32), split on `;` on win32 and `:` on POSIX. On win32 a candidate that already ends in `.exe` or `.com` (any case) is checked as it is; one with any other extension is never accepted; one without becomes `<name>.exe`, then `<name>.com`. Never search `cwd` on win32 (unlike libuv, which would run a `claude.exe` planted in the repo). Never resolve symlinks: `~/.local/bin/claude` stays that path, so `claude update` keeps working. `pathKey` on win32 is the first key whose upper case is `PATH`; on POSIX it is `PATH` if present. `DEFAULT_PATH` moves here from `sessionHost.ts`.

- [ ] **Step 4: Run them:** the same command. Expected: PASS.

- [ ] **Step 5: `buildSpawnEnv(base, platform)`: tests, then code**

New tests in `spawnEnv.test.ts`, with `'win32'`: `{ Path: 'C:\\x\\node_modules\\.bin;C:\\Users\\x\\.local\\bin' }` → `{ Path: 'C:\\Users\\x\\.local\\bin', … }` with no `PATH` key; `{ Path: 'C:\\a', PATH: 'C:\\b' }` → only `Path: 'C:\\a'`; an npm `…\\@npmcli\\run-script\\lib\\node-gyp-bin` entry is dropped; `WT_SESSION` and `WT_PROFILE_ID` are dropped (on every platform). The existing tests pass `'darwin'` and keep their expected values. Code: clean the value under `pathKey`, split and join on the platform's delimiter, treat both slash directions alike on win32 only, drop the other case variants of the key on win32, and add `WT_SESSION` and `WT_PROFILE_ID` to `DROPPED_KEYS`. Run `npx vitest run src/main/pty/spawnEnv.test.ts`: PASS.

- [ ] **Step 6: `SessionHost` resolves its launch: tests, then code**

In `sessionHost.test.ts`, `setup` passes `platform: 'darwin'`; the first test now expects `calls[0][0]` to be `'/usr/bin/claude'`. New test: "on Windows it looks claude.exe up on Path and spawns its absolute path": `platform: 'win32'`, `env: { Path: 'C:\\bin' }`, executables `['C:\\bin\\claude.exe']`, folders `['C:\\repo']`, `cwd: 'C:\\repo'` → `calls[0][0] === 'C:\\bin\\claude.exe'`. The other refusal tests keep their messages. Code: `spawn` replaces `checkLaunch` with `resolveExecutable(argv[0], { env, cwd, platform, files })`, then the folder check as today, and passes the result to `spawnPty`. Run `npx vitest run src/main/pty/sessionHost.test.ts`: PASS.

- [ ] **Step 7: `index.ts` looks `claude` up once**

A function `findPrograms(config: AppConfig): { env: Record<string, string>; claudeBin: string }` runs in `whenReady` before `chooseProjects`, and `start` takes its result: `env = buildSpawnEnv(process.env, process.platform)`, used for the `SessionHost` and every `TodoService`; `claudeBin = findExecutable(config.claudeBin, { env, cwd: process.cwd(), platform: process.platform, files: localFiles }) ?? config.claudeBin`, passed to every `TaskService`, `ManagerService` and `TodoService`. Not found, the name passes through and each launch reports it, as today (2b's setup replaces this). `SessionHost` gets `platform: process.platform`. In the two `.pty.test.ts` files, pass `process.platform` to `buildSpawnEnv` and `SessionHost`.

- [ ] **Step 8: Run everything:** `npm test` and `npm run typecheck`. Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform add src/main/pty src/main/index.ts
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform commit -m "feat: programs are found on Windows' Path as .exe files, once at start, and every launch gets an absolute path"
```

### Task 2: The pty on Windows

**Files:**
- Create: `src/main/pty/nodePty.ts`, `src/main/pty/nodePty.test.ts`
- Modify: `src/main/pty/sessionHost.ts`, `src/main/pty/sessionHost.test.ts`, `src/main/pty/sessionHost.pty.test.ts`, `src/main/pty/statusPassthrough.pty.test.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: Task 1's `SessionHost` options (`platform`) and `buildSpawnEnv(base, platform)`.
- Produces: `spawnNodePty(platform: NodeJS.Platform): SpawnPty`: node-pty's `spawn` with `useConptyDll: platform === 'win32'` added.

- [ ] **Step 1: Write the failing tests**
  - `nodePty.test.ts`, with `vi.mock('node-pty')`: `spawnNodePty('win32')` passes `useConptyDll: true` with the given options; `'darwin'` and `'linux'` pass `false`.
  - `sessionHost.test.ts`, `platform: 'win32'` (Review Focus 4): `kill('s1')` then `kill('s1', 'SIGKILL')` log only `kill:default`; `kill('s1', 'SIGKILL')` alone logs `kill:default` (no signal on Windows); `killAll()` after `kill('s1')` kills nothing more. The `'darwin'` test "kill hangs up on the session, or kills it outright with SIGKILL" stays as it is.
  - `sessionHost.test.ts`, on `'darwin'`: the fake pty gets a `broken` flag; once it is set, its `write` and `resize` throw `new Error('Cannot resize a pty that has already exited')`, and `host.write` and `host.resize` don't throw.

- [ ] **Step 2: Run them:** `npx vitest run src/main/pty/nodePty.test.ts src/main/pty/sessionHost.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - `nodePty.ts` as in Interfaces.
  - `SessionHost.kill`: on win32 it never passes a signal and kills each pty at most once (a `killed` flag on the session). `killAll` follows the same rules. POSIX keeps today's hang-up, then `SIGKILL`.
  - `write` and `resize` drop an error thrown by the pty, on every system: a pty that has just exited refuses both, and its exit is on the way (node-pty reports it up to about a second late with Windows' own ConPTY).

- [ ] **Step 4: Run them:** the same command. Expected: PASS.

- [ ] **Step 5: Rewrite the two real-pty tests**
  - `statusPassthrough.pty.test.ts`: one test, "status gets through the pty Mainframe uses on this system", using `spawnNodePty(process.platform)`, `localFiles` and `platform: process.platform`. The own/bundled split goes. A timer kills the session after 15 s if it hasn't exited; the result gains `killed: boolean`. The `[status-check] <process.platform> {...}` line is logged before the assertions. The test timeout stays at 20 s (this covers plan 1's deferred minor).
  - `sessionHost.pty.test.ts`: argv `[process.execPath, '-e', 'process.stdout.write("pty-ok"); setTimeout(() => process.exit(3), 300)']`, `cwd: os.tmpdir()`, `spawnNodePty(process.platform)`. It expects `pty-ok` and exit code 3. The 300 ms wait lets ConPTY pass the output on before the exit, as plan 1's probe does.
  - Run `npx vitest run src/main/pty`. Expected: PASS on the Mac.

- [ ] **Step 6: `index.ts`**
  - `spawnPty: spawnNodePty(process.platform)`.
  - The quit bookkeeping (`projects.beginQuit()`, `host.killAll()`) becomes one function that runs at most once. It is called from `app.on('before-quit')` as today, and from `shown.on('session-end')`: Windows sends `session-end` and no `before-quit` on shutdown, restart and log-off (Electron docs). The listener never fires on the Mac. `beginQuit` records synchronously, which the shutdown needs.

- [ ] **Step 7: Run everything:** `npm test`, `npm run typecheck`. Expected: pass.

- [ ] **Step 8: Commit**: `feat: Windows sessions run through node-pty's bundled ConPTY, each pty is killed once with no signal, and a shutdown records where sessions were`

### Task 3: Hooks that need no shell

**Files:**
- Modify: `src/main/tasks/launch.ts`, `src/main/tasks/launch.test.ts`, `src/main/todo/syncRun.ts` (`syncSettings`), `src/main/todo/syncRun.test.ts` (`describe('syncSettings')`), `src/main/tasks/taskService.ts`, `src/main/tasks/taskService.test.ts`, `src/main/manager/managerService.ts`, `src/main/manager/managerService.test.ts`, `src/main/todo/todoService.ts`, `src/main/todo/todoService.test.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: `findExecutable` and `findPrograms` (Task 1).
- Produces: `hookSettings(dir: string, nodeBin: string, allow: string[] = []): string`; `writeHookSettings(dir: string, nodeBin: string, allow: string[] = []): string`; `syncSettings(nodeBin: string, allowTools: string[]): string`; `nodeBin: string` in `TaskServiceDeps`, `ManagerServiceDeps` and `TodoServiceDeps`; `findPrograms` also returns `nodeBin`.

The two hooks, exactly (`node -e <code> <arg>` gives the code `<arg>` as `process.argv[1]`):

```ts
// SessionStart, in launch.ts. Atomic: the reader never sees half a file.
const SAVE_STDIN =
  "const fs=process.getBuiltinModule('node:fs'),t=process.argv[1],c=[];" +
  "process.stdin.on('data',(d)=>c.push(d)).on('end',()=>{fs.writeFileSync(t+'.tmp',Buffer.concat(c));fs.renameSync(t+'.tmp',t)})";
{ type: 'command', command: nodeBin, args: ['-e', SAVE_STDIN, join(dir, SESSION_START_FILE)], timeout: 10 }

// The sync's PreToolUse guard, in syncRun.ts. exitCode, not exit(): stderr reaches the pipe in full.
{ type: 'command', command: nodeBin,
  args: ['-e', 'process.stderr.write(process.argv[1]);process.exitCode=2', "Mainframe's sync may only read the to-do list."],
  timeout: 10, onFailure: 'block' }
```

`shQuote` goes. The guard's matcher, `permissions` and `disableAllHooks: false` stay as they are.

- [ ] **Step 1: Write the failing tests** (`NODE = '/usr/local/bin/node'` where nothing runs; `process.execPath` where the hook runs)
  - `launch.test.ts`: "gives a task the hooks file it has always had" becomes "a task's SessionStart hook runs node with no shell": the parsed hook equals `{ type: 'command', command: NODE, args: ['-e', expect.any(String), join('/d/t1', 'session-start.json')], timeout: 10 }`, and the settings' keys are `['hooks']` with no allow rules.
  - "the hook command saves its input silently, also in a folder whose path has a space, a quote and non-ASCII letters" (Review Focus 1): `mkdtempSync(join(tmpdir(), "hook dir 'q' åäö "))`, `hookSettings(dir, process.execPath)`, then `execFileSync(hook.command, hook.args, { input })`. stdout is `''` and the file holds the input. Run it a second time with another input: the file holds the second (the rename replaces it, on Windows too).
  - "the node path is the hook's command as it is, spaces and all" (Review Focus 1): `hookSettings('/d', 'C:\\Program Files\\nodejs\\node.exe')` has exactly that `command`, with no quotes added.
  - `syncRun.test.ts`: "the hook's command exits 2 and says why" runs `execFileSync(hook.command, hook.args, { encoding: 'utf8', stdio: 'pipe' })` with `syncSettings(process.execPath, [])` and expects status 2 and stderr containing `may only read the to-do list`. New: "a guard that can't start blocks the call": the hook has `onFailure: 'block'` and `command === NODE`. The other `syncSettings` tests pass `NODE` first.
  - Service tests: every deps object gets `nodeBin: NODE`; the settings comparisons become `hookSettings(dir, NODE, …)` and `syncSettings(NODE, …)`.

- [ ] **Step 2: Run them:** `npx vitest run src/main/tasks src/main/todo src/main/manager`. Expected: FAIL.

- [ ] **Step 3: Implement** the hooks above, and pass `this.deps.nodeBin` at each `writeHookSettings` call (TaskService, ManagerService) and the `syncSettings` call (TodoService).

- [ ] **Step 4: `index.ts`:** `findPrograms` also looks up `findExecutable('node', …)` on the same env. When it finds none, it throws `new Error('Mainframe needs Node.js, and found no node on PATH. Install the current Node.js LTS, then run npm start again from a new terminal.')`; the existing "Mainframe could not start" dialog shows it before any folder dialog. The `nodeBin` goes to every TaskService, ManagerService and TodoService.

- [ ] **Step 5: Run everything:** `npm test`, `npm run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**: `feat: the SessionStart hook and the sync's guard run node directly with no shell, so they work on Windows`

### Task 4: Background runs on Windows

**Files:**
- Modify: `src/main/todo/syncRun.ts` (`runClaude`), `src/main/todo/syncRun.test.ts` (`describe('runClaude')`), `src/main/git.ts`

**Interfaces:**
- Produces: `runClaude`'s options gain `platform?: NodeJS.Platform` (default `process.platform`) and `killTree?: (pid: number) => void` (default: `taskkill.exe /PID <pid> /T /F`, at `join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')`, by `execFile` with `windowsHide: true`, its errors ignored, since the tree may already be gone). TodoService passes neither.

- [ ] **Step 1: Make the stubs Node scripts.** `stub(code: string): string[]` writes `<folder>/claude-stub.cjs` and returns `[process.execPath, file]`; each test spreads it at the front of argv. The tests keep their names and expectations, and the scripts do what the shell ones did: read stdin as a stream (`data`/`end`), not with `readFileSync(0)`, which can fail on a Windows pipe; argv as `process.argv.slice(2)`; set exit codes with `process.exitCode`; the long runs wait with `setTimeout(() => {}, 5000)`. `options` passes `env: process.env` (a Windows child Node can't start without `SystemRoot`), and the env test adds `SYNC_TEST` to it. "A program that is missing" escapes the path before building its regex.

- [ ] **Step 2: Write the failing tests**
  - "on Windows a stop ends the run's whole process tree" (Review Focus 5): a stub that writes `process.pid` to `pid` in its cwd and then waits; `platform: 'win32'` and a `killTree` spy. Once `pid` exists, `cancel()`. The run rejects with `The sync was stopped`, and the spy got exactly that pid, once. The test then ends the stub with `process.kill(pid)`.
  - "a run that could not start is never killed": a missing program, `platform: 'win32'`, the spy; `cancel()` in the same tick. The run rejects with `The sync was stopped`, and the spy is never called.
  - "a tree killer that throws still rejects the run as stopped": the spy throws; `cancel()` doesn't throw, and the run rejects with `The sync was stopped`.
  - "cancel in the same tick as a spawn that fails rejects as stopped", on this system's platform (the `kill EINVAL` of plan 1's first run).

- [ ] **Step 3: Run them:** `npx vitest run src/main/todo/syncRun.test.ts`. Expected: the new ones FAIL.

- [ ] **Step 4: Implement.** `stop` rejects, then ends the child: nothing when `child.pid` is undefined (the spawn failed); on win32 `killTree(child.pid)`; otherwise `child.kill('SIGTERM')` as today; a throw is caught and logged with `console.warn`, never thrown from a timer or from `cancel`. `spawn` gets `windowsHide: true`, and so does `git.ts`'s `execFile` (spec §5.4: no console window flashes).

- [ ] **Step 5: Run everything:** `npm test`, `npm run typecheck`. Expected: pass.

- [ ] **Step 6: Commit**: `fix: a stopped sync on Windows ends its whole process tree, a run that never started is never killed, and no console window flashes`

### Task 5: Long task descriptions on Windows

**Files:**
- Create: `src/main/pty/windowsCommandLine.ts`, `src/main/pty/windowsCommandLine.test.ts`
- Modify: `src/main/tasks/openingPrompt.ts`, `src/main/tasks/openingPrompt.test.ts`, `src/main/tasks/launch.ts` (`startArgv`), `src/main/tasks/launch.test.ts`, `src/main/tasks/taskService.ts`, `src/main/tasks/taskService.test.ts`, `src/main/index.ts`

**Interfaces:**
- Produces: `fitsWindowsCommandLine(argv: string[]): boolean`: true when `Σ(2·arg.length + 3) ≤ 32_000` (a safe upper bound on the quoted command line, against Windows' 32,767 UTF-16 units). `openingPrompt({ …, descriptionFile?: string })`. `startArgv({ …, addDir?: string })`. `platform: NodeJS.Platform` in `TaskServiceDeps`.

Nothing changes on the Mac, the New task box keeps no cap, and the manager's 20,000 cap stays. Only on win32, when the start argv doesn't fit, the description goes to `<taskDir>/brief/description.md` (the description as typed). The launch then adds `--add-dir <taskDir>/brief`, so the session reads the file with no permission prompt, and its prompt points at the file. `--add-dir` takes several values, so it goes right before `--settings`, never right before the prompt.

- [ ] **Step 1: Write the failing tests**
  - `windowsCommandLine.test.ts`: `['a'.repeat(15_998)]` fits (31,999); `['a'.repeat(15_999)]` doesn't (32,001); two arguments add up.
  - `openingPrompt.test.ts`: with `descriptionFile: 'D:\\data\\tasks\\t1\\brief\\description.md'`, the prompt holds none of the description. Where the description was, it says, exactly: ``This task's description is in ${file}: it is too long to pass on the command line. Read that file before you plan.`` With a card, the sentence begins `The owner's note on this task is in` instead of `This task's description is in`. With no description, nothing is said of a file.
  - `launch.test.ts`: `startArgv({ …, addDir: '/b' })` has `'--add-dir', '/b'` right before `'--settings'`, and the prompt stays last.
  - `taskService.test.ts`: on `'win32'`, a task with a 20,000-character description launches with `--add-dir <taskDir>/brief`; its prompt names `<taskDir>/brief/description.md` and holds none of the description; the file holds the description. On `'darwin'` the same task launches as today, with no file. On `'win32'` a short description launches as today. Every other deps object in the file gets `platform: 'darwin'`.

- [ ] **Step 2: Run them:** `npx vitest run src/main/pty/windowsCommandLine.test.ts src/main/tasks`. Expected: FAIL.

- [ ] **Step 3: Implement.** `TaskService.startArgvOf` builds the argv as today. On win32, when `fitsWindowsCommandLine` says no, it writes the file and builds it again with `descriptionFile` and `addDir`. Both start and the reopen of a task that never started go through it. `index.ts` passes `platform: process.platform`.

- [ ] **Step 4: Run everything:** `npm test`, `npm run typecheck`. Expected: pass.

- [ ] **Step 5: Commit**: `feat: on Windows a description too long for the command line goes to a file the session reads first`

### Task 6: The e2e stand-in for `claude`, in Node

**Files:**
- Create: `e2e/fake-claude.cjs` (executable: `chmod +x`, so git records mode 100755), `e2e/globalSetup.ts`
- Delete: `e2e/fake-claude.sh`
- Modify: `playwright.config.ts` (`globalSetup: './e2e/globalSetup.ts'`), `e2e/launch.ts`, `e2e/tasks.ts`, `e2e/bridge.e2e.ts`, `e2e/projects.e2e.ts`, `e2e/todo.e2e.ts`, `e2e/app.e2e.ts`, `README.md` (Develop)

**Interfaces:**
- Produces: `e2e/fake-claude.cjs`, which behaves as `fake-claude.sh` does today on every system; `process.env.FAKE_CLAUDE_EXE`, set by `globalSetup` on Windows only, which `appEnv` uses as `MAINFRAME_CLAUDE_BIN` when present (else `e2e/fake-claude.cjs`).

`fake-claude.cjs` (CommonJS, `#!/usr/bin/env node`, built-ins only, so the same file builds into an SEA). Its arguments are `process.argv.slice(2)`, both when run as a script and inside the SEA. In order:
1. With `FAKE_CLAUDE_LOG_DIR` set, it writes `<dir>/<pid>.argv`: the cwd and each argument, each followed by `\0`.
2. With `FAKE_CLAUDE_BRIDGE=1`, it prints `bridge-ok` and `\x1b]7501;state=working\x1b\\`, waits 300 ms and exits 0. This replaces `bridge.e2e.ts`'s own `#!/bin/sh` file: that test passes `{ FAKE_CLAUDE_BRIDGE: '1' }` to `launchApp` and writes no program of its own.
3. With `-p` first, the sync mode:
   - It reads stdin to its end and writes it to `<pid>.stdin`.
   - `reply()` prints `sync-reply.json` when it exists.
   - Then it installs a SIGTERM handler that runs `reply()`, writes `<pid>.sigterm` and ends with code 143.
   - While `sync-hold` exists, it writes `<pid>.holding` once and checks again every 50 ms. Then it runs `reply()` and ends with code 0.
   - It ends through `process.exitCode` and an empty event loop, not `process.exit()`, so stdout reaches the pipe in full.
4. Otherwise, the interactive mode:
   - It reads `--settings`, `--session-id` (source `startup`) and `--resume` (source `resume`) as the shell script does, taking a flag only when a value follows it.
   - With all three set (and `FAKE_CLAUDE_LOG_DIR`), it creates an empty transcript at `<log>/projects/-fake-project/<id>.jsonl` and writes `{"session_id","source","transcript_path"}` with `JSON.stringify` to `session-start.json` beside the settings file.
   - Then it spawns the shell with `stdio: 'inherit'` and never touches `process.stdin` itself. The shell is `FAKE_CLAUDE_SHELL` when set, else `/bin/bash` on POSIX, else `%ProgramFiles%\Git\bin\bash.exe` on Windows (never `bash` from PATH, which can be WSL's). It runs with `--noprofile --norc`.
   - It ends as the shell did: with its exit code, or by the same signal (`process.kill(process.pid, signal)`).

`globalSetup.ts`: on win32 only, it writes a config `{ main: <abs e2e/fake-claude.cjs>, output: <mkdtemp>\fake-claude.exe, disableExperimentalSEAWarning: true }` and runs `execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' })`. It sets `process.env.FAKE_CLAUDE_EXE` (Playwright hands a global setup's env changes to the workers) and returns a teardown that removes the folder. Elsewhere it does nothing. Mainframe gets no test-only code for this.

Test helpers:
- `stoppedSyncs` on win32 counts the held runs (`<pid>.holding`) whose pid has gone (`process.kill(pid, 0)` throws). Windows can't run a handler when a process is stopped (spec §10.2), and a held run only ends by a stop or a release. Its comment says so.
- Every `[data-project="${dir}"]` becomes `` [data-project=${JSON.stringify(dir)}] ``: in a CSS string a backslash starts an escape, and a JSON string is a valid CSS string for a path. That is `projects.e2e.ts` (2), `todo.e2e.ts` (2) and `app.e2e.ts` (1).
- `launchAgain` passes `--no-sandbox` after `root` on Linux, as Playwright's `launchApp` already does.
- The comments that name `fake-claude.sh` name `fake-claude.cjs`.
- README Develop gets one line: on Windows the e2e tests need Git for Windows, because their stand-in for `claude` opens Git Bash.

- [ ] **Step 1: Write `fake-claude.cjs`** as above, delete `fake-claude.sh`, and point `appEnv` at the new file.
- [ ] **Step 2: Smoke-check it by hand.**
  - Bridge mode: `FAKE_CLAUDE_BRIDGE=1 /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform/e2e/fake-claude.cjs | od -c | head`. Expected: `bridge-ok`, then the OSC sequence.
  - Sync mode: with `FAKE_CLAUDE_LOG_DIR` set to a scratch folder holding a `sync-reply.json`, `echo hi | <path> -p`. Expected: the reply printed, and `<pid>.stdin` holds `hi`.
- [ ] **Step 3: Write `globalSetup.ts`, register it, and make the helper changes above.**
- [ ] **Step 4: Run the typecheck and the unit tests:** `npm run typecheck`, `npm test`. Expected: pass.
- [ ] **Step 5: Run the e2e suite, only if the owner has quit their Mainframe:** `npm run test:e2e`. Expected: 89 passed on the Mac. Otherwise, write in the ledger that it runs on CI in Task 9.
- [ ] **Step 6: Commit** (`git add -A e2e playwright.config.ts README.md` takes in the deletion): `test: the e2e stand-in for claude is a Node script, built into an .exe on Windows, and the e2e helpers work with Windows paths`

### Task 7: The remaining unit tests on every system

**Files:**
- Modify: `src/main/config.test.ts`, `src/main/manager/managerService.test.ts`, `src/main/clipboard.test.ts`

These are test-only changes, and they fail only on Windows (plan 1's findings), so the Mac can't watch them fail. Task 9's Windows run is their check, and the ledger notes that ruling.

- [ ] **Step 1: `config.test.ts`:** expected data folders go through `resolve('/data')` and `resolve('/tmp/d')`.
- [ ] **Step 2: `managerService.test.ts`:** both `0o600` assertions run only when `process.platform !== 'win32'`, with the comment "Windows has no owner-only mode bits (spec §10.2)". The content checks run everywhere.
- [ ] **Step 3: `clipboard.test.ts`:** the file URLs come from `pathToFileURL(join(tmpdir(), 'My Shot.png')).href` (and `1.txt`, `2.txt`), and the expected paths are those same `join(tmpdir(), …)` paths.
- [ ] **Step 4: Run everything:** `npm test`, `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit**: `test: config, manager and clipboard tests use the system's own paths and skip POSIX file modes on Windows`

### Task 8: Linux start-up, npm and CI

**Files:**
- Create: `scripts/startArgs.mjs`, `scripts/startArgs.test.mjs`, `scripts/start.mjs`
- Modify: `package.json`, `vitest.config.ts` (include `'scripts/**/*.test.mjs'`), `src/main/index.ts` (`createWindow`), `README.md`, `.github/workflows/test.yml`

**Interfaces:**
- Produces: `startArgs(platform: string, restriction: string | null, helper: { uid: number; mode: number } | null): string[]`. It returns `['preview', '--noSandbox']` only on `'linux'`, when `restriction?.trim() === '1'` and the helper isn't root-owned with the setuid bit (`uid === 0 && (mode & 0o4000) !== 0`); otherwise `['preview']`.

- [ ] **Step 1: Write the failing tests, `startArgs.test.mjs`**
  - `'darwin'` and `'win32'` with restriction `'1'` → `['preview']`.
  - `'linux'`: restriction `'1\n'` and no helper → `['preview', '--noSandbox']`; restriction `'1'` with `{ uid: 0, mode: 0o104755 }` → `['preview']`; `{ uid: 1000, mode: 0o104755 }` → `--noSandbox`; `{ uid: 0, mode: 0o100755 }` → `--noSandbox`; restriction `'0'` or `null` → `['preview']`.
- [ ] **Step 2: Run them:** `npx vitest run scripts/startArgs.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `startArgs.mjs`, then `start.mjs`.** `start.mjs`:
  - It reads `/proc/sys/kernel/apparmor_restrict_unprivileged_userns`, and `statSync`s Electron's `dist/chrome-sandbox`. Electron's folder comes from `createRequire(import.meta.url).resolve('electron/package.json')`. Each read gives `null` when it fails.
  - With `--noSandbox` in the args, it prints exactly: `Mainframe starts without Chromium's sandbox, because this Linux blocks it. The README says how to keep it.`
  - It runs `process.execPath` on electron-vite's bin: its folder from `electron-vite/package.json`, joined with that file's `bin['electron-vite']`. It passes the args with inherited stdio, and exits with the child's code (1 when it ended by a signal).
  - `"start": "node scripts/start.mjs"`. `"dev"` stays as it is.
- [ ] **Step 4: Run them:** the same command. Expected: PASS. Then `npm start` on the Mac (only once the owner has quit their Mainframe, since both would use the default data folder; else with `MAINFRAME_DATA_DIR` set to a scratch folder). Expected: no sandbox line, and Mainframe opens as before.
- [ ] **Step 5: `package.json` allows node-pty's install scripts:** add `"allowScripts": { "node-pty": true }` at the top level. Run `npm ci`. Expected: it passes, prints no `install-scripts` warning, and leaves `package-lock.json` unchanged (`git diff --exit-code package-lock.json`).
- [ ] **Step 6: The Mac runner's small screen.** `createWindow(e2e: boolean)` sets `enableLargerThanScreen: e2e`, with the comment "macOS only: in an e2e run the window may be larger than the runner's screen (MAINFRAME_E2E=1)". `start` passes `config.e2e`.
- [ ] **Step 7: README.** It gets a Linux note under "What you need" and one Develop line, with this content:
  - `npm install` compiles node-pty there, so it needs a C++ compiler, `make` and Python 3 (`sudo apt install build-essential python3` on Ubuntu and Debian).
  - Ubuntu 24.04 and later block what Chromium's sandbox needs. There `npm start` starts Mainframe without the sandbox and says so.
  - Keeping the sandbox is a one-time step, repeated after an `npm install` that reinstalls Electron:
    ```sh
    sudo chown root:root node_modules/electron/dist/chrome-sandbox
    sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
    ```
  - Develop: on such a Linux, `npm run dev -- --noSandbox`.
- [ ] **Step 8: The workflow.**
  - **Remove** three steps: "Screen size (macOS)", "Status check" (the test runs inside Unit tests) and "Allow Electron's sandbox (Linux)". Keep "Screen size (Windows)".
  - **Add** two Linux steps after Unit tests, each `if: ${{ !cancelled() && runner.os == 'Linux' }}` with `timeout-minutes: 5`. Each runs `npm start` the way a friend does, on Ubuntu with the block left on, with a fresh `MAINFRAME_DATA_DIR="$(mktemp -d)"`, so Mainframe waits at the folder dialog. Each runs `timeout 90 xvfb-run -a npm start 2>&1 | tee start.log` under `set +e`, takes the exit code from `${PIPESTATUS[0]}`, and passes only on 124 (still running). Anything else fails it, such as Chromium's "No usable sandbox" abort.
    1. **Start as a friend does (Linux):** it also requires the sandbox line in `start.log` (`grep -q "without Chromium's sandbox" start.log`).
    2. **Start with the setuid sandbox (Linux):** it first runs the README's two `sudo` commands, then requires that the line is *not* in `start.log`. That proves the README's way keeps the sandbox and starts.
- [ ] **Step 9: Run everything:** `npm test`, `npm run typecheck`. Expected: pass. The new test runs inside `npm test`.
- [ ] **Step 10: Commit**: `feat: npm start runs a start script that keeps Chromium's sandbox unless Linux blocks it, node-pty's install scripts are allowed, and CI checks a friend's start on Ubuntu`

### Task 9: Push, and make CI green on all three systems

**Files:**
- Create: `docs/superpowers/findings/2026-11-09-cross-platform-2a-ci.md` (use the date of the last run)
- Modify: whatever the runs show is wrong, by cause

- [ ] **Step 1: Run the local suites:** `npm test`, `npm run typecheck`. Expected: pass.
- [ ] **Step 2: Record the tip and its skip record.**

```bash
git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform rev-parse HEAD | tee -a /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified >> /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-reviewed
```

Then append `Skip record: <sha> (<what this push carries>; remove from both records before the final /simplify run)` to the ledger.
- [ ] **Step 3: Push, as a command of its own:** `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform push origin cross-platform`. It also carries the docs commits that waited for a code push (plan 1's ruling).
- [ ] **Step 4: Read the run.** `gh run list --branch cross-platform --workflow Tests --limit 1`, then `gh run watch <id> --exit-status`. For each failing job, read `gh run view <id> --log-failed` and `gh run view <id> --json jobs`.
- [ ] **Step 5: Fix by cause.** Code fixes follow TDD: a unit test that pins the cause where one can, or else an e2e test that shows it. Each fix is a commit of its own. Then repeat Steps 1–4, with a new skip record for each push, until macOS, Windows and Linux are green, every step included. Where a Windows-only e2e check can't behave as on the Mac (spec §10.2), the test says why in a comment. It is never skipped without that.
- [ ] **Step 6: Write the findings:** each run (link, commit, what changed), what each system failed on and why, what each fix was, the `[status-check]` line from Windows, and what stays for 2b, 2c and the owner's Windows PC check (spec §10.4). Commit it (Markdown only, so the gate needs no record). Push it with the next code push, or now if the branch is green.
- [ ] **Step 7: Tell the owner** what works on each system now, what the CI runs found, and that plan 2b (the setup window) comes next.
