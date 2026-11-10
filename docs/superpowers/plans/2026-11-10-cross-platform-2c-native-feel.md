# Cross-platform plan 2c: Mainframe feels native on Windows and Linux

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows and Linux, Mainframe has the system's own title bar and no menu bar, Ctrl-based shortcuts modelled on Windows Terminal and VS Code, copy and paste and a right-click menu in its terminals, and terminals, file saves and task names that behave on Windows. The Mac does not change at all. The README covers all three systems, and CI is green on all three.

**Architecture:** The preload hands the page its system (`window.mainframe.platform`) synchronously. `<html data-platform>` scopes the Mac-only CSS, and every key and mouse rule takes the platform as a parameter, so its `'darwin'` branch is today's code. Windows and Linux get no application menu at all. Their keys live in the page: the board's capture-phase listener, and the terminal's custom key handler. The right-click menu comes from main's `context-menu` event, using Electron's copy and paste roles. Those fire the same DOM copy and paste events the Mac's Edit menu fires today.

**Tech Stack:** TypeScript 5.9, Electron 44, SolidJS, xterm 6.1 beta, node-pty 1.1.0, vitest 5, Playwright 1.64, Node 26 LTS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-09-mainframe-cross-platform-design.md`. This plan covers §6 (shortcuts), §7 (the window) and the rest of §8 (smaller fixes). It also covers §9's README lines, §10.4's checks, and the 2c items in the findings (`docs/superpowers/findings/2026-11-09-cross-platform-2a-ci.md`: `npm run dev` on a fresh clone, the README's Linux note, Ctrl+click links, the Windows quit crash). Mockup: `docs/superpowers/mockups/2026-11-09-cross-platform-setup.html`, screen 3. Plans 2a and 2b are done.

Already done by earlier plans, so not here: `WT_SESSION`/`WT_PROFILE_ID` dropped (`spawnEnv.ts`), thin scrollbars on lanes and cards, and the folder dialog's `title`.

## Global Constraints

- **Nothing changes on the Mac** (spec anti-goal, owner). Every Mac key, the Mac window, the Mac menu and Mac behaviour stay exactly as they are. A function that takes a platform returns today's value for `'darwin'`. Today's Mac unit tests stay, passing `'darwin'`, with their assertions unchanged.
- **Platform logic takes `platform: NodeJS.Platform` as a parameter** (spec §10.3). Components read `window.mainframe.platform` and pass it in. Tests cover `'win32'`, `'linux'` and `'darwin'` on every system.
- **AltGr never triggers a shortcut.** On Windows, AltGr arrives as Ctrl+Alt, so every Ctrl rule requires `!altKey` (spec §6).
- **Newest versions only; no dependency upgrades.** The package check of 2026-11-10 found no advisories. Playwright 1.65, marked 18.2 and vite 8.3.7 are out, and so are the majors Electron 45 and TypeScript 7. Each is the owner's separate decision.
- **Project-agnostic and several projects at once** (root `CLAUDE.md`). Every task review asks two questions. Does the change work for a friend's project in another language, with a `master` branch and none of the owner's plugins? Does it still work with two projects side by side?
- **No shell anywhere in the product**, as in 2a and 2b.
- **Test-only paths stay behind `MAINFRAME_E2E=1`.** The e2e hooks added here go in `installE2eHooks`.
- **UI work uses the `frontend-design` skill** (owner's global `CLAUDE.md`), within `app.css`'s tokens. This covers Task 1's CSS and Task 2's hint.
- **No e2e run on the owner's Mac while their Mainframe runs.** First run `pgrep -fl "Simmesolo/Mainframe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"` as its own command. Run e2e only if it prints nothing.
- **Mac-only e2e checks can't be pressed.** Playwright's keys reach the page and never the Mac's menu accelerators. A test of a Windows/Linux key skips on darwin, with that reason in its skip.
- **Dead code the change makes unreachable is removed** (listed per task). Dead code elsewhere is pointed out.
- **Commits:** `type: what it does`, with no attribution. Bash: absolute paths, `git -C <worktree>`, never `cd` chained with a command.
- **Pushes happen only in Task 7.** Each one first records the tip in both gate records, and adds a `Skip record:` line to this plan's ledger (spec §11). `/simplify` and `/code-review high` run once on the whole branch, after Task 7 ("After Task 7").

**Facts checked 2026-11-10** (re-check anything else against current docs):
- **Electron 44, sandboxed preload:** `process.platform` is readable.
- **Electron 44, `Menu.setApplicationMenu(null)`:** "On Windows and Linux, this has the additional effect of removing the menu bar from the window." No doc says what Alt does with no menu, so the owner's Windows check covers that.
- **Electron 44, window options:**
  - `titleBarStyle` defaults to `'default'`. `hiddenInset` is macOS-only.
  - No context menu appears by default.
  - The `context-menu` event's `params` carry `isEditable` and `editFlags.canCopy`/`canPaste`.
  - The menu roles `copy` and `paste` call `webContents.copy()`/`paste()` on the focused webContents.
  - `before-input-event`'s `input` has `type` (`keyDown`/`keyUp`), `key`, `control`, `shift`, `alt` and `meta`. `event.preventDefault()` keeps the key from the page.
- **Electron 44, drag regions in a framed window:** Electron's source (44-x-y) still consults `app-region: drag` in a framed window on Windows (`WinFrameView::NonClientHitTest`), but not on Linux. So the page's drag regions must be Mac-only.
- **xterm 6.1 (`node_modules/@xterm/xterm/src`):**
  - `windowsPty: { backend: 'conpty', buildNumber }` makes a resize add rows the way ConPTY reprints the screen. It also turns reflow on for build ≥ 21376.
  - Its right-click handler moves the hidden textarea under the pointer, focuses it, fills it with the selection and selects it (`Clipboard.ts` `rightClickHandler`).
  - Its own keys:
    - Shift+PgUp/PgDn scroll a page.
    - Home/End send the line-start/line-end sequences.
    - Ctrl+Backspace sends `^H`.
    - Alt+Backspace sends ESC DEL.
  - One wheel notch (`wheelDeltaY` 120) scrolls `50 px × scrollSensitivity`.
  - It notices a pixel-ratio change through `matchMedia('screen and (resolution: …dppx)')`.
- **Claude Code:** "To delete only the previous word, press `Option+Delete` on macOS or `Ctrl+Backspace` on Windows" (interactive-mode). "On Windows, Claude Code reads a Backspace that arrives as `^H` as Ctrl+Backspace … If Ctrl+Backspace erases only one character on macOS or Linux because your terminal sends `^H` for it, set the variable to 1" (terminal-config). Image paste is Alt+V on Windows.
- **Windows reserved names** (learn.microsoft.com, naming-a-file): CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9, plus superscript-digit variants. Slugs are `[a-z0-9-]` only, so superscripts and extensions can't occur.
- **Playwright:** `ControlOrMeta` is Meta on macOS, Control on Windows and Linux.
- **electron-vite 6:** `--noSandbox` exists on both `dev` and `preview`.

## Review Focus

1. **AltGr on Windows** (Ctrl+Alt, typing `@ { [ ] } \ |` on Nordic and German layouts) in a terminal and in the New task box: the character arrives, and no shortcut fires (no jump, no copy, no paste). Tests: Tasks 2 and 3.
2. **Ctrl+C with a selection left over in a terminal:** it copies once and clears the selection, so the very next Ctrl+C interrupts. Test: Task 3 (e2e).
3. **The board's keys on the setup screen,** before any project has started: Ctrl+Shift+O opens no dialog and raises no error. Test: Task 2 (e2e on Windows and Linux).
4. **A path with spaces** (`C:\Users\Anna Berg\Pictures\shot 1.png`) dropped or pasted into a Windows terminal: one double-quoted path, no backslash added. Several dropped files stay separate words. Test: Task 4.
5. **A data file another program holds** while Mainframe saves it (an antivirus or indexer on `state.json`, `projects.json` or `settings.json`): the save retries and succeeds. One held past the retries fails as it does today. Test: Task 5.

## Before Task 1

1. Create this plan's ledger, `.superpowers/sdd/2026-11-10-cross-platform-2c-native-feel/progress.md`.
2. Copy into it every `Skip record:` line from plan 2b's ledger (`.superpowers/sdd/2026-11-09-cross-platform-2b-setup-window/progress.md`), which already carries plan 1's and 2a's.
3. Baseline: `npm test` and `npm run typecheck` pass on the Mac (933 unit tests at `9dacaff`).

---

### Task 1: The window on Windows and Linux, and the page knows its system

**Files:**
- Create: `src/main/windowKeys.ts`, `src/main/windowKeys.test.ts`
- Modify:
  - `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`
  - `src/main/index.ts`, `src/main/menu.ts`
  - `src/renderer/src/app.css`, `src/renderer/src/App.tsx` (a comment only)
  - `e2e/app.e2e.ts`, `e2e/setup.e2e.ts`

**Interfaces:**
- Produces:
  - `MainframeApi.platform: NodeJS.Platform`. The preload sets it to `process.platform`, and it is read synchronously.
  - `main.tsx` sets `document.documentElement.dataset.platform = window.mainframe.platform` before `render`. CSS scopes Mac-only rules with `html[data-platform='darwin']`.
  - `isDevToolsKey(input: { type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }): boolean` in `windowKeys.ts`. Electron-free: a unit test must never import `electron`, since its first `require` downloads the binary. It is true only for keyDown Ctrl+Shift+I (key `I` or `i`) with neither Alt nor Meta.

- [ ] **Step 1: Write the failing tests.**
  - `windowKeys.test.ts`: Ctrl+Shift+I keyDown → true, with `key: 'I'` and `key: 'i'`. Each of these → false: its keyUp, Ctrl+I, Ctrl+Shift+Alt+I (AltGr), Meta+Shift+I, Ctrl+Shift+J.
  - `e2e/app.e2e.ts`, new test "the window follows its system: the Mac keeps its menu and the room for its window buttons; Windows and Linux have neither":
    - On darwin: `Menu.getApplicationMenu()?.getMenuItemById('open-project')` exists, and `.rail-titlebar`'s computed `padding-left` is `80px`.
    - Elsewhere: `Menu.getApplicationMenu()` is `null`, the window's `isMenuBarVisible()` is false, and that padding is `0px`.
    - On every system, `<html>`'s `data-platform` is `process.platform`.
    - Also assert `.topbar`'s computed `-webkit-app-region`: `drag` on darwin, `none` elsewhere. If Chromium's computed style doesn't expose that property, drop this assertion and say so in the report (the owner's Mac check covers dragging).
  - `e2e/setup.e2e.ts`: in the first-start test, `.setup-titlebar`'s height is 46 px on darwin and 8 px elsewhere.
- [ ] **Step 2: Run** `npx vitest run src/main/windowKeys.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** (use `frontend-design` for the CSS):
  - **`index.ts`:**
    - Pass `titleBarStyle: 'hiddenInset'` only on darwin.
    - In `launch`, before `createWindow`, call `Menu.setApplicationMenu(null)` when not on darwin. This gives no menu bar, no Ctrl+W that closes the window (and quits), no Ctrl+M and no Ctrl+R reload (spec §6, §7). Comment it.
    - Off the Mac, `win.webContents.on('before-input-event', …)` toggles DevTools for `isDevToolsKey(input)` and calls `preventDefault`. This answers spec §13's DevTools question: kept, as Ctrl+Shift+I, Chrome's and VS Code's key.
    - `start` sets `buildMenu(...)` only on darwin. `openPicked` stays, since IPC uses it.
  - **`menu.ts`:** the doc comment says this is the Mac's menu, and Windows and Linux have none.
  - **`app.css`:**
    - `.rail-titlebar` padding becomes `6px 0 4px`, plus `html[data-platform='darwin'] .rail-titlebar { padding-left: 80px; }`.
    - `.setup-titlebar` is 8 px high, and 46 px under the darwin scope.
    - The five `-webkit-app-region: drag` declarations come out of `.rail-titlebar`, `.setup-titlebar`, `.todo-tabs`, `.topbar` and `.p-title-bar, .manager-title-bar`. One rule replaces them: `html[data-platform='darwin'] :is(.rail-titlebar, .setup-titlebar, .todo-tabs, .topbar, .p-title-bar, .manager-title-bar) { -webkit-app-region: drag; }`, with a comment saying why. The `no-drag` rules stay as they are.
    - Update the comments at `app.css:95-97` and `:320-322`.
    - Font fallbacks (spec §8), after the Mac's own, so the Mac's order is unchanged:
      - `--font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
      - `--font-mono: 'JetBrains Mono', ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace`
  - **The two "Open Project…" tests in `app.e2e.ts`:** they click the menu item on darwin and the rail's `open-project` button elsewhere. Put that in one helper in the file. The dialog stub stays in the same `app.evaluate`.
  - **`App.tsx`:** its e2e comment says the application menu is the Mac's.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. After the pgrep check, run `npm run test:e2e`. Expected: all pass on the Mac, with one more e2e test than before.
- [ ] **Step 5: Commit:** `feat: on Windows and Linux the window has the system's title bar and no menu bar, and the project list starts at the edge`

### Task 2: The board's keys, the New task box and link clicks on each system

**Files:**
- Create: `src/renderer/src/keys.ts`, `src/renderer/src/keys.test.ts`
- Modify:
  - `src/renderer/src/board/shortcuts.ts`, `shortcuts.test.ts`
  - `src/renderer/src/App.tsx`, `src/renderer/src/board/NewTaskDialog.tsx`
  - `src/renderer/src/terminal/terminalLinks.ts`, `terminalLinks.test.ts`, `src/renderer/src/terminal/TerminalView.tsx` (the link click only)
  - `e2e/projects.e2e.ts`, `e2e/app.e2e.ts`, `e2e/links.e2e.ts`, `e2e/tasks.e2e.ts`, `e2e/setup.e2e.ts`

**Interfaces:**
- Consumes: Task 1's `window.mainframe.platform`.
- Produces:
  - `keys.ts`:
    - `commandHeld(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }, platform: NodeJS.Platform): boolean`. Darwin: `metaKey && !ctrlKey && !altKey`. Elsewhere: `ctrlKey && !metaKey && !altKey`.
    - `commandName(platform): 'Cmd' | 'Ctrl'`.
    - `linkClickHeld(e: { metaKey: boolean; ctrlKey: boolean }, platform): boolean`. Darwin: `metaKey`, as today. Elsewhere: `ctrlKey`.
  - `shortcuts.ts`:
    - `BoardActions` gains `openProject(): void`.
    - The signature becomes `installBoardShortcuts(target: Window, actions: BoardActions, platform: NodeJS.Platform): () => void`.
    - Darwin keeps exactly today's keys: Ctrl+Tab and Ctrl+Shift+Tab, Cmd+1–9 by `code`, Cmd+W by `key`.
    - Windows and Linux:
      - Ctrl+Tab and Ctrl+Shift+Tab, as on the Mac.
      - Ctrl+1–9 (`code` `Digit1`–`Digit9`, no Shift) → `focusProject`.
      - Ctrl+Shift+W (`key` compared case-insensitively) → `closePane`.
      - Ctrl+Shift+O → `openProject`.
    - None of these match with Alt held. A matched key is swallowed, and nothing happens while a modal dialog is open (both as today).
  - `createTerminalHttpLinkHandler({ openExternal, onOpenError, platform })`: the event type gains `ctrlKey`, and it opens only when `linkClickHeld`.

- [ ] **Step 1: Write the failing tests.**
  - **`keys.test.ts`:** each platform's command key, and AltGr (`ctrlKey` + `altKey`) false on `'win32'`. Meta is not the command key on `'linux'`.
  - **`shortcuts.test.ts`:**
    - Every existing test passes `'darwin'`, with its assertions unchanged. Add that Ctrl+1, Ctrl+Shift+W and Ctrl+Shift+O pass through untouched on darwin.
    - New tests, `it.each(['win32', 'linux'])`:
      - Ctrl+1–9 focus by place.
      - Ctrl+Shift+W closes the pane, with `key` `'W'` and with `key` `'w'`.
      - Ctrl+Shift+O opens a project.
      - Ctrl+Tab still jumps.
      - The modal dialog blocks all of them, `openProject` included.
      - These pass through untouched (not swallowed): Ctrl+W, Ctrl+O, Meta+1, Meta+w, Ctrl+Alt+2, Ctrl+Alt+7, Ctrl+Alt+0, Ctrl+Alt+Shift+W (Review Focus 1).
  - **`terminalLinks.test.ts`:** on `'win32'` and `'linux'` the link opens with `ctrlKey` and not with `metaKey`. On `'darwin'` it opens with `metaKey` and not with `ctrlKey`.
  - **e2e:**
    - **`projects.e2e.ts`:**
      - `'Meta+1'`/`'Meta+2'` become `'ControlOrMeta+1'`/`'+2'`.
      - `'Meta+w'` becomes a constant: `'Meta+w'` on darwin, else `'Control+Shift+W'`.
      - Test titles name both keys.
    - **`app.e2e.ts`:** new, skipped on darwin: "Ctrl+Shift+O opens Open Project… on Windows and Linux". With the dialog stubbed, the picked folder shows beside the open one.
    - **`links.e2e.ts`:** the `click` helper sets `metaKey` on darwin and `ctrlKey` elsewhere. Titles say "Cmd+click (Ctrl+click on Windows and Linux)".
    - **`tasks.e2e.ts`:** new test, "the New task box's hint names the system's key, and that key with Enter starts the task from the description". The hint reads `Cmd+Enter starts it` on darwin and `Ctrl+Enter starts it` elsewhere. Type a title, focus the description, press `ControlOrMeta+Enter`, and a task starts.
    - **`setup.e2e.ts`:** new, skipped on darwin (Review Focus 3). On a first start that is waiting for its project, Control+Shift+O makes no dialog call (the test's dialog stub counts none), and the setup screen stays.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/keys.test.ts src/renderer/src/board src/renderer/src/terminal/terminalLinks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `App.tsx` passes `window.mainframe.platform` and `openProject: () => { if (setupView() === null) void openProject(); }`. Main registers the project calls only once the setup is over.
  - `NewTaskDialog` uses `commandHeld` and shows `{commandName(platform)}+Enter starts it`.
  - `TerminalView`'s `keepLinkClickHere` and its handler use `linkClickHeld`.
  - Update the "Cmd" comments in these files to name both keys.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then e2e after the pgrep check. Expected: PASS on the Mac. The skipped tests run in Task 7's CI.
- [ ] **Step 5: Commit:** `feat: Ctrl-based board shortcuts, Ctrl+Enter and Ctrl+click on Windows and Linux; the Mac keeps Cmd`

### Task 3: Copy, paste, the right-click menu and the terminal's own keys on Windows and Linux

**Files:**
- Create: `src/main/contextMenu.ts`, `src/main/contextMenu.test.ts`
- Modify:
  - `src/renderer/src/terminal/keybindings.ts`, `keybindings.test.ts`, `src/renderer/src/terminal/TerminalView.tsx`
  - `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`
  - `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts` (one e2e hook)
  - `e2e/terminal.e2e.ts`, `e2e/board.e2e.ts`

**Interfaces:**
- Consumes: Task 1's platform.
- Produces:
  - `keybindings.ts`:
    - `TerminalAction` gains `{ clipboard: 'copy' | 'copy-and-clear' | 'paste' }`.
    - The signature becomes `matchTerminalBinding(e: KeyLike, platform: NodeJS.Platform, hasSelection: boolean): TerminalAction | undefined`.
    - Darwin: exactly today's table; it ignores `hasSelection`.
    - Windows and Linux (spec §6), never with Alt or Meta held; letters compared case-insensitively:
      - Shift+Enter → ESC CR.
      - Ctrl+Shift+C → `copy`, also with nothing selected: swallowed, and copies nothing.
      - Ctrl+C with a selection → `copy-and-clear`. Without one → undefined, so xterm sends ^C.
      - Ctrl+V and Ctrl+Shift+V → `paste`.
      - Ctrl+Shift+ArrowUp/ArrowDown → scroll a line.
      - On Linux only, Ctrl+Backspace → send `\x1b\x7f`. That is Option+Delete's ESC DEL, Claude Code's "previous word". On Windows it is left to xterm's `^H`, which Claude Code reads there as Ctrl+Backspace.
      - Home/End and Shift+PgUp/PgDn are left to xterm, which already does them.
  - IPC `clipboard:copy-text`, sent and not invoked: `MainframeApi.copyText(text: string): void`. Main runs `clipboard.writeText(text)`. Copy goes through main because `navigator.clipboard.writeText` rejects when the document isn't focused. `ClipboardDeps.clipboard` gains `writeText(text: string): void`.
  - `editMenuItems(params: { isEditable: boolean; editFlags: { canCopy: boolean } }): MenuItemConstructorOptions[] | null` in `contextMenu.ts`, with a type-only electron import. It returns null unless the target is editable. Otherwise: `[{ role: 'copy', enabled: canCopy }, { role: 'paste' }]`.
  - `index.ts`, off the Mac: `win.webContents.on('context-menu', (_e, params) => { const items = editMenuItems(params); if (items) Menu.buildFromTemplate(items).popup({ window: win }); })`.
    - In a terminal, xterm's right-click handler has already focused its textarea and filled it with the selection (Facts). The roles then fire the DOM copy and paste events that `TerminalView`'s capture listeners already handle for the Mac's Edit menu.
    - In the New task box and Todo notes they work natively.
    - The Mac gets nothing (spec §6).
  - The e2e hook `__mainframeE2E.select(taskId: string, column: number, row: number, length: number): void` calls `term.select`.

- [ ] **Step 1: Write the failing tests.**
  - **`keybindings.test.ts`:**
    - Today's cases pass `'darwin', false` and are otherwise unchanged. Add that on darwin, Ctrl+Shift+C, Ctrl+V and Ctrl+Backspace stay undefined.
    - New `it.each` over `'win32'` and `'linux'`:
      - Ctrl+Shift+C → `copy` with and without a selection.
      - Ctrl+C → `copy-and-clear` with a selection, undefined without.
      - Ctrl+V and Ctrl+Shift+V → `paste`.
      - The two scrolls.
      - Shift+Enter.
      - Untouched: Ctrl+Alt+C, Ctrl+Alt+V, Ctrl+Alt+2 (Review Focus 1), Meta+ArrowLeft, Meta+c, Home, End, Shift+PageUp, Ctrl+W, Ctrl+A.
    - Ctrl+Backspace sends `\x1b\x7f` on `'linux'` and is undefined on `'win32'`.
  - **`contextMenu.test.ts`:**
    - Not editable → null.
    - Editable → Copy enabled as `canCopy` says, with Paste after it.
  - **`e2e/terminal.e2e.ts`:** new, skipped on darwin: "on Windows and Linux, Ctrl+Shift+C and Ctrl+C copy the selection, Ctrl+C with none interrupts, and Ctrl+V and Ctrl+Shift+V paste".
    1. Print `copy-me-$((6*7))`.
    2. Select `copy-me-42` with the hook.
    3. `Control+Shift+C` → `app.evaluate(({ clipboard }) => clipboard.readText())` is `copy-me-42`.
    4. Write `x` to the clipboard.
    5. `Control+C` → the clipboard is `copy-me-42` again.
    6. Run `cat`, then `Control+C`: the shell comes back, and `echo after-$((6*7))` shows `after-42`. The selection was cleared, so this Ctrl+C interrupted (Review Focus 2).
    7. With `echo pasted-$((6*7))` on the clipboard, `Control+V` then Enter → `pasted-42`.
    8. The same with `Control+Shift+V` and `pasted-$((7*7))` → `pasted-49`.
  - **`e2e/board.e2e.ts`:** the scroll-back key is `'Meta+Shift+PageUp'` on darwin and `'Shift+PageUp'` elsewhere.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/terminal/keybindings.test.ts src/main/contextMenu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `TerminalView`, factor `onPaste`'s body into `pasteClipboard()`, which both the paste event and the key call.
  - `copySelection(clear: boolean)` sends `cleanCopiedTerminalText(term.getSelection())` through `api.copyText` when there is a selection, then clears it when asked.
  - Pass `term.hasSelection()` to `matchTerminalBinding`.
  - Comments: the Mac's copy and paste go through the Edit menu. Windows and Linux use the terminal's own keys and the right-click menu.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then e2e after the pgrep check. Expected: PASS on the Mac.
- [ ] **Step 5: Commit:** `feat: copy, paste and a right-click Copy/Paste menu in terminals on Windows and Linux, with Ctrl+C copying only a selection`

### Task 4: The terminal on Windows: ConPTY, the wheel, a change of scaling, and dropped paths

**Files:**
- Modify:
  - `src/shared/types.ts`, `src/main/index.ts`
  - `src/renderer/src/terminal/terminalOptions.ts`, `terminalOptions.test.ts`, `src/renderer/src/terminal/escapePath.ts`, `escapePath.test.ts`, `src/renderer/src/terminal/TerminalView.tsx`
  - `e2e/terminal.e2e.ts`

**Interfaces:**
- Consumes: Task 1's platform.
- Produces:
  - `RendererConfig.windowsBuild: number | null`. Main sets `Number(os.release().split('.')[2])` on win32 and `null` elsewhere.
  - `platformTerminalOptions(platform: NodeJS.Platform, windowsBuild: number | null): ITerminalOptions`, in `terminalOptions.ts`, spread after `TERMINAL_OPTIONS`.
    - `{}` on darwin and linux.
    - On win32, `{ windowsPty: { backend: 'conpty', buildNumber: windowsBuild ?? undefined }, scrollSensitivity: 1 }`. One wheel notch then scrolls 50 px, about three rows, as Windows Terminal does. The Mac's 2 stays. Linux keeps 2 too: the spec names only a Windows mouse.
  - `escapePath(p: string, platform: NodeJS.Platform): string`.
    - Darwin and linux: today's escaping.
    - Win32: `''` → `""`; a path with whitespace → `"p"`; else `p`. Never a backslash added. Windows names can't hold `"`.
  - Fit follows the pixel ratio:
    - `TerminalView`'s `fitted` also records `window.devicePixelRatio`, and `fitIfResized` fits when the ratio changed too.
    - The `ResizeObserver` observes `{ box: 'device-pixel-content-box' }`, so a change of scaling alone reaches it. xterm re-measures from its own media query, which reports before resize observers.

- [ ] **Step 1: Write the failing tests.**
  - **`terminalOptions.test.ts`:**
    - `platformTerminalOptions('darwin', null)` and `('linux', null)` are `{}`.
    - `('win32', 26100)` has `windowsPty: { backend: 'conpty', buildNumber: 26100 }` and `scrollSensitivity: 1`.
  - **`escapePath.test.ts`:**
    - Today's cases pass `'darwin'`, and the same run for `'linux'`.
    - On `'win32'`:
      - `C:\Users\anna\shot.png` stays as it is.
      - `C:\Users\Anna Berg\Pictures\shot 1.png` → `"C:\Users\Anna Berg\Pictures\shot 1.png"` (Review Focus 4).
      - `''` → `""`.
      - A path with `&`, `(` and `'` but no space stays as it is.
  - **`e2e/terminal.e2e.ts`:** new: "a terminal on screen fits again when the window's scaling changes".
    1. `page.context().newCDPSession(page)`, then `Emulation.setDeviceMetricsOverride({ width: 0, height: 0, deviceScaleFactor: f, mobile: false })`.
    2. `expect.poll(termSize).toEqual(await fitSize(...))`.
    3. Then `Emulation.clearDeviceMetricsOverride`.
    - Step 2 must show it failing before the change. If going from the screen's own ratio to `2` gives the same columns, use `1.25` or `1.5`. Record which.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/terminal`, then the new e2e test after `npm run build` and the pgrep check. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Callers pass `window.mainframe.platform` to `escapePath`, at drop and paste.
  - `TerminalView` builds `new Terminal({ ...TERMINAL_OPTIONS, ...platformTerminalOptions(platform, props.config.windowsBuild), linkHandler })`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`, then the e2e suite. Expected: PASS on the Mac.
- [ ] **Step 5: Commit:** `feat: Windows terminals know they run on ConPTY, scroll three rows a notch and take dropped paths in quotes; every terminal re-fits when the scaling changes`

### Task 5: Saving files, the paste folder, task names and a missing git

**Files:**
- Modify:
  - `src/main/tasks/taskStore.ts`, `taskStore.test.ts`
  - `src/main/clipboard.ts`, `clipboard.test.ts`, `src/main/index.ts`
  - `src/main/tasks/naming.ts`, `naming.test.ts`, `src/main/tasks/taskService.ts`, `taskService.test.ts`
  - `src/main/git.ts`, `git.test.ts`

**Interfaces:**
- Produces:
  - `renameWithRetry(from: string, to: string, rename = renameSync, wait = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)): void`, exported for tests and used by `writeJsonAtomic`. Every caller saves synchronously, so the wait blocks too.
    - A rename that fails with `EPERM`, `EACCES` or `EBUSY` is retried up to 10 times, 100 ms apart, then the last error is thrown. Any other error is thrown at once.
    - This runs on every system. A rename failing with these codes means another program holds the file, which happens on Windows. On the Mac it only means a second's wait before today's error.
  - `clearPasteFolder(dir: string, warn: (m: string) => void, rm = rmSync): void` in `clipboard.ts`.
    - It empties the folder and makes sure it exists.
    - A failed removal (a pasted image still open on Windows) warns, and the start goes on.
    - `index.ts`'s `start` calls it in place of its `rmSync`/`mkdirSync` pair.
  - `WINDOWS_RESERVED_NAMES` in `naming.ts`: `con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`. `TaskService.start` adds them to `taken` when `deps.platform === 'win32'`. So a task titled "Con" gets `con-2` there and `con` on the Mac, as today.
  - `branchExists` rejects when git can't be run at all: the `execFile` error's `code` is not a number, such as `ENOENT`. A non-zero exit is still `false`. `reopen` then rejects and the task stays as recorded: `restore` logs it, and Reopen shows the error. It no longer reopens in the main checkout (spec §8).

- [ ] **Step 1: Write the failing tests.**
  - **`renameWithRetry`** (Review Focus 5), with a `wait` spy:
    - EPERM twice, then success → three calls, no throw.
    - EBUSY every time → 11 calls, then throws EBUSY.
    - ENOENT → one call, then throws.
  - **`writeJsonAtomic`** still round-trips.
  - **`clearPasteFolder`:**
    - Old files are gone and the folder exists.
    - With a throwing `rm`, there is one warning and the folder exists.
  - **`taskService`:**
    - `'win32'`: titles `Con` and `LPT1` → slugs `con-2` and `lpt1-2`.
    - `'darwin'`: `Con` → `con`.
  - **`git.test.ts`:** with `vi.stubEnv('PATH', '')`, `branchExists` rejects. In a repo, a missing branch is still `false`.
  - **`taskService.test.ts`:** a reopen whose `git.branchExists` rejects also rejects. No session starts, and the record is unchanged.
- [ ] **Step 2: Run** `npx vitest run src/main/tasks src/main/clipboard.test.ts src/main/git.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix: saves retry while Windows holds the file, a busy paste folder doesn't stop the start, task folders avoid Windows' reserved names, and a missing git is no missing branch`

### Task 6: `npm run dev` on a fresh clone, and the README for all three systems

**Files:**
- Modify: `scripts/startArgs.mjs`, `scripts/startArgs.test.mjs`, `scripts/start.mjs`, `package.json` (`scripts` only), `README.md`, the spec's §4.3

**Interfaces:**
- Produces:
  - `startArgs(command: 'preview' | 'dev', platform, restriction, helper)` → `[command]` or `[command, '--noSandbox']`, under today's rule.
  - `start.mjs` takes the command from `process.argv[2]`. Anything else prints `usage: node scripts/start.mjs preview|dev` and exits 1.
  - `package.json`: `"start": "node scripts/start.mjs preview"`, `"dev": "node scripts/start.mjs dev"`. A fresh clone's `npm run dev` then downloads Electron first, as `npm start` does, and turns the sandbox off where Linux blocks it.

- [ ] **Step 1:** Update `startArgs.test.mjs`: each case runs for `'preview'` and `'dev'`. Run `npx vitest run scripts`. Expected: FAIL.
- [ ] **Step 2:** Implement, then run the test again. Expected: PASS.
- [ ] **Step 3: Commit:** `fix: npm run dev on a fresh clone downloads Electron first and handles Linux's sandbox block as npm start does`
- [ ] **Step 4: README.** Generic names only (`my-app`, `%USERPROFILE%`). It covers:
  - What you need, per system (spec §3's table, with "the newest Node.js LTS").
    - Windows: Git for Windows or any `git.exe` on PATH. Claude Code's native installer is found in `%USERPROFILE%\.local\bin` without PATH. An npm-installed Claude Code works only once its `claude.exe` exists, and otherwise the setup says to use the native installer. No compiler is needed.
    - Linux: the compiler line. The sandbox note says the `chrome-sandbox` file exists only after the first `npm start`, which downloads Electron.
  - Run it: the same four commands on every system.
  - Opening projects:
    - Mac: File → Open Project… (⌘O).
    - Windows and Linux: the **Open project** button or Ctrl+Shift+O.
  - Keys: spec §6's table.
  - The data folder's default per system, from Electron's `userData`: `~/Library/Application Support/mainframe`, `%APPDATA%\mainframe`, `~/.config/mainframe`.
  - Setting a variable: `VAR=value npm start` in bash and zsh, `$env:VAR = 'value'; npm start` in PowerShell.
  - Windows long paths: `git config --global core.longpaths true`.
  - Develop:
    - DevTools: the Mac's View menu; Ctrl+Shift+I on Windows and Linux.
    - The Git for Windows line for e2e stays.
    - The `npm run dev -- --noSandbox` line goes, since dev handles that now.
- [ ] **Step 5: Spec fix.** §4.3 also names the claude behind a `claude.cmd` in any npm prefix on PATH (plan 2b's ruling R14).
- [ ] **Step 6: Commit** (Markdown only): `docs: the README for macOS, Windows and Linux, and spec §4.3 names every npm prefix`

### Task 7: CI on all three systems, and the Windows quit crash

**Files:**
- Modify: whatever the runs show is wrong, fixed by its cause.
- Modify: `docs/superpowers/findings/2026-11-09-cross-platform-2a-ci.md` (a 2c section, and the 2b section's corrections).

- [ ] **Step 1:** Run `npm test` and `npm run typecheck`.
- [ ] **Step 2: Record the tip in both gate records.** Run `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform rev-parse HEAD | tee -a /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified >> /Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-reviewed`. Then append `Skip record: <sha> (2c CI push N: …; remove from both records before the final /simplify run)` to this plan's ledger.
- [ ] **Step 3: Push**, as its own command: `git -C /Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/cross-platform push origin cross-platform`.
- [ ] **Step 4: Read the run and fix by cause.**
  - Read it with `gh run list --branch cross-platform --workflow Tests --limit 1`, then `gh run view <id> --json jobs` and `--log-failed`.
  - Fix by cause (systematic-debugging, TDD), and repeat from Step 1.
  - Expected: green on all three, with this plan's skipped-on-darwin tests running on Windows and Linux.
  - A Windows or Linux test that can't behave as on the Mac says why in a comment (spec §10.2).
  - Temporary diagnostics come out before the last push.
- [ ] **Step 5: The quit crash** (2b findings: Electron exits `0xC0000409` at some Windows quits; the first suspect is the ptys' kill at quit). Spend at most three pushes on it, within the cap below, using systematic-debugging.
  - Add one temporary Windows step. It repeats a quit with no session and a quit with a task's session, and logs `app.process().exitCode` for each.
  - **The crash comes only with live sessions, and Mainframe's quit is the cause:** fix it on Windows only, with a regression test, and record a ledger ruling. Mac and Linux quits stay as they are.
  - **It points at Electron or node-pty:** record that in the findings for the owner's Windows PC check, and stop.
- [ ] **Push cap:** 9 pushes, the Step 5 ones included. Past that, stop and report what is still red.
- [ ] **Step 6: Findings** (Markdown, its own commit).
  - A "2c" section with a row per run (link, commit, what it carried, the result on each system), what failed and why, and what each fix was.
  - The 2b section says it was pushed nine times and gets run 9's row (`42712677180`, the `shortcuts.e2e.ts:49` Tab-completion flake on Windows).
  - Update the list for the owner's Windows PC:
    - copy and paste, and the right-click menu, with a real Claude Code;
    - Ctrl+Backspace deletes a word;
    - a wheel notch scrolls about three rows;
    - Alt doesn't move the focus anywhere;
    - a dropped path with spaces is attached by Claude Code;
    - the earlier items.

## After Task 7: finishing the branch (root `CLAUDE.md`)

1. Remove every `Skip record:` sha in this ledger (plans 1, 2a, 2b and 2c) from both `/Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-reviewed` and `/Users/simonekholm/Developer/Simmesolo/Mainframe/.git/claude-simplified`. Check that none is left.
2. `/simplify`: Skill tool, skill `simplify`, args `main...HEAD`.
   - Check its edits: undo any that change behaviour or reach outside the branch's lines.
   - Run the unit tests, the typecheck and the e2e suite (after the pgrep check), then commit.
   - Record the tip in `claude-simplified`.
3. The final whole-branch review (subagent-driven-development's final reviewer) over `main...HEAD`, and its fixes.
4. `/code-review`: Skill tool, skill `code-review`, args `high main...HEAD`.
   - Fix its findings and run the three suites, then commit.
   - Record the tip in both files.
   - Push once more to see CI green on the code that will merge. That tip is now really reviewed, so it gets no skip record.
5. The owner's acceptance.
   - **On the Mac** (spec §10.4): nothing changed. Check the shortcuts, the window (dragging it by the top rows, the window buttons), copy and paste, sessions, and quit and restore.
   - **On Windows:** the list in the findings, for the owner's Windows PC or a friend.
   - **On Linux:** a friend's first try.
6. `superpowers:finishing-a-development-branch`'s merge/PR menu (plan 2b's ruling R17 deferred it to here). Plan 2b's ledger can go once the branch has merged.
