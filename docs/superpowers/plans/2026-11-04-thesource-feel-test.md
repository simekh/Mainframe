# TheSource feel test and early checks: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron app that runs up to 8 real `claude` sessions in Damela's main checkout, shows one at a time in a terminal built from Parallel Code's terminal handling, and reports each session's OSC 7501 status. The owner uses it to decide whether the terminal feels as good as iTerm2 (spec §10 step 1, "feel test first"). The same plan answers the spec's §11 questions in a findings file.

**Architecture:** electron-vite app with three parts. The main process owns PTYs (node-pty), batches their output, answers and parses OSC 7501, and resolves clipboard pastes. A sandboxed preload exposes a typed `window.thesource` bridge. The SolidJS renderer stacks one xterm.js view per session and shows only the selected one; only that one holds a WebGL context. Main owns sessions and status from the start, so plan 2 (the board) builds on these pieces instead of replacing them.

**Tech Stack:** Electron 44, electron-vite 6, Vite 8, SolidJS 1.9, TypeScript 5.9, xterm.js 6.1 beta (the build Parallel Code ships), node-pty 1.1, Vitest 5, Playwright 1.64 (Electron mode).

**Spec:** `docs/superpowers/specs/2026-11-04-thesource-agent-manager-design.md`. Read §2, §5, §6.1, §7.3 (OSC 7501), §10 step 1 and §11 before starting.

**Scope of this plan.** It covers the feel test and the §11 checks only. The rest of build step 1 (TODO lane from Trello, `claude -w` launches, hook-based status, Needs you/Working lanes, Ctrl+Tab, Reopen) gets plan 2. Plan 2 is written after Task 8 passes, from the findings of Task 9, because those findings decide how sessions are launched (for example §11.1 and §11.7 decide between `-w` and `EnterWorktree`). If Task 8 fails, plan 2 is not written (spec §5).

## Global Constraints

- `<root>` = `/Users/simonekholm/Developer/Simmesolo/TheSource`; `<damela>` = `/Users/simonekholm/Developer/Simmesolo/Damela`; `<pc>` = a clone of https://github.com/johannesjo/parallel-code at commit `97c3558`, outside the repo (e.g. the session scratchpad); never committed.
- Every command passes absolute paths (`npm --prefix <root> …`, `git -C <root> …`); never `cd x && …` (owner's global CLAUDE.md).
- Work on a branch `feel-test` off `main`.
- macOS only (macOS 26, Node 24 via nvm, npm). No `"type": "module"` in package.json: main and preload build to CommonJS, which a sandboxed preload requires.
- Pinned versions: `electron@44.10.2` (electron-vite 6 targets Electron 42–44; 45 is newer than it), `electron-vite@6.0.0`, `vite@8.3.5`, `vite-plugin-solid@2.11.15`, `solid-js@1.9.18`, `typescript@~5.9.3`, `vitest@5.1.0`, `@playwright/test@1.64.1`, `@types/node@^24`, `node-pty@1.1.0`, `@xterm/xterm@6.1.0-beta.195`, `@xterm/addon-webgl@0.20.0-beta.194`, `@xterm/addon-fit@0.12.0-beta.195`, `@xterm/headless@6.1.0-beta.195` (dev, tests only). The xterm betas are the exact set in Parallel Code's lockfile at 97c3558, which the copied code runs on.
- Every session is a normal interactive `claude` process (default argv `["claude"]`, no flags) with the owner's usual settings (spec §2). The app never edits the owner's or a repo's settings files.
- Session state comes only from OSC 7501 in this plan; never from regexes on terminal output (spec §6.2, §2 anti-goal).
- Code adapted from Parallel Code starts with `// Adapted from Parallel Code (MIT): <path> at 97c3558. See THIRD_PARTY_NOTICES.md.` `THIRD_PARTY_NOTICES.md` holds `<pc>/LICENSE` copied verbatim (at 97c3558 its notice line reads `Copyright (c) 2026 Johannes Millan`) and lists the adapted files.
- Terminal look matches the owner's iTerm2 Default profile: font `Monaco` 13, line height 1.05, cursor not blinking. Keyboard layout is Swedish – Pro and iTerm2 sends Option as a normal key, so `macOptionIsMeta` is `false` (otherwise @, $, |, [ ], { } can't be typed).
- On macOS the app menu sees key equivalents before the page does (Parallel Code `electron/menu-template.ts`). So Cmd+C/Cmd+V stay with the standard Edit menu, and the terminal handles the DOM `copy` and `paste` events, not the keys. Never bind Cmd+R (reload) or Cmd+W.
- UI work invokes the `frontend-design:frontend-design` skill (owner's global CLAUDE.md).
- Commit messages carry no AI attribution of any kind (owner's global CLAUDE.md).

## Review Focus

1. **Swedish Option-key characters** (Option+2 → @, Option+8/9 → [ ], Option+Shift+8/9 → { }, Option+7 → |, Option+¨ dead key → ~) must reach `claude` exactly as in iTerm2. Pinned by the keybinding test in Task 6 (Option keys are never intercepted) and the `TERMINAL_OPTIONS` test (`macOptionIsMeta: false`).
2. **The app started with `npm start` from iTerm2 or from a Claude Code session** passes its launcher's environment to every session. From iTerm2 and Claude Code that is `TERM_PROGRAM=iTerm.app`, `ITERM_SESSION_ID`, `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID` and similar, so `claude` misdetects the terminal or acts as a nested session. From npm and Vite it is `npm_*`, `NODE_ENV` and TheSource's `node_modules/.bin` at the front of PATH, so a Damela session's `npm install` or bare `tsc` behaves differently. Pinned by the two `buildSpawnEnv` tests in Task 2, whose lists were taken from a real Claude Code session's environment and a real `npm run`.
3. **A huge output burst in a session that isn't on screen** (a long file dump while the owner looks at another session) must neither stall nor grow memory without bound; it must all be there on return. Pinned by the `OutputFlow` watermark test in Task 6 and the flood e2e test in Task 7.
4. **Quitting with sessions running** must leave no orphaned `claude` processes, and none of the processes they started. Two layers protect this. Every PTY's controlling side closes when the app exits, so the kernel sends SIGHUP to each session's foreground process group. `killAll` on `before-quit` sends the same signal earlier and on purpose. The `killAll` unit test in Task 4 pins that it reaches every session. The quit e2e test in Task 7 pins the outcome (the session's shell is gone), but it can't tell the two layers apart. What `claude` itself started, such as MCP servers in their own process groups, no automated test covers; feel-test check 13 counts those by hand.
5. **The OSC 7501 support query split across PTY reads, or followed in the same read by the program's `CSI c`**, must still be answered, and answered before xterm's DA1 reply, or `claude` decides the terminal has no support (spec: "If the terminal's reply to `CSI c` arrives first, the protocol is unsupported"). Pinned by the split-query test in Task 3 and the reply-order test in Task 4. Main answers the query as soon as it reads it; the renderer's DA1 reply can only come later.

---

## File structure

```
package.json, electron.vite.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
THIRD_PARTY_NOTICES.md            Parallel Code MIT notice and list of adapted files
scripts/fix-node-pty-spawn-helper.mjs   postinstall: chmod node-pty's spawn-helper (from Parallel Code)
src/shared/types.ts               types shared by main, preload and renderer
src/shared/ipc.ts                 IPC channel names and the TheSourceApi bridge interface
src/main/index.ts                 app start, window, quit handling
src/main/config.ts                AppConfig from environment variables
src/main/menu.ts                  macOS app menu (Edit roles, View → Redraw Terminals)
src/main/ipc.ts                   ipcMain handlers wiring bridge ↔ SessionHost
src/main/sessions.ts              SessionRegistry: ids, names, launch specs
src/main/clipboard.ts             resolveClipboardPaste: file → path, image → saved PNG path, text
src/main/pty/spawnEnv.ts          environment for session processes
src/main/pty/outputBatcher.ts     leading-edge output batching
src/main/pty/sessionHost.ts       PTY lifecycle, OSC 7501 answering, status, flow control
src/main/status/osc7501.ts        streaming OSC 7501 scanner and report parser
src/main/status/programStatus.ts  per-session record store (OSC 7501 lifetimes)
src/preload/index.ts              contextBridge → window.thesource
src/renderer/index.html, src/renderer/src/main.tsx, App.tsx, app.css, env.d.ts
src/renderer/src/sessionsStore.ts  Solid store: sessions, selection, status, exit
src/renderer/src/ptyEvents.ts      one bridge listener per event, dispatch by session id
src/renderer/src/terminal/TerminalView.tsx   one xterm per session
src/renderer/src/terminal/terminalOptions.ts xterm options (iTerm2 match)
src/renderer/src/terminal/keybindings.ts     Shift+Enter, Cmd+←/→/⌫, scrollback keys
src/renderer/src/terminal/osc52.ts           OSC 52 copy, gesture-gated (from terminalClipboard.ts)
src/renderer/src/terminal/copyText.ts        copy cleanup (from copy-text.ts)
src/renderer/src/terminal/escapePath.ts      shell-escaping dropped/pasted paths (from terminalDrop.ts)
src/renderer/src/terminal/inputBatcher.ts    optional input batching (feel-test knob)
src/renderer/src/terminal/outputFlow.ts      renderer output queue with PTY pause/resume
src/renderer/src/terminal/webglLoss.ts       WebGL context-loss brake (from webglContextLoss.ts)
src/renderer/src/terminal/registry.ts        terminal registry, fit, redraw-all
e2e/launch.ts, e2e/app.e2e.ts, e2e/bridge.e2e.ts, e2e/terminal.e2e.ts
docs/feel-test.md                                   checklist and verdict (Task 8)
docs/superpowers/findings/<date>-step1-checks.md    §11 answers (Task 9)
spikes/mcp-wait/                                    throwaway MCP server for §11.6 (own package.json)
```

Unit tests sit next to their module as `*.test.ts`.

---

### Task 1: App skeleton that opens a window

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `THIRD_PARTY_NOTICES.md`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `e2e/launch.ts`
- Modify: `.gitignore` (add `node_modules/`, `out/`, `test-results/`, `playwright-report/`)
- Test: `e2e/app.e2e.ts`

**Interfaces:**
- Produces: `launchApp(env?: Record<string, string>): Promise<{ app: ElectronApplication; page: Page }>` in `e2e/launch.ts`. It launches `<root>` with `{ ...process.env, THESOURCE_E2E: '1', THESOURCE_PROJECT_DIR: os.tmpdir(), THESOURCE_SESSION_ARGV: '["/bin/bash","--noprofile","--norc"]', PS1: '$ ', BASH_SILENCE_DEPRECATION_WARNING: '1', ...env }` and returns the first window. Later e2e tests use only this.
- Produces: npm scripts `dev` (`electron-vite dev`), `build` (`electron-vite build`), `start` (`electron-vite preview`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:e2e` (`electron-vite build && playwright test`).

- [ ] **Step 0: Start the branch**

Run: `git -C <root> status --short`. Expected: empty. If the spec or this plan shows as changed or untracked, ask the owner to commit them on `main` first; don't fold them into a feature commit. Then: `git -C <root> switch -c feel-test main`.

- [ ] **Step 1: Clone Parallel Code for reference**

Run: `git clone https://github.com/johannesjo/parallel-code.git <pc>` then `git -C <pc> checkout 97c3558`
Expected: `git -C <pc> log -1 --oneline` prints `97c3558c fix(status): show agent working as soon as a prompt is sent`.

- [ ] **Step 2: Write package.json, configs and the failing smoke test**

`package.json`: `name` `thesource`, `private: true`, `main: "out/main/index.js"`, the scripts above, and the pinned dev dependencies from Global Constraints (electron, electron-vite, vite, vite-plugin-solid, typescript, vitest, @playwright/test, @types/node) plus `solid-js` as a dependency. `electron.vite.config.ts`: `defineConfig({ main: {}, preload: { build: { externalizeDeps: false } }, renderer: { plugins: [solid()] } })`; the sandboxed preload must not `require` anything but `electron`. `vitest.config.ts`: `include: ['src/**/*.test.ts']`. `playwright.config.ts`: `testDir: 'e2e'`, `testMatch: '**/*.e2e.ts'`, `workers: 1`, `timeout: 60_000`. `tsconfig.json`: `strict`, `noEmit`, `target ES2023`, `module ESNext`, `moduleResolution bundler`, `jsx preserve`, `jsxImportSource solid-js`, `lib [ES2023, DOM, DOM.Iterable]`, `types [node]`, `include [src, e2e, *.config.ts, electron.vite.config.ts]`.

```ts
// e2e/app.e2e.ts
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test('opens the TheSource window', async () => {
  const { app, page } = await launchApp();
  expect(await page.title()).toBe('TheSource');
  await app.close();
});
```

- [ ] **Step 3: Install and see the test fail**

Run: `npm --prefix <root> install` then `npm --prefix <root> run test:e2e`
Expected: FAIL (no main entry yet, build or launch error).

- [ ] **Step 4: Implement the window**

`src/main/index.ts`: on `app.whenReady()` create a `BrowserWindow` (title `TheSource`, 1400×900, `backgroundColor` matching the renderer background, `webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }`). `backgroundThrottling: false` keeps output parsing and terminal replies running while the window is hidden (Parallel Code `electron/main.ts`). Before ready: `app.commandLine.appendSwitch('max-active-webgl-contexts', '64')`. Load `process.env.ELECTRON_RENDERER_URL` when set (dev), else `join(__dirname, '../renderer/index.html')`. Deny new windows (`setWindowOpenHandler(() => ({ action: 'deny' }))`) and in-page navigation (`will-navigate` → `preventDefault`). Quit when the window closes. `src/preload/index.ts` is empty for now. `index.html` has `<title>TheSource</title>` and mounts `App` (a placeholder heading). Write `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 5: Run the test and typecheck**

Run: `npm --prefix <root> run test:e2e` then `npm --prefix <root> run typecheck`
Expected: 1 passed; typecheck prints no errors.

- [ ] **Step 6: Commit**

```bash
git -C <root> add .gitignore package.json package-lock.json electron.vite.config.ts tsconfig.json vitest.config.ts playwright.config.ts THIRD_PARTY_NOTICES.md src e2e
git -C <root> commit -m "feat: Electron + Solid skeleton that opens the TheSource window"
```

---

### Task 2: Config and the session environment

**Files:**
- Create: `src/main/config.ts`, `src/main/pty/spawnEnv.ts`
- Test: `src/main/config.test.ts`, `src/main/pty/spawnEnv.test.ts`

**Interfaces:**
- Produces: `interface AppConfig { projectDir: string; sessionArgv: string[]; inputBatchMs: number; outputBatchMs: number; logOsc: boolean; e2e: boolean }` and `loadConfig(env: NodeJS.ProcessEnv, isDirectory: (path: string) => boolean): AppConfig`. It throws an `Error` whose message names the offending variable. Variables: `THESOURCE_PROJECT_DIR` (default `/Users/simonekholm/Developer/Simmesolo/Damela`, must be a directory), `THESOURCE_SESSION_ARGV` (JSON array of ≥1 strings, default `["claude"]`), `THESOURCE_INPUT_BATCH_MS` (integer 0–50, default 0), `THESOURCE_OUTPUT_BATCH_MS` (integer 0–50, default 8), `THESOURCE_LOG_OSC` (`1` → true), `THESOURCE_E2E` (`1` → true).
- Produces: `buildSpawnEnv(base: NodeJS.ProcessEnv): Record<string, string>`.

The batching defaults are a choice the feel test revisits. Input 0 because Parallel Code's 8 ms input timer delays every keystroke. Output 8 because its leading edge already sends echoes after a quiet spell at once (spec §6.1).

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const isDir = () => true;

describe('loadConfig', () => {
  it('uses the defaults', () => {
    expect(loadConfig({}, isDir)).toEqual({
      projectDir: '/Users/simonekholm/Developer/Simmesolo/Damela',
      sessionArgv: ['claude'], inputBatchMs: 0, outputBatchMs: 8, logOsc: false, e2e: false,
    });
  });

  it('reads every override', () => {
    expect(loadConfig({
      THESOURCE_PROJECT_DIR: '/tmp/x', THESOURCE_SESSION_ARGV: '["/bin/zsh","-l"]',
      THESOURCE_INPUT_BATCH_MS: '8', THESOURCE_OUTPUT_BATCH_MS: '0', THESOURCE_LOG_OSC: '1', THESOURCE_E2E: '1',
    }, isDir)).toEqual({
      projectDir: '/tmp/x', sessionArgv: ['/bin/zsh', '-l'], inputBatchMs: 8, outputBatchMs: 0, logOsc: true, e2e: true,
    });
  });

  it.each([
    ['THESOURCE_SESSION_ARGV', '[]'], ['THESOURCE_SESSION_ARGV', 'claude'], ['THESOURCE_SESSION_ARGV', '[1]'],
    ['THESOURCE_INPUT_BATCH_MS', '-1'], ['THESOURCE_INPUT_BATCH_MS', '51'], ['THESOURCE_OUTPUT_BATCH_MS', '2.5'],
  ])('rejects %s=%s and names the variable', (key, value) => {
    expect(() => loadConfig({ [key]: value }, isDir)).toThrow(key);
  });

  it('rejects a project dir that is not a directory', () => {
    expect(() => loadConfig({ THESOURCE_PROJECT_DIR: '/nope' }, () => false)).toThrow('THESOURCE_PROJECT_DIR');
  });
});
```

```ts
// src/main/pty/spawnEnv.test.ts
import { it, expect } from 'vitest';
import { buildSpawnEnv } from './spawnEnv';

it('sets the terminal identity and drops the parent terminal and Claude Code session markers', () => {
  expect(buildSpawnEnv({
    PATH: '/usr/bin', HOME: '/Users/x', CLAUDE_CODE_NO_FLICKER: '1', MISSING: undefined,
    TERM: 'dumb', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.7.6', TERM_SESSION_ID: 'w0', TERM_FEATURES: 'T3',
    TERMINFO_DIRS: '/x', ITERM_SESSION_ID: 'w0t0', ITERM_PROFILE: 'Default', LC_TERMINAL: 'iTerm2',
    LC_TERMINAL_VERSION: '3.7.6', __CFBundleIdentifier: 'com.googlecode.iterm2',
    CLAUDECODE: '1', CLAUDE_PID: '1', CLAUDE_EFFORT: 'xhigh', CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_EXECPATH: '/x', CLAUDE_CODE_MESSAGING_SOCKET: '/s',
    CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: 'id',
    ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://localhost:5173',
  })).toEqual({
    PATH: '/usr/bin', HOME: '/Users/x', CLAUDE_CODE_NO_FLICKER: '1',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8',
  });
});

it('drops what `npm start` and Vite add, keeping the rest of PATH in order', () => {
  expect(buildSpawnEnv({
    PATH: [
      '<root>/node_modules/.bin', '/Users/simonekholm/Developer/node_modules/.bin', '/node_modules/.bin',
      '/Users/x/.nvm/versions/node/v24.21.0/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',
      '/Users/x/.local/bin', '/usr/bin',
    ].join(':'),
    NODE: '/x/node', COLOR: '0', INIT_CWD: '/x', NODE_ENV: 'production', EDITOR: 'vi',
    npm_command: 'run-script', npm_config_prefix: '/x', npm_lifecycle_event: 'start', npm_package_name: 'thesource',
  })).toEqual({
    PATH: '/Users/x/.local/bin:/usr/bin', EDITOR: 'vi',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8',
  });
});

it('keeps an existing LANG', () => {
  expect(buildSpawnEnv({ LANG: 'sv_SE.UTF-8' }).LANG).toBe('sv_SE.UTF-8');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/config.test.ts src/main/pty/spawnEnv.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `loadConfig` and `buildSpawnEnv`**

`buildSpawnEnv` drops undefined values, every `ELECTRON_*` key, and exactly these keys: `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERM_SESSION_ID`, `TERM_FEATURES`, `TERMINFO_DIRS`, `ITERM_SESSION_ID`, `ITERM_PROFILE`, `LC_TERMINAL`, `LC_TERMINAL_VERSION`, `__CFBundleIdentifier`, `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_SESSION_ID`. Other `CLAUDE_CODE_*` keys are the owner's own settings and stay. It also drops what launching through `npm start` adds, measured with `npm run` on this machine: every `npm_*` key, `INIT_CWD`, `NODE`, `COLOR`, and `NODE_ENV` (Vite sets it in electron-vite's process; the owner's shell never does). From `PATH` it removes the entries ending in `/node_modules/.bin` and the one containing `/@npmcli/run-script/`, keeping the others in order. `EDITOR` stays: npm only fills it in (`vi`) when it's unset. Then it always sets `TERM=xterm-256color` and `COLORTERM=truecolor`, and sets `LANG=en_US.UTF-8` only when `LANG` is absent.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm --prefix <root> test -- src/main/config.test.ts src/main/pty/spawnEnv.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/main/config.ts src/main/config.test.ts src/main/pty/spawnEnv.ts src/main/pty/spawnEnv.test.ts
git -C <root> commit -m "feat: app config from environment and a clean session environment"
```

---

### Task 3: OSC 7501 scanner, parser and status records

The wire format is from the protocol spec (https://superlogical.com/rex/docs/build/program-status, read 2026-11-04). Query `ESC ] 7501 ; ? ST`. Report `ESC ] 7501 ; key=value(:key=value)* ST`, with ST = `ESC \` or BEL; keys `[a-z]+`, values `[A-Za-z0-9_.,+/=-]*`. Whitespace around keys and values is trimmed, malformed pairs are skipped, unknown keys are ignored, and the last repeat wins. `state` is required: `idle|working|done|blocked|error|clear`; an unknown value drops the report. `id` is a `/`-path of `[A-Za-z0-9_.+-]{1,32}` segments, ≤8 levels, ≤128 bytes; absent means the root record. `kind` is `permission|question|auth` and kept only with `blocked`. `progress` is an integer 0–100, kept only with `working`/`blocked`. `app` is `[A-Za-z0-9_.+-]{1,32}`. `title` and `msg` are base64 UTF-8 without control characters. Limits: whole sequence 4096 bytes, key 16, msg 2732 encoded/2048 decoded, title 256/192, app 32. A report over any limit is dropped whole. Lifetimes: `working` and `blocked` end with the process; `done`, `error` and `idle` survive it. `clear` removes the record and its children, and all records when it has no id. At most 256 records; past that the least recently updated one is evicted.

Parsing lives in main, not in a renderer `registerOscHandler` (spec §7.3 records this choice). Main is the only place that sees every session's output whether or not its view is mounted. It also answers the query before the renderer can send xterm's DA1 reply, and plan 2's board reads status there.

**Files:**
- Create: `src/shared/types.ts`, `src/main/status/osc7501.ts`, `src/main/status/programStatus.ts`
- Test: `src/main/status/osc7501.test.ts`, `src/main/status/programStatus.test.ts`

**Interfaces:**
- Produces in `src/shared/types.ts`: `type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error'`; `type ProgramKind = 'permission' | 'question' | 'auth'`; `interface ProgramReport { state: ProgramState | 'clear'; id: string; kind?: ProgramKind; progress?: number; app?: string; title?: string; msg?: string }`; `interface ProgramStatus extends Omit<ProgramReport, 'state'> { state: ProgramState; updatedAt: number }`.
- Produces in `osc7501.ts`: `type Osc7501Event = { type: 'query' } | { type: 'report'; report: ProgramReport }`; `class Osc7501Scanner { feed(chunk: string): Osc7501Event[] }`; `parseReportPayload(payload: string): ProgramReport | null` (payload = the text after `7501;`); `const OSC7501_SUPPORT_REPLY: string`.
- Produces in `programStatus.ts`: `class ProgramStatusRecords { apply(report: ProgramReport, now: number): void; onProcessExit(): void; current(): ProgramStatus | null; ids(): string[] }`. `current()` is the most recently updated record.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/status/osc7501.test.ts
import { describe, it, expect } from 'vitest';
import { Osc7501Scanner, parseReportPayload, OSC7501_SUPPORT_REPLY } from './osc7501';

const ST = '\x1b\\';
const BEL = '\x07';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const report = (state: string) => ({ type: 'report', report: { state, id: '' } });

describe('Osc7501Scanner', () => {
  it('finds a support query ended by ST or BEL', () => {
    expect(new Osc7501Scanner().feed(`a\x1b]7501;?${ST}b`)).toEqual([{ type: 'query' }]);
    expect(new Osc7501Scanner().feed(`\x1b]7501;?${BEL}`)).toEqual([{ type: 'query' }]);
  });

  it('joins a sequence split across chunks, even inside the ST', () => {
    const s = new Osc7501Scanner();
    expect(s.feed('\x1b]75')).toEqual([]);
    expect(s.feed('01;state=work')).toEqual([]);
    expect(s.feed('ing\x1b')).toEqual([]);
    expect(s.feed('\\rest')).toEqual([report('working')]);
  });

  it('finds a support query split across chunks and followed by CSI c', () => {
    const s = new Osc7501Scanner();
    expect(s.feed('\x1b]7501')).toEqual([]);
    expect(s.feed(';?\x1b')).toEqual([]);
    expect(s.feed('\\\x1b[c')).toEqual([{ type: 'query' }]);
  });

  it('skips other OSC sequences, large OSC 52 payloads included', () => {
    expect(new Osc7501Scanner().feed(
      `\x1b]0;title${BEL}\x1b]52;c;${'A'.repeat(100_000)}${BEL}\x1b]7501;state=idle${ST}`,
    )).toEqual([report('idle')]);
  });

  it('accepts a 4096-byte sequence, drops a 4097-byte one, and finds the next', () => {
    const seq = (n: number) => `\x1b]7501;state=idle:x=${'A'.repeat(n)}${ST}`;
    expect(seq(4074)).toHaveLength(4096);
    expect(new Osc7501Scanner().feed(seq(4074))).toHaveLength(1);
    expect(new Osc7501Scanner().feed(seq(4075) + `\x1b]7501;state=done${ST}`)).toEqual([report('done')]);
  });

  it('abandons an OSC cut off by another escape sequence', () => {
    expect(new Osc7501Scanner().feed(`\x1b]7501;state=idle\x1b[31m\x1b]7501;state=done${ST}`))
      .toEqual([report('done')]);
  });
});

describe('parseReportPayload', () => {
  it('reads every field', () => {
    expect(parseReportPayload(
      `state=blocked:kind=question:id=claude/s1:app=claude:progress=40:title=${b64('Fix #124')}:msg=${b64('Needs an answer')}`,
    )).toEqual({ state: 'blocked', kind: 'question', id: 'claude/s1', app: 'claude', progress: 40, title: 'Fix #124', msg: 'Needs an answer' });
  });

  it('trims, skips malformed pairs, ignores unknown keys, last value wins', () => {
    expect(parseReportPayload(' state = idle : bogus : Upper=1 : future=x : state=done ')).toEqual({ state: 'done', id: '' });
  });

  it.each(['', 'kind=question', 'state=sleeping'])('rejects %j (no or unknown state)', (p) => {
    expect(parseReportPayload(p)).toBeNull();
  });

  it('keeps kind only with blocked, progress only with working/blocked and 0–100', () => {
    expect(parseReportPayload('state=done:kind=question:progress=10')).toEqual({ state: 'done', id: '' });
    expect(parseReportPayload('state=blocked:kind=telepathy')).toEqual({ state: 'blocked', id: '' });
    expect(parseReportPayload('state=working:progress=101')).toEqual({ state: 'working', id: '' });
  });

  it.each([
    `state=idle:id=${'a'.repeat(33)}`,
    'state=idle:id=a/b/c/d/e/f/g/h/i',
    `state=idle:id=${Array(5).fill('a'.repeat(32)).join('/')}`,
    'state=idle:id=a//b',
    `state=idle:app=${'a'.repeat(33)}`,
    `state=idle:msg=${b64('line\nbreak')}`,
    `state=idle:msg=${b64('x'.repeat(2049))}`,
    `state=idle:title=${b64('x'.repeat(193))}`,
    'state=idle:msg=abc',
  ])('drops the whole report for %s', (p) => {
    expect(parseReportPayload(p)).toBeNull();
  });

  it('reads clear with and without an id', () => {
    expect(parseReportPayload('state=clear')).toEqual({ state: 'clear', id: '' });
    expect(parseReportPayload('state=clear:id=us-east')).toEqual({ state: 'clear', id: 'us-east' });
  });
});

it('the support reply names every state and kind', () => {
  expect(OSC7501_SUPPORT_REPLY).toBe('\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\');
});
```

```ts
// src/main/status/programStatus.test.ts
import { it, expect } from 'vitest';
import { ProgramStatusRecords } from './programStatus';

it('current() is the most recently updated record', () => {
  const r = new ProgramStatusRecords();
  expect(r.current()).toBeNull();
  r.apply({ state: 'working', id: '' }, 1);
  r.apply({ state: 'blocked', id: 'sub', kind: 'permission' }, 2);
  expect(r.current()).toEqual({ state: 'blocked', id: 'sub', kind: 'permission', updatedAt: 2 });
  r.apply({ state: 'idle', id: '' }, 3);
  expect(r.current()).toEqual({ state: 'idle', id: '', updatedAt: 3 });
});

it('clear removes a record and its children; clear without id removes all', () => {
  const r = new ProgramStatusRecords();
  r.apply({ state: 'working', id: 'a' }, 1);
  r.apply({ state: 'working', id: 'a/b' }, 2);
  r.apply({ state: 'done', id: 'ab' }, 3);
  r.apply({ state: 'clear', id: 'a' }, 4);
  expect(r.ids()).toEqual(['ab']);
  r.apply({ state: 'clear', id: '' }, 5);
  expect(r.current()).toBeNull();
});

it('process exit drops working and blocked, keeps done, error and idle', () => {
  const r = new ProgramStatusRecords();
  (['working', 'blocked', 'done', 'error', 'idle'] as const).forEach((state, i) => r.apply({ state, id: state }, i));
  r.onProcessExit();
  expect(r.ids().sort()).toEqual(['done', 'error', 'idle']);
});

it('keeps at most 256 records, evicting the least recently updated', () => {
  const r = new ProgramStatusRecords();
  for (let i = 0; i < 257; i++) r.apply({ state: 'idle', id: `r${i}` }, i);
  expect(r.ids()).toHaveLength(256);
  expect(r.ids()).not.toContain('r0');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/status`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the scanner, parser and records**

The scanner is a state machine kept across `feed` calls. States: `ground`, `esc` (after ESC), `oscPrefix` (collecting up to 5 chars to compare with `7501;`), `osc7501` (collecting payload), `oscOther` (skipping to the terminator without buffering), and `oscEsc` (ESC seen inside an OSC). In `ground`, a chunk with no `\x1b` returns `[]` without per-char work: output streams through here. In an OSC, BEL ends it; ESC followed by `\` ends it; ESC followed by anything else abandons the OSC and that char is processed from `esc`; CAN (0x18) and SUB (0x1A) abandon it. In `osc7501`, a payload that would make the sequence exceed 4096 bytes is dropped, and scanning continues in `oscOther` to the terminator. A finished payload equal to `?` (trimmed) yields `query`; otherwise `parseReportPayload`, emitting nothing on `null`. base64 is valid only if it matches `^[A-Za-z0-9+/]*={0,2}$` with length % 4 = 0, and decodes with `new TextDecoder('utf-8', { fatal: true })`. Control characters are `[\u0000-\u001f\u007f-\u009f]`. An `app` value with characters outside its pattern is treated as absent.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm --prefix <root> test -- src/main/status`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src/shared/types.ts src/main/status
git -C <root> commit -m "feat: OSC 7501 scanner, report parser and status records"
```

---

### Task 4: PTY session host

**Files:**
- Create: `scripts/fix-node-pty-spawn-helper.mjs` (copy of `<pc>/scripts/fix-node-pty-spawn-helper.mjs`), `src/main/pty/outputBatcher.ts`, `src/main/pty/sessionHost.ts`
- Modify: `package.json` (dependency `node-pty@1.1.0`; `"postinstall": "node scripts/fix-node-pty-spawn-helper.mjs"`)
- Test: `src/main/pty/outputBatcher.test.ts`, `src/main/pty/sessionHost.test.ts`, `src/main/pty/sessionHost.pty.test.ts`

**Interfaces:**
- Consumes: `Osc7501Scanner`, `OSC7501_SUPPORT_REPLY`, `ProgramStatusRecords`, `ProgramStatus` (Task 3); `buildSpawnEnv` (Task 2).
- Produces: `createOutputBatcher(opts: { intervalMs: number; maxBytes?: number; send: (data: Uint8Array) => void }): { push(chunk: string): void; flush(): void; dispose(): void }`. `maxBytes` defaults to 65536 and is counted in UTF-8 bytes.
- Produces in `sessionHost.ts`:
  - `interface PtyLike { onData(cb: (data: string) => void): unknown; onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown; write(data: string): void; resize(cols: number, rows: number): void; pause(): void; resume(): void; kill(signal?: string): void }`
  - `type SpawnPty = (file: string, args: string[], opts: { name: string; cwd: string; env: Record<string, string>; cols: number; rows: number }) => PtyLike` (node-pty's `spawn` fits)
  - `interface SessionListener { onData(data: Uint8Array): void; onStatus(status: ProgramStatus | null): void; onExit(e: { exitCode: number; signal: number | null }): void }`
  - `class SessionHost { constructor(opts: { spawnPty: SpawnPty; outputBatchMs: number; env: Record<string, string>; log?: (line: string) => void }); spawn(id: string, spec: { argv: string[]; cwd: string; cols: number; rows: number }, listener: SessionListener): void; write(id: string, data: string): void; resize(id: string, cols: number, rows: number): void; pause(id: string): void; resume(id: string): void; kill(id: string): void; killAll(): void; has(id: string): boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/pty/outputBatcher.test.ts
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createOutputBatcher } from './outputBatcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (intervalMs: number) => {
  const sent: string[] = [];
  const b = createOutputBatcher({ intervalMs, send: (d) => sent.push(Buffer.from(d).toString()) });
  return { b, sent };
};

it('sends the first chunk after a quiet spell at once and coalesces the rest within the interval', () => {
  const { b, sent } = setup(8);
  b.push('a'); b.push('b'); b.push('c');
  expect(sent).toEqual(['a']);
  vi.advanceTimersByTime(8);
  expect(sent).toEqual(['a', 'bc']);
});

it('sends at once when 64 KiB are queued', () => {
  const { b, sent } = setup(8);
  b.push('a'); b.push('x'.repeat(65536));
  expect(sent).toHaveLength(2);
});

it('with interval 0 sends every chunk at once', () => {
  const { b, sent } = setup(0);
  b.push('a'); b.push('b');
  expect(sent).toEqual(['a', 'b']);
});

it('flush() sends what is queued', () => {
  const { b, sent } = setup(8);
  b.push('a'); b.push('b'); b.flush();
  expect(sent).toEqual(['a', 'b']);
});
```

```ts
// src/main/pty/sessionHost.test.ts
import { it, expect } from 'vitest';
import { SessionHost, type PtyLike, type SpawnPty } from './sessionHost';
import { OSC7501_SUPPORT_REPLY } from '../status/osc7501';

function setup() {
  const log: string[] = [];
  const calls: Parameters<SpawnPty>[] = [];
  const ptys: Array<PtyLike & { emit(d: string): void; exit(code: number): void; killed: boolean }> = [];
  const spawnPty: SpawnPty = (...args) => {
    calls.push(args);
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const p = {
      killed: false,
      onData: (cb: typeof onData) => { onData = cb; },
      onExit: (cb: typeof onExit) => { onExit = cb; },
      write: (d: string) => log.push(`write:${d}`),
      resize: (c: number, r: number) => log.push(`resize:${c}x${r}`),
      pause: () => log.push('pause'), resume: () => log.push('resume'),
      kill: () => { p.killed = true; },
      emit: (d: string) => onData(d), exit: (code: number) => onExit({ exitCode: code }),
    };
    ptys.push(p);
    return p;
  };
  const host = new SessionHost({ spawnPty, outputBatchMs: 0, env: { PATH: '/usr/bin' } });
  const listener = {
    onData: (d: Uint8Array) => log.push(`data:${Buffer.from(d).toString()}`),
    onStatus: (s: { state: string } | null) => log.push(`status:${s ? s.state : 'none'}`),
    onExit: (e: { exitCode: number }) => log.push(`exit:${e.exitCode}`),
  };
  return { host, ptys, calls, log, listener };
}

const spec = { argv: ['claude', '--x'], cwd: '/repo', cols: 100, rows: 30 };

it('spawns argv[0] with the rest as args, in cwd, with size and env', () => {
  const { host, calls, listener } = setup();
  host.spawn('s1', spec, listener);
  expect(calls[0]).toEqual(['claude', ['--x'], { name: 'xterm-256color', cwd: '/repo', env: { PATH: '/usr/bin' }, cols: 100, rows: 30 }]);
});

it('answers an OSC 7501 query before forwarding the output that carried it', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('hi\x1b]7501;?\x1b\\\x1b[c');
  expect(log).toEqual([`write:${OSC7501_SUPPORT_REPLY}`, 'data:hi\x1b]7501;?\x1b\\\x1b[c']);
});

it('reports status from OSC 7501 reports', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('\x1b]7501;state=working\x07');
  expect(log).toContain('status:working');
});

it('on exit sends remaining output, drops working status, reports the exit and forgets the session', () => {
  const { host, ptys, log, listener } = setup();
  host.spawn('s1', spec, listener);
  ptys[0].emit('\x1b]7501;state=working\x07');
  log.length = 0;
  ptys[0].exit(0);
  expect(log).toEqual(['status:none', 'exit:0']);
  expect(host.has('s1')).toBe(false);
  host.write('s1', 'x');
  expect(log).toEqual(['status:none', 'exit:0']);
});

it('refuses a second session with the same id', () => {
  const { host, listener } = setup();
  host.spawn('s1', spec, listener);
  expect(() => host.spawn('s1', spec, listener)).toThrow('s1');
});

it('passes write, resize, pause and resume through', () => {
  const { host, log, listener } = setup();
  host.spawn('s1', spec, listener);
  host.write('s1', 'ls\r'); host.resize('s1', 90, 20); host.pause('s1'); host.resume('s1');
  expect(log).toEqual(['write:ls\r', 'resize:90x20', 'pause', 'resume']);
});

it('killAll kills every running session', () => {
  const { host, ptys, listener } = setup();
  host.spawn('a', spec, listener);
  host.spawn('b', spec, listener);
  host.killAll();
  expect(ptys.map((p) => p.killed)).toEqual([true, true]);
});
```

```ts
// src/main/pty/sessionHost.pty.test.ts
import { it, expect } from 'vitest';
import * as pty from 'node-pty';
import { SessionHost } from './sessionHost';
import { buildSpawnEnv } from './spawnEnv';

it('runs a real command in a PTY and reports its output and exit code', async () => {
  const host = new SessionHost({ spawnPty: pty.spawn, outputBatchMs: 8, env: buildSpawnEnv(process.env) });
  let out = '';
  const code = await new Promise<number>((resolve) => host.spawn('real',
    { argv: ['/bin/sh', '-c', 'printf "pty-%s" ok; exit 3'], cwd: '/tmp', cols: 80, rows: 24 },
    { onData: (d) => { out += Buffer.from(d).toString(); }, onStatus: () => {}, onExit: (e) => resolve(e.exitCode) }));
  expect(out).toContain('pty-ok');
  expect(code).toBe(3);
});
```

- [ ] **Step 2: Install node-pty and run the tests to see them fail**

Run: `npm --prefix <root> install node-pty@1.1.0` then `npm --prefix <root> test -- src/main/pty`
Expected: install succeeds and the postinstall chmods `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`. Tests FAIL, modules not found.

- [ ] **Step 3: Implement `createOutputBatcher` and `SessionHost`**

The batcher follows Parallel Code `electron/ipc/pty.ts` `attachPtyOutputHandlers`. A chunk arriving with no timer pending and at least `intervalMs` since the last send goes out at once (leading edge). Otherwise it waits for a timer of `intervalMs`; ≥ `maxBytes` queued sends at once. On each PTY data chunk `SessionHost` does, in this order:
1. `scanner.feed(chunk)`; for each `query`, synchronously `proc.write(OSC7501_SUPPORT_REPLY)`; for each `report`, `records.apply(report, Date.now())` then `listener.onStatus(records.current())`. With `log` set, it logs `[osc7501] <id> query` or `[osc7501] <id> <raw payload>`.
2. `batcher.push(chunk)`.

On exit: `batcher.flush()`, `records.onProcessExit()`, `listener.onStatus(records.current())`, `listener.onExit({ exitCode, signal: signal ?? null })`, then forget the session. Calls for unknown ids do nothing. `kill` and `killAll` call `proc.kill()`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm --prefix <root> test -- src/main/pty`
Expected: all pass, the real-PTY test included.

- [ ] **Step 5: Commit**

```bash
git -C <root> add package.json package-lock.json scripts src/main/pty
git -C <root> commit -m "feat: PTY session host with output batching and OSC 7501 answering"
```

---

### Task 5: Bridge between main and renderer

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/sessions.ts`, `src/main/clipboard.ts`, `src/main/ipc.ts`, `src/renderer/src/env.d.ts`
- Modify: `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `src/main/sessions.test.ts`, `src/main/clipboard.test.ts`, `e2e/bridge.e2e.ts`

**Interfaces:**
- Consumes: `loadConfig`, `buildSpawnEnv` (Task 2); `SessionHost` (Task 4); `ProgramStatus` (Task 3).
- Produces in `src/shared/types.ts`: `interface SessionInfo { id: string; name: string; cwd: string }`; `type ClipboardPaste = { kind: 'file' | 'image'; path: string } | { kind: 'text'; text: string } | { kind: 'empty' }`; `interface RendererConfig { inputBatchMs: number; e2e: boolean }`; `interface PtyDataEvent { sessionId: string; data: Uint8Array }`; `interface PtyExitEvent { sessionId: string; exitCode: number; signal: number | null }`; `interface StatusEvent { sessionId: string; status: ProgramStatus | null }`.
- Produces in `src/shared/ipc.ts`: channel constants `IPC = { getConfig: 'app:get-config', createSession: 'session:create', spawn: 'pty:spawn', write: 'pty:write', resize: 'pty:resize', pause: 'pty:pause', resume: 'pty:resume', kill: 'pty:kill', data: 'pty:data', exit: 'pty:exit', status: 'session:status', resolvePaste: 'clipboard:resolve-paste', redrawTerminals: 'app:redraw-terminals' } as const`. Also the bridge interface:
  ```ts
  interface TheSourceApi {
    getConfig(): Promise<RendererConfig>;
    createSession(): Promise<SessionInfo>;
    spawn(req: { sessionId: string; cols: number; rows: number }): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    pause(sessionId: string): void;
    resume(sessionId: string): void;
    kill(sessionId: string): void;
    resolvePaste(): Promise<ClipboardPaste>;
    getPathForFile(file: File): string;
    onData(cb: (e: PtyDataEvent) => void): () => void;
    onExit(cb: (e: PtyExitEvent) => void): () => void;
    onStatus(cb: (e: StatusEvent) => void): () => void;
    onRedrawTerminals(cb: () => void): () => void;
  }
  ```
  `src/renderer/src/env.d.ts` declares `window.thesource: TheSourceApi`.
- Produces in `src/main/sessions.ts`: `class SessionRegistry { constructor(opts: { projectDir: string; sessionArgv: string[] }); create(): SessionInfo; launchSpec(id: string): { argv: string[]; cwd: string } }`. Ids come from `crypto.randomUUID()`, names are `Session 1`, `Session 2`, …, and `launchSpec` throws on an unknown id.
- Produces in `src/main/clipboard.ts`: `resolveClipboardPaste(clipboard: ClipboardReader, writeFile: (path: string, data: Buffer) => Promise<void>, newImagePath: () => string): Promise<ClipboardPaste>`. `ClipboardReader` is the subset of Electron's `clipboard` it uses (`availableFormats`, `read`, `readImage`, `readText`). The order is a `public.file-url` file, then an image (saved as PNG), then text, then empty (Parallel Code `electron/ipc/register.ts` `ResolveClipboardPaste`). Each image gets its own file, so two screenshots pasted into one prompt don't overwrite each other. In `index.ts`, images go into a folder `pasteDir = join(app.getPath('temp'), 'thesource-paste')`, emptied (`rm -rf` then `mkdir -p`) at app start so the files don't pile up. `newImagePath` returns `join(pasteDir, randomUUID() + '.png')`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/sessions.test.ts
import { it, expect } from 'vitest';
import { SessionRegistry } from './sessions';

it('creates sessions with fresh ids, numbered names and the project dir', () => {
  const reg = new SessionRegistry({ projectDir: '/repo', sessionArgv: ['claude'] });
  const a = reg.create();
  const b = reg.create();
  expect(a).toMatchObject({ name: 'Session 1', cwd: '/repo' });
  expect(b.name).toBe('Session 2');
  expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(a.id).not.toBe(b.id);
  expect(reg.launchSpec(a.id)).toEqual({ argv: ['claude'], cwd: '/repo' });
});

it('launchSpec of an unknown id throws', () => {
  expect(() => new SessionRegistry({ projectDir: '/r', sessionArgv: ['claude'] }).launchSpec('nope')).toThrow('nope');
});
```

```ts
// src/main/clipboard.test.ts
import { it, expect } from 'vitest';
import { resolveClipboardPaste } from './clipboard';

const board = (o: { fileUrl?: string; png?: Buffer; text?: string }) => ({
  availableFormats: () => (o.fileUrl ? ['public.file-url'] : []),
  read: (format: string) => (format === 'public.file-url' ? o.fileUrl ?? '' : ''),
  readImage: () => ({ isEmpty: () => !o.png, toPNG: () => o.png ?? Buffer.alloc(0) }),
  readText: () => o.text ?? '',
});
const written: Array<[string, Buffer]> = [];
const write = async (p: string, d: Buffer) => { written.push([p, d]); };
let n = 0;
const nextPath = () => `/tmp/paste-${++n}.png`;

it('a Finder file copy becomes its path, ahead of image and text', async () => {
  expect(await resolveClipboardPaste(board({ fileUrl: 'file:///Users/x/My%20Shot.png', png: Buffer.from('p'), text: 't' }), write, nextPath))
    .toEqual({ kind: 'file', path: '/Users/x/My Shot.png' });
});

it('each image is saved to its own PNG', async () => {
  const png = Buffer.from([0x89, 0x50]);
  const first = await resolveClipboardPaste(board({ png }), write, nextPath);
  const second = await resolveClipboardPaste(board({ png }), write, nextPath);
  expect(first.kind).toBe('image');
  expect(second.kind).toBe('image');
  expect(first).not.toEqual(second);
  expect(written.at(-1)?.[1]).toEqual(png);
});

it('text stays text and nothing is empty', async () => {
  expect(await resolveClipboardPaste(board({ text: 'hej' }), write, nextPath)).toEqual({ kind: 'text', text: 'hej' });
  expect(await resolveClipboardPaste(board({}), write, nextPath)).toEqual({ kind: 'empty' });
});
```

```ts
// e2e/bridge.e2e.ts
import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test('a session runs its command, streams output, reports OSC 7501 status and exit', async () => {
  const { app, page } = await launchApp({
    THESOURCE_SESSION_ARGV: JSON.stringify(['/bin/sh', '-c', "printf 'bridge-%s' ok; printf '\\033]7501;state=working\\033\\\\'; sleep 0.3"]),
  });
  const result = await page.evaluate(async () => {
    const api = window.thesource;
    const s = await api.createSession();
    let output = '';
    const states: string[] = [];
    const exitCode = new Promise<number>((resolve) => {
      api.onData((e) => { if (e.sessionId === s.id) output += new TextDecoder().decode(e.data); });
      api.onStatus((e) => { if (e.sessionId === s.id) states.push(e.status ? e.status.state : 'none'); });
      api.onExit((e) => { if (e.sessionId === s.id) resolve(e.exitCode); });
    });
    await api.spawn({ sessionId: s.id, cols: 80, rows: 24 });
    return { name: s.name, code: await exitCode, output, states };
  });
  expect(result.name).toBe('Session 1');
  expect(result.output).toContain('bridge-ok');
  expect(result.states).toEqual(['working', 'none']);
  expect(result.code).toBe(0);
  await app.close();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/main/sessions.test.ts src/main/clipboard.test.ts` then `npm --prefix <root> run test:e2e -- bridge`
Expected: unit tests FAIL (modules not found); e2e FAILS (`window.thesource` undefined).

- [ ] **Step 3: Implement registry, clipboard, IPC handlers, preload and startup**

`src/main/index.ts` at startup: `loadConfig(process.env, isDirectory)`. If it throws, show `dialog.showErrorBox('TheSource', message)` and quit. Then create `SessionRegistry` and `SessionHost` with `spawnPty: pty.spawn`, `env: buildSpawnEnv(process.env)`, and `log: console.log` when `logOsc`. Call `registerIpc(win, registry, host, config, clipboardDeps)`, and on `before-quit` run `host.killAll()`. `src/main/ipc.ts`: `ipcMain.handle` for invoke channels and `ipcMain.on` for fire-and-forget ones (`write`, `resize`, `pause`, `resume`, `kill`). `spawn` looks up `registry.launchSpec` and passes a listener that calls `win.webContents.send(IPC.data | IPC.status | IPC.exit, …)` unless the window is destroyed. `src/preload/index.ts`: `contextBridge.exposeInMainWorld('thesource', api)` built only from `ipcRenderer.invoke/send/on` and `webUtils.getPathForFile`; each `on*` returns a function that removes its listener.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm --prefix <root> test` then `npm --prefix <root> run test:e2e` then `npm --prefix <root> run typecheck`
Expected: all unit tests pass; 2 e2e tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git -C <root> add src e2e
git -C <root> commit -m "feat: typed bridge for sessions, PTY I/O, status and clipboard"
```

---

### Task 6: Terminal building blocks in the renderer

**Files:**
- Create: `src/renderer/src/terminal/terminalOptions.ts`, `keybindings.ts`, `osc52.ts`, `copyText.ts`, `escapePath.ts`, `inputBatcher.ts`, `outputFlow.ts`, `webglLoss.ts`
- Modify: `package.json` (dependencies `@xterm/xterm`, `@xterm/addon-webgl`, `@xterm/addon-fit` at the pinned versions)
- Test: a `*.test.ts` beside each module

Port these modules with their tests, adapting imports and dropping what isn't used:
- `osc52.ts` ← `<pc>/src/lib/terminalClipboard.ts` (+ `terminalClipboard.test.ts`)
- `copyText.ts` ← `<pc>/src/lib/copy-text.ts` (+ test)
- `escapePath.ts` ← `escapePath` from `<pc>/src/lib/terminalDrop.ts` (+ its `escapePath` cases)
- `webglLoss.ts` ← `<pc>/src/lib/webglContextLoss.ts` (+ test)

Write the other four new.

**Interfaces:**
- Produces: `TERMINAL_OPTIONS` (an `ITerminalOptions`): `fontFamily: 'Monaco, Menlo, monospace'`, `fontSize: 13`, `lineHeight: 1.05`, `cursorBlink: false`, `macOptionIsMeta: false`, `macOptionClickForcesSelection: true`, `scrollback: 10_000`, `scrollSensitivity: 2`, and a dark theme whose background is the shell's terminal colour (set in Task 7).
- Produces: `interface KeyLike { type: string; key: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }`; `type TerminalAction = { send: string } | { scroll: 'line-up' | 'line-down' | 'page-up' | 'page-down' }`; `matchTerminalBinding(e: KeyLike): TerminalAction | undefined` (keydown only); `swallowsKeyEvent(e: KeyLike): boolean`, true for the keypress and keyup of Shift+Enter. xterm.js calls the custom key handler for keydown, keypress and keyup. A keypress that gets through after the keydown sent ESC CR would make xterm send a plain `\r` too, and the prompt would submit (Parallel Code's handler returns false for every non-keydown Shift+Enter).
- Produces: `parseOsc52Write(data: string): string | undefined`, `handleOsc52Writes(term, { allowed, write }): IDisposable`, `trackRecentGesture(container): { isRecent(): boolean; dispose(): void }`, `cleanCopiedTerminalText(text: string): string`, `escapePath(p: string): string`, `recordSharedWebglContextLoss(now?: number): boolean`, `WEBGL_REATTACH_DELAY_MS`. Signatures stay as in Parallel Code.
- Produces: `class InputBatcher { constructor(opts: { intervalMs: number; maxChars?: number; send: (data: string) => void }); push(data: string): void; flush(): void; dispose(): void }`. `maxChars` defaults to 2048. Batching is trailing, as in Parallel Code, so that `THESOURCE_INPUT_BATCH_MS=8` reproduces its behaviour for comparison; 0 sends at once.
- Produces: `class OutputFlow { constructor(opts: { write: (data: Uint8Array, done: () => void) => void; pause: () => void; resume: () => void; schedule: (flush: () => void) => () => void; highWater?: number; lowWater?: number; flushAt?: number }); push(chunk: Uint8Array): void; whenDrained(cb: () => void): void }`. Defaults: 256 KiB, 32 KiB, 64 KiB. `schedule` returns a cancel function; the default in TerminalView is the earlier of `requestAnimationFrame` and a 50 ms timer.

- [ ] **Step 1: Write the failing tests for the new modules (ported tests come with their modules in Step 3)**

```ts
// src/renderer/src/terminal/keybindings.test.ts
import { it, expect } from 'vitest';
import { matchTerminalBinding, swallowsKeyEvent, type KeyLike } from './keybindings';

const key = (k: Partial<KeyLike>): KeyLike =>
  ({ type: 'keydown', key: '', metaKey: false, shiftKey: false, altKey: false, ctrlKey: false, ...k });

it.each([
  [{ key: 'Enter', shiftKey: true }, '\x1b\r'],
  [{ key: 'ArrowLeft', metaKey: true }, '\x1b[H'],
  [{ key: 'ArrowRight', metaKey: true }, '\x1b[F'],
  [{ key: 'Backspace', metaKey: true }, '\x15'],
])('%o sends %j', (k, send) => {
  expect(matchTerminalBinding(key(k))).toEqual({ send });
});

it.each([
  ['ArrowUp', 'line-up'], ['ArrowDown', 'line-down'], ['PageUp', 'page-up'], ['PageDown', 'page-down'],
] as const)('Cmd+Shift+%s scrolls %s', (k, scroll) => {
  expect(matchTerminalBinding(key({ key: k, metaKey: true, shiftKey: true }))).toEqual({ scroll });
});

it.each([
  { key: '@', altKey: true }, { key: '[', altKey: true }, { key: ']', altKey: true }, { key: '{', altKey: true, shiftKey: true },
  { key: '|', altKey: true }, { key: '\\', altKey: true, shiftKey: true }, { key: 'Dead', altKey: true },
  { key: 'ArrowLeft', altKey: true }, { key: 'Backspace', altKey: true }, { key: 'Enter' },
  { key: 'c', metaKey: true }, { key: 'v', metaKey: true }, { key: 'Enter', shiftKey: true, type: 'keyup' },
])('leaves %o to xterm and the menu', (k) => {
  expect(matchTerminalBinding(key(k))).toBeUndefined();
});

it('swallows the keypress and keyup of Shift+Enter, and nothing else', () => {
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true, type: 'keypress' }))).toBe(true);
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true, type: 'keyup' }))).toBe(true);
  expect(swallowsKeyEvent(key({ key: 'Enter', shiftKey: true }))).toBe(false);
  expect(swallowsKeyEvent(key({ key: 'Enter', type: 'keypress' }))).toBe(false);
  expect(swallowsKeyEvent(key({ key: '@', altKey: true, type: 'keypress' }))).toBe(false);
});
```

```ts
// src/renderer/src/terminal/terminalOptions.test.ts
import { it, expect } from 'vitest';
import { TERMINAL_OPTIONS } from './terminalOptions';

it("matches the owner's iTerm2 profile and leaves Option to the Swedish layout", () => {
  expect(TERMINAL_OPTIONS).toMatchObject({
    fontFamily: 'Monaco, Menlo, monospace', fontSize: 13, lineHeight: 1.05, cursorBlink: false,
    macOptionIsMeta: false, macOptionClickForcesSelection: true, scrollback: 10_000, scrollSensitivity: 2,
  });
});
```

```ts
// src/renderer/src/terminal/inputBatcher.test.ts
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { InputBatcher } from './inputBatcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('with interval 0 sends each keystroke at once', () => {
  const sent: string[] = [];
  const b = new InputBatcher({ intervalMs: 0, send: (d) => sent.push(d) });
  b.push('a'); b.push('b');
  expect(sent).toEqual(['a', 'b']);
});

it('with interval 8 sends what arrived within 8 ms together, or at 2048 chars', () => {
  const sent: string[] = [];
  const b = new InputBatcher({ intervalMs: 8, send: (d) => sent.push(d) });
  b.push('a'); b.push('b');
  expect(sent).toEqual([]);
  vi.advanceTimersByTime(8);
  expect(sent).toEqual(['ab']);
  b.push('x'.repeat(2048));
  expect(sent).toHaveLength(2);
});
```

```ts
// src/renderer/src/terminal/outputFlow.test.ts
import { it, expect } from 'vitest';
import { OutputFlow } from './outputFlow';

function setup() {
  const log: string[] = [];
  const pending: Array<() => void> = [];
  let scheduled: (() => void) | undefined;
  const flow = new OutputFlow({
    write: (d, done) => { log.push(`write:${d.length}`); pending.push(done); },
    pause: () => log.push('pause'),
    resume: () => log.push('resume'),
    schedule: (f) => { scheduled = f; return () => { scheduled = undefined; }; },
  });
  const runFrame = () => { const f = scheduled; scheduled = undefined; f?.(); };
  const finishWrites = () => { while (pending.length) pending.shift()!(); };
  return { flow, log, runFrame, finishWrites };
}
const bytes = (n: number) => new Uint8Array(n);

it('writes queued chunks as one payload on the next frame', () => {
  const { flow, log, runFrame } = setup();
  flow.push(bytes(10)); flow.push(bytes(20));
  expect(log).toEqual([]);
  runFrame();
  expect(log).toEqual(['write:30']);
});

it('writes at once when 64 KiB are queued', () => {
  const { flow, log } = setup();
  flow.push(bytes(64 * 1024));
  expect(log).toEqual(['write:65536']);
});

it('pauses the PTY once above 256 KiB unwritten and resumes once below 32 KiB', () => {
  const { flow, log, runFrame, finishWrites } = setup();
  for (let i = 0; i < 5; i++) flow.push(bytes(64 * 1024));
  expect(log.filter((l) => l === 'pause')).toEqual(['pause']);
  finishWrites(); runFrame(); finishWrites();
  expect(log.filter((l) => l === 'resume')).toEqual(['resume']);
  expect(log.at(-1)).toBe('resume');
});

it('whenDrained runs after the last write has finished, or at once when idle', () => {
  const { flow, runFrame, finishWrites } = setup();
  let drained = 0;
  flow.whenDrained(() => drained++);
  expect(drained).toBe(1);
  flow.push(bytes(10));
  flow.whenDrained(() => drained++);
  runFrame();
  expect(drained).toBe(1);
  finishWrites();
  expect(drained).toBe(2);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> test -- src/renderer`
Expected: FAIL, modules not found.

- [ ] **Step 3: Install xterm, port the four Parallel Code modules with their tests, implement the four new ones**

Run: `npm --prefix <root> install @xterm/xterm@6.1.0-beta.195 @xterm/addon-webgl@0.20.0-beta.194 @xterm/addon-fit@0.12.0-beta.195` and `npm --prefix <root> install -D @xterm/headless@6.1.0-beta.195`. The ported `terminalClipboard.test.ts` drives the real xterm parser through `@xterm/headless`. All four ported tests run in Vitest's default `node` environment, as they do in Parallel Code (its `vitest.config.ts` sets `environment: 'node'`); none touches the DOM. `OutputFlow` follows `TerminalView.tsx` lines 918–1037 at 97c3558 (`enqueueOutput`, `flushOutputQueue`, `scheduleOutputFlush`). Its watermark counts bytes pushed and not yet acknowledged by `write`'s `done`. Only one write is in flight at a time.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm --prefix <root> test -- src/renderer` then `npm --prefix <root> run typecheck`
Expected: all pass, ported tests included; no type errors.

- [ ] **Step 5: Commit**

```bash
git -C <root> add package.json package-lock.json src/renderer/src/terminal
git -C <root> commit -m "feat: terminal key bindings, clipboard, flow control and WebGL helpers"
```

---

### Task 7: Terminal view and the session shell

**REQUIRED:** invoke `frontend-design:frontend-design` before writing `App.tsx` and `app.css`. Direction: the dark palette of the brainstorm mockup `.superpowers/brainstorm/88844-1793797486/content/app-layout.html` (backgrounds `#101217` rail, `#16181d` app, `#121418` terminal, accent `#4aa3ff`, needs-you amber `#f0a030`), which follows the Parallel Code look the owner likes. This shell is temporary; plan 2 replaces the list with the board. So spend the design effort on the terminal pane, and keep the list plain.

**Files:**
- Create: `src/renderer/src/terminal/TerminalView.tsx`, `src/renderer/src/terminal/registry.ts`, `src/renderer/src/ptyEvents.ts`, `src/renderer/src/sessionsStore.ts`, `src/renderer/src/app.css`, `src/main/menu.ts`
- Modify: `src/renderer/src/App.tsx`, `src/main/index.ts` (set the menu)
- Test: `e2e/terminal.e2e.ts`

**Interfaces:**
- Consumes: the bridge (Task 5) and every Task 6 module.
- Produces: `subscribePty(sessionId: string, handlers: { data(d: Uint8Array): void; exit(e: PtyExitEvent): void }): () => void` in `ptyEvents.ts`. It installs one bridge listener per event type and dispatches by id.
- Produces: the store in `sessionsStore.ts`: `sessions: Array<SessionInfo & { status: ProgramStatus | null; exited: boolean }>`, `selectedId: string | null`, `newSession(): Promise<void>` (creates and selects), `select(id)`, `close(id)` (kills when running, then removes).
- Produces: `registerTerminal(id, entry: { term: Terminal; fit: FitAddon })`, `unregisterTerminal(id)`, `redrawAllTerminals()` in `registry.ts`. Redraws are coalesced in a microtask and cover every terminal, because WebGL terminals share one glyph atlas (`<pc>/src/lib/terminalFitManager.ts` lines 195–213).
- Produces, only when `RendererConfig.e2e`: `window.__thesourceE2E = { sessionIds(): string[]; screenText(id: string): string }`, declared (as always present) in `src/renderer/src/env.d.ts` so the e2e files typecheck. `screenText` joins the active buffer's lines.
- Produces: test ids `new-session`, `session-row` (with `data-session-id` and `data-selected`), `session-status`, `close-session`.

TerminalView behaviour (from `<pc>/src/components/TerminalView.tsx`, keeping only what's listed here):
- `new Terminal(TERMINAL_OPTIONS)` plus `FitAddon`. Fit on mount and on container resize (ResizeObserver). Resizes go to `resize` at most every 33 ms and only when cols/rows changed.
- Subscribe with `subscribePty` before calling `spawn` with the fitted cols/rows, so no output is missed.
- Output goes through `OutputFlow` (pause/resume → bridge). Input from `term.onData` goes through `InputBatcher(config.inputBatchMs)` → `write`. After exit, input is ignored. The exit banner `\r\n\x1b[90m[Process exited]\x1b[0m\r\n` is written after `whenDrained`.
- `attachCustomKeyEventHandler`: return false when `swallowsKeyEvent(e)`. On a keydown that `matchTerminalBinding` matches, call `e.preventDefault()`, then for `{ send }` call `term.input(send, true)` and for `{ scroll }` call `scrollLines(±1)`/`scrollPages(±1)`, and return false. Return true for everything else.
- Clipboard: in a capture-phase `paste` listener on the container, `preventDefault()`, call `resolvePaste()`, then `term.paste(escapePath(path))` for file/image or `term.paste(text)`. `term.paste` adds bracketed-paste markers when Claude Code asked for them; without them Claude Code doesn't attach a pasted path as an image. In a capture-phase `copy` listener, put `cleanCopiedTerminalText(term.getSelection())` on the clipboard. `handleOsc52Writes` is gated by `trackRecentGesture` and writes with `navigator.clipboard.writeText`. Drop: capture-phase `dragover`/`drop` for Finder files, using `getPathForFile`, `escapePath`, joined with spaces, then `term.paste`.
- Visibility: every session's view stays mounted. Unselected ones get `visibility: hidden`, which keeps their size so the PTY is never resized. WebGL attaches when the view becomes selected and detaches 1000 ms after it stops being selected, releasing the context with `WEBGL_lose_context`. On context loss it reattaches after `WEBGL_REATTACH_DELAY_MS` while `recordSharedWebglContextLoss()` allows it (TerminalView.tsx lines 1197–1295). When a view comes back selected and still holds its context, call `redrawAllTerminals()`.
- `cursorBlink` stays false (Global Constraints); focus the terminal when its session is selected.

Menu (`src/main/menu.ts`): `appMenu`, `editMenu`, View (`Redraw Terminals` with `CmdOrCtrl+Shift+L` sending `IPC.redrawTerminals`, `toggleDevTools`, `togglefullscreen`), and `windowMenu`. No `fileMenu`, so Cmd+W is unbound; no reload, no zoom. The renderer calls `redrawAllTerminals()` on `onRedrawTerminals`.

Shell (`App.tsx`): a left column with `New session`, then one row per session showing its name, its status (`<state>` plus ` · <kind>` when set; `—` with no status; `exited` after exit) and a close button. On the right: a header with the session name and `cwd`, then the stacked terminal views.

- [ ] **Step 1: Write the failing e2e tests**

```ts
// e2e/terminal.e2e.ts
import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './launch';

const ids = (page: Page) => page.evaluate(() => window.__thesourceE2E.sessionIds());
const screen = (page: Page, id: string) => page.evaluate((i) => window.__thesourceE2E.screenText(i), id);
async function newSession(page: Page): Promise<string> {
  await page.getByTestId('new-session').click();
  const all = await ids(page);
  const id = all[all.length - 1];
  await expect.poll(() => screen(page, id)).toContain('$');
  return id;
}
async function run(page: Page, line: string) {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

test('typed input reaches the shell and its output shows', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'echo e2e-$((40+2))');
  await expect.poll(() => screen(page, a)).toContain('e2e-42');
  await app.close();
});

test('switching sessions keeps each one intact and shows only the selected one', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'echo first-$((0+1))');
  const b = await newSession(page);
  await run(page, 'echo second-$((1+1))');
  await page.locator(`[data-testid=session-row][data-session-id="${a}"]`).click();
  await expect(page.locator(`[data-testid=session-row][data-session-id="${a}"]`)).toHaveAttribute('data-selected', 'true');
  expect(await screen(page, a)).toContain('first-1');
  expect(await screen(page, a)).not.toContain('second-2');
  expect(await screen(page, b)).toContain('second-2');
  await app.close();
});

test('OSC 7501 status shows on the session row', async () => {
  const { app, page } = await launchApp();
  await newSession(page);
  await run(page, "printf '\\033]7501;state=blocked:kind=question\\033\\\\'");
  await expect(page.getByTestId('session-status').first()).toHaveText('blocked · question');
  await app.close();
});

test('a flood in a hidden session arrives in full', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'yes thesource | head -c 3000000; echo flood-$((2+3))');
  await newSession(page);
  await page.waitForTimeout(2000);
  await page.locator(`[data-testid=session-row][data-session-id="${a}"]`).click();
  await expect.poll(() => screen(page, a), { timeout: 30_000 }).toContain('flood-5');
  await app.close();
});

test('an exited session says so, and quitting leaves no session process behind', async () => {
  const { app, page } = await launchApp();
  const a = await newSession(page);
  await run(page, 'exit');
  await expect.poll(() => screen(page, a)).toContain('[Process exited]');
  const b = await newSession(page);
  await run(page, 'echo pid-$$');
  await expect.poll(() => screen(page, b)).toMatch(/pid-\d+/);
  const pid = Number((await screen(page, b)).match(/pid-(\d+)/)![1]);
  await app.close();
  await expect.poll(() => { try { process.kill(pid, 0); return 'alive'; } catch { return 'gone'; } }).toBe('gone');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix <root> run test:e2e -- terminal`
Expected: FAIL (`new-session` not found).

- [ ] **Step 3: Implement registry, ptyEvents, store, TerminalView, App, styles and menu as specified above**

- [ ] **Step 4: Run every test**

Run: `npm --prefix <root> test` then `npm --prefix <root> run test:e2e` then `npm --prefix <root> run typecheck`
Expected: all unit tests pass; all e2e tests pass (app, bridge, 5 terminal); no type errors.

- [ ] **Step 5: Try it with real `claude` once**

Run: `npm --prefix <root> run build` then `THESOURCE_PROJECT_DIR=<root> npm --prefix <root> start`. Click New session; `claude` starts in TheSource's own repo, not Damela. Type `/status`, then quit with Cmd+Q.
Expected: Claude Code's UI renders and `/status` lists the owner's user settings among its sources. (Leftover processes after quit are covered by the e2e quit test.)

- [ ] **Step 6: Commit**

```bash
git -C <root> add src e2e
git -C <root> commit -m "feat: terminal view and session shell for the feel test"
```

---

### Task 8: Feel test with the owner (gate)

**Files:**
- Create: `docs/feel-test.md`

This task needs the owner; the agent prepares, runs the app for them, and records what they decide. The sessions run in Damela's main checkout without worktrees, in Damela's `bypassPermissions` mode. So during the feel test give them only read-only prompts: no edits, commits or merges.

- [ ] **Step 1: Write `docs/feel-test.md`**

Each check row has columns for iTerm2 / TheSource / same–worse–better / note. Start with the setup: build once (`npm --prefix <root> run build`); then `npm --prefix <root> start` for variant A (input 0 ms, output 8 ms), `THESOURCE_INPUT_BATCH_MS=8 npm --prefix <root> start` for variant B (Parallel Code's batching), `THESOURCE_OUTPUT_BATCH_MS=0 npm --prefix <root> start` for variant C. iTerm2 sits next to it, both running `claude` in `<damela>`. The checks:
1. Typing: fast typing and key repeat in the prompt; does any variant feel delayed?
2. Shift+Enter inserts a newline; Enter submits.
3. Swedish Option characters: @ £ $ € | [ ] { } \ ≈, the dead keys ~ ^ ¨ ´ ` (e.g. Option+¨ then space), and å ä ö.
4. Option+←/→ moves by word, Option+⌫ deletes a word, Cmd+←/→ goes to line start/end, Cmd+⌫ deletes to line start.
5. Copy: drag-select and Cmd+C (no trailing padding); Option+drag while Claude Code captures the mouse.
6. Paste: Cmd+V of multi-line text (Claude shows `[Pasted text #1 …]`); a screenshot (Cmd+Ctrl+Shift+4, then Cmd+V → `[Image #1]`); two screenshots in one prompt; a file copied in Finder (its path); a file dragged from Finder.
7. Fullscreen mode (`/tui fullscreen`, back with `/tui default`): trackpad scrolling, PageUp/PageDown, selecting text copies it (OSC 52).
8. Normal mode scrolling: trackpad speed through long output, Cmd+Shift+↑/↓/PageUp/PageDown.
9. Rendering: colours, spinner, box drawing, a table with emoji (alignment), diffs, the status line, window resize, Cmd+Shift+L. If emoji widths misalign, the fix to try is `@xterm/addon-unicode11` with `term.unicode.activeVersion = '11'`.
10. Load: 7 sessions; 6 stream long read-only answers (e.g. "Read the five largest files under frontend/src and summarise each in detail") while the owner types in the 7th and switches between sessions. Compare CPU in Activity Monitor with iTerm2 running the same 7.
11. Status: does each row show `working`, then `idle`/`done`/`blocked · …`, as Claude works and stops?
12. Stray output: any escape-sequence garbage (for example from the owner's iTerm2 `cc-status` hook) appearing in the terminal?
13. Quit with sessions running (Cmd+Q): afterwards `pgrep -lf 'claude|mcp' | wc -l` in iTerm2 gives the same count as before the app was started. This also counts the MCP servers Claude Code starts, which no automated test checks.

End the file with: **Verdict** (Pass / Fail), **Batching chosen** (input ms, output ms), **Fixes made during the test** (list), and the date.

- [ ] **Step 2: Run the session with the owner**

Build, start variant A, and go through the checklist with the owner, recording their answers in the file. A problem with a clear fix (a missing binding, unicode widths, a batching default) can be fixed during the session: a test where one can pin it, the change, a re-run of `npm --prefix <root> test`, and a fresh build. The owner re-checks that row. The owner alone decides Pass or Fail.

- [ ] **Step 3: Apply the chosen batching defaults**

If the owner picked values other than input 0 / output 8, change the defaults in `src/main/config.ts` and its test to match, and run `npm --prefix <root> test -- src/main/config.test.ts`. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git -C <root> add docs/feel-test.md src package.json package-lock.json
git -C <root> commit -m "docs: feel test results"
```

- [ ] **Step 5: Gate**

**Fail** → stop here. Don't run Task 9 or write plan 2; rethink with the owner (spec §5: the native route on libghostty or SwiftTerm is the fallback). **Pass** → Task 9.

---

### Task 9: Early checks (spec §11.1–§11.7)

**Files:**
- Create: `docs/superpowers/findings/<YYYY-MM-DD>-step1-checks.md`, `spikes/mcp-wait/package.json`, `spikes/mcp-wait/server.mjs`, `spikes/mcp-wait/mcp.json`

For each check, record: the question, what was run, what was observed (exact messages, verbatim), the answer, and what it means for plan 2 (which launch form, which fallback). `<probe>` is an empty directory outside any repository, e.g. under the session scratchpad. Probes in `<damela>` only create and remove a probe worktree; nothing in this task pushes or merges anything in Damela. Checks marked *(app)* run in the app with `THESOURCE_SESSION_ARGV='["/bin/zsh","-l"]' THESOURCE_LOG_OSC=1 npm --prefix <root> start`; each app session is then a login shell where commands are typed, and OSC 7501 traffic is logged to the terminal that started the app. The owner does this task at the keyboard, because every check drives an interactive `claude` session. The agent writes the files, hands over the exact commands one check at a time, and records the results.

- [ ] **Step 1: Throwaway repo for the merge and resume checks**

Run, all with absolute paths: `git init --bare -b stage <probe>/origin.git`, `git clone <probe>/origin.git <probe>/repo`, `git -C <probe>/repo commit --allow-empty -m init`, `git -C <probe>/repo push -u origin stage`, `git -C <probe>/repo remote set-head origin stage`. Then start `claude` once in `<probe>/repo` *(app)*, accept the folder-trust dialog, and `/exit`.
Expected: `git -C <probe>/repo symbolic-ref refs/remotes/origin/HEAD` prints `refs/remotes/origin/stage`.

- [ ] **Step 2: §11.1 Does a `-w` session load Damela's `.claude/settings.local.json` (the review gate)?** *(app)*

In an app session, run `cd <damela>` and then `claude -w thesource-probe-gate -n thesource-probe-gate --debug-file <probe>/v1-debug.log`. In Claude: `/hooks` → PreToolUse → is the `Bash` entry running `code-review-gate.sh` listed, and from which source? Then ask: "Run `git status` and show the output." Then `grep -c code-review-gate <probe>/v1-debug.log`; if the debug log names no hook commands at all, rely on `/hooks` alone. `/exit`, and choose to remove the worktree (it is clean). Check `git -C <damela> worktree list` and `git -C <damela> branch --list 'worktree-thesource-probe*'`: neither lists the probe. (The worktrees doc says permission approvals made in a worktree are saved to the main checkout's `settings.local.json`, which suggests the answer is yes.)

- [ ] **Step 3: §11.2 Do `--settings` hooks run alongside user and project hooks, and do the owner's hooks behave outside iTerm2?** *(app)*

Write `<probe>/v2-settings.json` with hooks on `SessionStart`, `UserPromptSubmit`, `PreToolUse` (matcher `Bash`) and `Stop`. Each runs `jq -c '{e: .hook_event_name, cwd: .cwd}' >> <probe>/v2-hooks.log`. In `<damela>`: `claude --settings <probe>/v2-settings.json --debug-file <probe>/v2-debug.log`. In Claude: `/hooks` → note each event's sources (User: `cc-status`, GSD; Local: the gate; the `--settings` file). Ask "Run `git status`", then `/exit`.
Expected to record: `<probe>/v2-hooks.log` has `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` lines; hook errors found by `grep -iE "hook.*(error|fail)" <probe>/v2-debug.log`; and whether anything stray was printed to the terminal.

- [ ] **Step 4: §11.3 OSC 7501 in the app's terminal** *(app)*

Run `claude` in `<root>` (not Damela, so permission prompts appear) and make each of these happen in turn: startup, submit a prompt, a tool running, a permission prompt, "Ask me a multiple-choice question with your AskUserQuestion tool", the end of a reply, Esc while working, `/exit`. For each, copy the logged `[osc7501]` lines: was there a query, and which `state`, `kind`, `id`, `app` and `msg` came? Also record what the session row showed. This table is the input for plan 2's lane mapping (spec §7.3).

- [ ] **Step 5: §11.7 and §11.5 Can a `-w` session merge into the main checkout, and what happens to its worktree and transcript?** *(app)*

Run `cd <probe>/repo` and then `claude -w probe-merge -n probe-merge --session-id <uuid A>` (generate the uuid with `uuidgen | tr A-Z a-z`). Ask, one at a time, recording each result verbatim:
1. "Create probe.txt containing hello, then git add and git commit -m probe on this branch."
2. "Run exactly: `git -C <probe>/repo status`". Is it refused by the isolation check, and with what message?
3. "Do you have an ExitWorktree tool? If so, use it and keep the worktree."
4. "In `<probe>/repo`, run as separate commands: `git merge --squash worktree-probe-merge`, `git commit -m 'probe squash'`, `git worktree remove <probe>/repo/.claude/worktrees/probe-merge`, `git branch -D worktree-probe-merge`."
5. `/exit`. Was there a keep/remove prompt?
6. From `<probe>/repo`: `claude --resume <uuid A>`. Does the conversation load, and in which directory does it continue?

Then record `git -C <probe>/repo log --oneline -3`, `git -C <probe>/repo worktree list`, `git -C <probe>/repo branch`. Repeat the six steps for the fallback form: from `<probe>/repo` run `claude -n probe-enter --session-id <uuid B>` and first ask "Use EnterWorktree named probe-enter", with branch `worktree-probe-enter` in step 4. Record any difference between the two forms.

- [ ] **Step 6: §11.4 Where must `claude --resume <id>` run for a `-w` session?** *(app)*

From `<probe>/repo`: `claude -w probe-resume -n probe-resume --session-id <uuid C>`, "Say OK.", `/exit` choosing keep. Then resume three ways and record where each continues: (a) `claude --resume <uuid C>` from `<probe>/repo`; (b) the same from `~`; (c) after `git -C <probe>/repo worktree remove --force <probe>/repo/.claude/worktrees/probe-resume`, from `<probe>/repo` again. The docs expect "Your worktree … no longer exists" with the transcript intact.

- [ ] **Step 7: §11.6 MCP tool calls that wait**

Before writing the server, read the current MCP TypeScript SDK docs. The package split in v2 (`@modelcontextprotocol/server` 2.x) and v1 (`@modelcontextprotocol/sdk` 1.x) both exist on npm today; use the current recommended one. Install it in `spikes/mcp-wait/package.json`, not in the app's dependencies. `server.mjs` is a stdio MCP server with one tool, `wait_seconds({ seconds: number })`, which resolves after that many seconds with the text `waited <n>s`. `mcp.json`: `{ "mcpServers": { "wait": { "command": "node", "args": ["<root>/spikes/mcp-wait/server.mjs"] } } }`. In four app sessions in `<root>`, run `claude --mcp-config <root>/spikes/mcp-wait/mcp.json` and ask each to call `wait_seconds` with 30, 150, 330 and 630. Record for each: completed or timed out, the exact error, the time to the error, whether the terminal stayed usable, whether Esc cancels the call, and what OSC 7501 reported while waiting. Repeat the shortest failing duration with `MCP_TOOL_TIMEOUT` set above it and record whether it then completes.

- [ ] **Step 8: Write the findings file and commit**

The file has one section per check, §11.1–§11.7, in the format above, and ends with "Consequences for plan 2": the launch form (`-w` or `EnterWorktree`), the resume directory, the merge-turn mechanism (waiting MCP call or hook-delivered grant), and the OSC 7501 → lane mapping.

```bash
git -C <root> add docs/superpowers/findings spikes/mcp-wait
git -C <root> commit -m "docs: answers to the step 1 early checks"
```

---

## After this plan

Write plan 2 (the rest of build step 1: Trello TODO lane with card details and Start, Start next card, launches as in spec §7.2 adjusted by the findings, Needs you and Working lanes from hooks and OSC 7501, changed files, message field, Ctrl+Tab, Closed with Reopen, reopen after restart) from the spec plus `docs/feel-test.md` and the findings file.
