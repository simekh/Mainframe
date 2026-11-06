# Plan 2a acceptance fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the owner found in the first plan 2a acceptance run. That covers one panel glitch, removing the message field, Reopen carrying on a session it interrupted, clickable links, iTerm2-like colours and a ring for Claude Code suggestions. Then finish acceptance with the owner.

**Architecture:**
- **Main process:** changes go where the behaviour lives. Reopen's prompt lives in `TaskService` and `launch.ts`, opening links in an IPC handler with `shell.openExternal`, and `FORCE_HYPERLINK` in `spawnEnv.ts`.
- **Renderer:** the terminal gets the official web-links addon and a small output styler on its write path (bold and link colours). The board gets a suggestion detector that reads only the bottom rows of each terminal.

**Tech Stack:** Electron 44, electron-vite 6, SolidJS 1.9, TypeScript 5.9, xterm.js 6.1 beta, node-pty 1.1, Vitest, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-04-mainframe-agent-manager-design.md`, mainly the notes dated 2026-11-06 in §2, §7.1 and §7.4. The owner's findings are recorded in `.superpowers/sdd/2026-11-05-mainframe-sessions-board/progress.md` (lines starting `Task 10:`).

## Global Constraints

- Stack as in plan 2a. **One new dependency:** `@xterm/addon-web-links` pinned to exactly `0.13.0-beta.195`, the beta that matches the pinned `@xterm/xterm` `6.1.0-beta.195`. It is Parallel Code's choice, and it is needed for the owner's clickable links.
- **Colours** come from the owner's iTerm2 profile (Night Owl): bold `#addb67`, links `#82aaff`. The suggestion ring is a light white that is not Claude orange; that colour belongs to the Needs input tone.
- **The resume prompt** is exactly `Continue where you left off.` A session that was asking the owner something (blocked) gets `The session stopped while you were waiting for my answer. Ask me again.` instead (owner, 2026-11-06, during acceptance).
- **Lanes still come from OSC 7501 alone.** Screen reading is allowed only for the suggestion ring (spec §2, owner's exception of 2026-11-06).
- **Attribution:** code adapted from Parallel Code (MIT, commit 97c3558, clone at `/private/tmp/claude-501/-Users-simonekholm-Developer-Simmesolo-Mainframe/ab5b0969-4ca5-497a-ab02-feba94e1f449/scratchpad/parallel-code`) gets the first-line header `// Adapted from Parallel Code (MIT): <path> (fn) at 97c3558. See THIRD_PARTY_NOTICES.md.` and a `Mainframe path ← Parallel Code path` line in `THIRD_PARTY_NOTICES.md`.
- **Commits:** conventional prefixes. No `Co-Authored-By`, and no mention of Claude, Anthropic or AI as author.
- **UI tasks** (1, 2, 6) invoke `frontend-design:frontend-design` before changing markup or CSS. The approved look is `src/renderer/src/app.css` and `docs/superpowers/mockups/2026-11-05-plan-2a-board.html`; Parallel Code is the reference the owner likes.
- **e2e windows** open on the owner's screen. Tests must not depend on the real mouse staying still.

## Review Focus

1. **The output styler damages terminal output.** Escape sequences split across chunks, colon sub-parameters (`38:2::r:g:b`), 256-colour and truecolour foregrounds, `SGR 0/22/39`, and the alternate screen must all pass through untouched. Claude Code should look exactly as before except for the bold and link colours. (Task 5)
2. **A click opens the wrong thing.** A link click must open only `http:`/`https:` pages, and only with Cmd held. A plain click still selects and focuses. (Task 4)
3. **`Continue where you left off.` goes to the wrong sessions.** It must not go to a session that was waiting for the owner. It must still go after an app quit that interrupted a turn. (Task 3)
4. **The suggestion ring misbehaves.** It must not stick after the suggestion is answered or dismissed. It must not light for scrolled-back history or for Claude quoting the words "You should know". (Task 6)
5. **Removing the message field leaves dead code or CSS, or a gap under the terminal.** `termSize` must still match `stty size`. (Task 2)

---

### Task 1: The panel shown with ‹ doesn't blink or slide in from the left

The owner's finding: hide the unpinned panel, then click `panel-show`. The panel's content blinks and slides in from the left. This doesn't happen when a card click opens the panel.

**Files:**
- Modify: `src/renderer/src/panel/SidePanel.tsx` and, if the cause lies there, `src/renderer/src/app.css`.
- Test: `e2e/panel.e2e.ts`.

- [ ] **Step 1: Find the root cause** (superpowers:systematic-debugging) before changing code.
  - The leading hypothesis: `hideButton.focus()` at `SidePanel.tsx:90` runs while the panel is still `translateX`-ed off screen. The browser then scrolls an ancestor sideways to reveal the focused pill. The card path moves no focus.
  - Confirm it, or refute it, by measuring the `scrollLeft` of the panel's ancestors during the slide.
- [ ] **Step 2: Write the failing e2e** `showing the hidden panel with its button moves nothing sideways`.
  - Unpin, then hide with `panel-hide`.
  - Click `panel-show` while one `page.evaluate` samples, on every animation frame until the slide ends, the `scrollLeft` of `side-panel` and each of its ancestors, plus `document.scrollingElement`.
  - Every sample is 0. `panel-hide` ends up focused, and `termSize` is unchanged.
- [ ] **Step 3: Fix the root cause.** For example, `focus({ preventScroll: true })` for both focus moves at `SidePanel.tsx:86` and `:90`. Keep the focus hand-off itself (plan 2a Task 7).
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e -- panel`. Expected: all pass.
- [ ] **Step 5: Commit** `fix: the panel shown with its button no longer jumps sideways`.

### Task 2: Remove the message field

Spec §7.1 (owner, 2026-11-06): the terminal already takes messages.

**Files:**
- Delete: `src/renderer/src/panel/MessageField.tsx`, `src/renderer/src/terminal/sendMessage.ts` and `sendMessage.test.ts`.
- Modify:
  - `src/renderer/src/panel/SessionPanel.tsx`;
  - `src/renderer/src/app.css`, for the message box rules;
  - `src/renderer/src/tasksStore.ts`, for whatever exists only for the field, such as drafts and the sending guard;
  - `THIRD_PARTY_NOTICES.md`, for the `sendMessage.ts` line;
  - `e2e/session-panel.e2e.ts`;
  - anything else `grep -rn "MessageField\|sendMessage\|message-field\|message-send"` finds.

- [ ] **Step 1: Write the failing e2e** `the terminal runs to the bottom of the panel, with no message box`.
  - `message-field` has count 0.
  - The terminal well's bottom edge is within 16 px of `side-panel`'s bottom edge.
  - `termSize` equals `stty size`.
- [ ] **Step 2: Delete the field and everything that exists only for it.** That includes the e2e tests of the field (`the message field sends one line as typed`, `several lines arrive as one bracketed paste, then Enter`, the send-guard and blocked-field tests) and any helpers only they use.
  - Keep the e2e hooks that other tests use (`screenText`, `termSize`).
  - If you can't tell whether something exists only for the field, say so in the report rather than guessing.
- [ ] **Step 3:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass, and `grep` finds no leftover reference.
- [ ] **Step 4: Commit** `feat: drop the message field; the terminal takes messages itself`.

### Task 3: Reopen carries on a session that was interrupted mid-turn

Spec §7.4 (owner, 2026-11-06).

**Files:**
- Modify:
  - `src/main/tasks/launch.ts` (+ test);
  - `src/main/tasks/taskService.ts` (+ test);
  - `src/main/tasks/taskStore.ts` (+ test);
  - `src/main/ipc.ts` or `src/main/index.ts`, wherever session status reaches main code.
- Test: `e2e/tasks.e2e.ts`.

**Interfaces:**
- `reopenArgv` gains an optional `prompt?: string`. When given, it is the last argv element. It is used only when the session resumes, not for the start form of plan 2a's final-review F1.
- `TaskRecord` gains an optional `midTurn?: boolean`, which loads as `false` when it is missing.
- `TaskService` learns each live session's last OSC 7501 state from the existing status stream, for example `noteStatus(sessionId, state | null)`.
- Whenever a task's session ends, `midTurn` is set to `true` if the last state was `working` or `blocked`, and to `false` otherwise. A session can end through Close session, app quit or the process exiting on its own.
  - Record it before the kill and before the exit handling clears the state. Plan 2a's F5 made `onExit` arrive before the trailing null status.
- `reopen` of a task that has a recorded session:
  - with `midTurn`, it resumes with `prompt: 'Continue where you left off.'` and `startedWithPrompt: true`, so the card stays in Working instead of flashing through Needs you;
  - in both cases it clears `midTurn` and commits.

- [ ] **Step 1: Write the failing tests.**
  - Unit:
    - `reopenArgv` puts the prompt last.
    - Closing a working or blocked session sets `midTurn`, and closing an idle, done or error one doesn't.
    - Quitting with a working session sets it, and `restore()` then resumes with the prompt.
    - A reopen without `midTurn` has no prompt.
    - The flag clears after a reopen.
    - The store loads a record without `midTurn`, and rejects a non-boolean one.
  - e2e `a session closed mid-turn carries on when reopened; one that was waiting doesn't`:
    - Make task A `working` and task B `idle` with `printf` OSC 7501.
    - Close both, then Reopen both.
    - A's launch args end with `Continue where you left off.`, and B's don't.
    - Then quit with A working, relaunch on the same data dir, and assert that A's restore launch also ends with the prompt.
- [ ] **Step 2: Run the tests to see them fail.** Run `npm --prefix <root> test -- src/main/tasks` then `… run test:e2e -- tasks`.
- [ ] **Step 3: Implement.** Keep `--settings` on the resume; the sessions docs say it isn't restored by itself. Leave the form of plan 2a F1 (no `session-start.json` → start form) unchanged.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Reopen carries on a session that was interrupted mid-turn`.

### Task 4: Links in the terminal open with Cmd+click

Spec §7.1 (owner, 2026-11-06). Claude Code emits OSC 8 links when `FORCE_HYPERLINK=1` (env-vars docs, 2026-11-06). Plain-text URLs are found by the web-links addon.

**Files:**
- Create: `src/renderer/src/terminal/terminalLinks.ts` (+ test), adapted from Parallel Code's `src/lib/terminalLinks.ts` (`normalizeHttpUrl`, `createTerminalHttpLinkHandler`).
- Modify:
  - `package.json` and the lockfile;
  - `src/renderer/src/terminal/TerminalView.tsx`;
  - `src/shared/ipc.ts`, `src/preload/index.ts` and `src/main/ipc.ts`;
  - `src/main/pty/spawnEnv.ts` (+ test);
  - `THIRD_PARTY_NOTICES.md`.
- Test: `e2e/terminal.e2e.ts`, or a new `e2e/links.e2e.ts`.

**Interfaces:**
- **Bridge:** `openLink(url: string): Promise<void>` on channel `shell:open-link`.
  - Main checks the URL again with `new URL`: only `http:` and `https:` pass, and anything else is dropped with a warning. A passing URL goes to `shell.openExternal`.
  - In e2e mode, main records the URL and doesn't open it. Expose the recorded URLs to tests through the existing e2e hook style.
- **Renderer:**
  - Load `WebLinksAddon` with a handler that needs Cmd on macOS (Parallel Code's `requireModifier: true`).
  - Set xterm's `linkHandler` option for OSC 8 links with the same handler, with `allowNonHttpProtocols: false`.
  - A plain click does what it did before.
- **`buildSpawnEnv`:** sets `FORCE_HYPERLINK` to `'1'` unless the owner's environment already sets it.

- [ ] **Step 1: Write the failing tests.**
  - Unit:
    - `normalizeHttpUrl` passes `https://a.b/c` and drops `javascript:alert(1)`, `file:///etc/passwd` and garbage.
    - The handler opens a link with Cmd held and ignores a plain click.
    - `buildSpawnEnv` sets `FORCE_HYPERLINK=1` and keeps an inherited `FORCE_HYPERLINK=0`.
  - e2e `Cmd+click opens a link from the terminal; a plain click doesn't`:
    - `printf` a plain URL and an OSC 8 link (`\e]8;;https://example.com/osc8\e\\label\e]8;;\e\\`).
    - Hover each one and click it with `Meta` held. Each is recorded once.
    - A plain click records nothing.
    - An OSC 8 link to `file:///etc/passwd` records nothing.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement.**
  - Before installing, check on npm that `@xterm/addon-web-links@0.13.0-beta.195` exists and that its peer dependency matches `@xterm/xterm@6.1.0-beta.195`. Use the xterm docs for `linkHandler` and `WebLinksAddon`, not memory.
  - The app window already denies `window.open` and navigation (`src/main/index.ts:62-63`). Keep that.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Cmd+click opens links from the terminal in the browser`.

### Task 5: Bold and links in the owner's iTerm2 colours

Spec §7.1 (owner, 2026-11-06). xterm.js has no bold colour option, so a small styler on the write path adds the colours.

**Files:**
- Create: `src/renderer/src/terminal/termStyle.ts` (+ `termStyle.test.ts`).
- Modify: `src/renderer/src/terminal/TerminalView.tsx`, which passes PTY output through the styler before `term.write`.
- Test: `e2e/terminal.e2e.ts`.

**Interfaces:**
- `createTermStyler(colors: { bold: string; link: string }): (chunk: string) => string`, with one styler per terminal. It keeps state across chunks and buffers an escape sequence that is cut at the end of a chunk until the next chunk.
- Rules:
  - **Bold text whose foreground is the default** draws in `colors.bold`. The styler adds the colour where bold turns on, or where the foreground returns to the default while bold is on. It ends the colour again where bold ends.
  - **An explicit foreground always wins:** 30–37, 90–97, `38;5;n`, `38;2;r;g;b` and `38:…`.
  - **Text inside an OSC 8 link** draws in `colors.link` with an underline. After the link ends, the styler restores what was there before.
  - **Every other byte passes through unchanged and in order.**
- **Flow control:** check how `outputFlow` counts bytes. The styler must not break its accounting; count the original chunk.

- [ ] **Step 1: Write the failing tests.**
  - Unit (`termStyle.test.ts`):
    - Plain text is unchanged.
    - `\e[1mX\e[22m` gets the bold colour, and the colour ends again.
    - `\e[1;31mX` stays red.
    - `\e[1m\e[39mX` gets the bold colour.
    - `\e[0m` resets everything.
    - Colon sub-parameters pass untouched.
    - An SGR split across two chunks gives the same result as one chunk.
    - An OSC 8 link gets the link colour and underline, and the old attributes come back after it.
    - The alternate-screen switch passes untouched.
    - A 50 KB chunk of mixed output from fake-claude comes out byte-identical when it contains no bold and no links.
  - e2e `bold text and links take the owner's colours`:
    - `printf` bold text and an OSC 8 link.
    - Through an e2e hook that reads xterm's buffer cell (`getFgColor`, `isFgRGB`, `isUnderline`), the bold cell's foreground is `#addb67`, and the link cell's is `#82aaff` and underlined.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement.** Use xterm's `minimumContrastRatio` setting as it is, unless it changes these colours; report what you find.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: bold text and links in the owner's iTerm2 colours`.

### Task 6: A ring on the card while Claude Code shows a suggestion

Spec §2 and §7.1 (owner, 2026-11-06). This is the one place the app reads the screen. Claude Code's "You should know" mod has no signal (docs, 2026-11-06), and its label has varied between versions (`✦ You should know ·` seen, `✦ Heads up ·` in the docs).

**Files:**
- Create: `src/renderer/src/terminal/suggestion.ts` (+ test).
- Modify:
  - `src/renderer/src/terminal/TerminalView.tsx` (runs the check);
  - `src/renderer/src/tasksStore.ts` (a per-task `suggesting` flag);
  - `src/renderer/src/board/TaskCard.tsx`;
  - `src/renderer/src/app.css`.
- Test: `e2e/board.e2e.ts`.

**Interfaces:**
- `hasSuggestion(lines: string[]): boolean`. It is true when a line starts, after optional spaces, with `✦ `, has ` · ` after the label, and one of the next three lines contains `0: Dismiss`.
- `TerminalView` runs it on the bottom `min(rows, 24)` rows of the active buffer after output is parsed, at most every 250 ms with a trailing run. It sets `suggesting` for its task, which clears when the session ends.
- `TaskCard` gets `data-suggestion="true"` while it applies, and a visually hidden description `Claude Code has a suggestion for you`.
- **The ring:**
  - a 1 px light white ring, `color-mix(in srgb, white 55%, transparent)`;
  - it flashes once on arrival, after Parallel Code's `kanban-flash`: a 2 px ring fading over 1.6 s;
  - it then breathes after Parallel Code's `statusPulse`: opacity 1 ↔ 0.35 over 1.9 s, `ease-in-out`, infinite;
  - under reduced motion it is a steady ring;
  - it doesn't change the card's lane, glyph or label.

- [ ] **Step 1: Write the failing tests.**
  - Unit, true for:
    - the block as seen (`✦ You should know · Damela's splash … too.` then `1: Learn more   2: Knew this already   0: Dismiss`);
    - the `✦ Heads up ·` form.
  - Unit, false for:
    - the same text without its choices line;
    - a line in which Claude quotes "You should know";
    - an empty screen.
  - e2e `a suggestion puts a ring on its card, and answering it takes the ring away`:
    - In a working task, `printf` the block at the bottom of the screen. Within 1 s the card has `data-suggestion="true"`.
    - `clear` the screen. Within 1 s the attribute is gone.
    - Print 100 lines after the block so it scrolls out of the bottom rows. The ring goes.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement.** Invoke `frontend-design:frontend-design` first. Credit the two Parallel Code keyframes as the convention says, if adapted.
- [ ] **Step 4:** Run `npm --prefix <root> test`, `… run typecheck` and `… run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: a soft ring on a card while Claude Code shows a suggestion`.

### Task 7: Acceptance with the owner, second pass

Plan 2a Task 10 goes on here with the owner at the keyboard in Damela.

**Files:**
- Create: `docs/superpowers/findings/2026-11-06-plan-2a-acceptance.md`. Record a row per check (done, seen, pass/fail), in the style of `docs/feel-test.md`. Include the first pass's rows from the plan 2a ledger.

- [ ] **Step 1: Run the checks with the owner.**
  1. **The six fixes, each with real Claude Code:**
     - `panel-show`;
     - no message box;
     - Close mid-turn then Reopen carries on, and waiting then Reopen stays waiting;
     - Cmd+click a link;
     - the colours;
     - the ring on a real "You should know" suggestion, and that answering `2` takes it away.
  2. **Plan 2a Task 10 rows not yet run:**
     - Changed files against `git status`;
     - `/clear`, then Close, then Reopen;
     - quit with two tasks running (one mid-turn), then start again;
     - one real merge, start to finish.
  3. **Items added by plan 2a's final review:**
     - Reopen of a task whose first launch failed;
     - whether `claude -w <slug>` enters an existing worktree;
     - real-keyboard Ctrl+Tab;
     - drag regions with the real mouse;
     - `node_modules` links in Changed files;
     - padding around the window buttons;
     - how terminal resizes feel.
- [ ] **Step 2: Commit the findings file** `docs: plan 2a acceptance findings`.
