# Panel strips and the top row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One row along the window's top holds the Mac's window buttons, Projects, and each project's Todo, Manager, name and New task above its own pane, with Next that needs you once at its right end. The projects list, the Todo panel, the manager and the session panel each fold into a labelled strip in their own place and come back from it. The row buttons turn the first three on and off.

**Architecture:** Each project's part of the row is its pane's own first row (`.project-bar`). So it sits above that pane side by side and in the grid, follows the divider, and has the pane's own state at hand. The window's part (room for the window buttons, then Projects) is one row under the bars, and the first shown pane's bar reaches left to start right after it. A folded or off panel is laid out like a floating panel that has slid away: absolute, at its full width and height, and invisible. So folding never resizes a terminal. A shared `PanelStrip` stands in its place while it is folded, or beside it while it floats, and three pure rules (`stripShows`, `roomTaken`, `roomToPin`) count the strips in the pane's widths. Nothing new is saved.

**Tech Stack:** TypeScript 5.9, Electron 44.10.2, SolidJS 1.9, vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-11-11-mainframe-panel-strips-design.md`. Mockup: `docs/superpowers/mockups/2026-11-11-panel-strips.html`. **§9 is not in this plan:** it is fixed on its own branch and merged into `main` first. Panes always fill the window here.

### Decisions the spec leaves to the builder (§10)

1. **The row's structure.** Each pane renders its own part as its first row, the pane's full width, above its islands. A portal into a window-level row was weighed and turned down, for three reasons:
   - Its slots would have to copy every pane's geometry: measured again on each divider move and window resize, with a second mode for the grid's lower rows.
   - It would take the buttons out of the pane's DOM. There, `inert` on a pane off screen covers them, and the e2e's pane-scoped locators (`projectPane(page, dir).getByTestId('new-task')`) find them.
   - A bar inside the pane gets the divider, the grid's lower rows (mockup step 7) and the pane's state for free.

   The one thing it can't do by itself is start the first part right after Projects (spec §3.2). So:
   - The first shown pane's bar gets `margin-left: calc(var(--row-start) - var(--rail-w))`.
   - `--row-start` is the measured right edge of the window's part. It is the only measured value, because the Projects button grows a count when the list is off.
   - `--rail-w` is the projects list's width in each state, set in CSS.
   - The clip moves from `.project-pane` to a new `.pane-body`, so that bar can reach left of its pane.
2. **Next that needs you** is rendered in the bar of the pane that ends the window's top row (`panePlace().last`): the last one side by side, or the top row's last in the grid. It is a flex item there, so it takes its room and drops its words with that bar. With no project open there is no Next, since nothing can need you.
3. **State:**
   - **Session panel:** `tasksStore`'s `panelOpen` becomes `boolean | null`. `select()` already opens it, which covers "selecting a card opens it" and Ctrl+Tab.
   - **Manager:** on and off stay in the layout. Open or folded is a `managerOpen` record in `projectsStore`, outside the saved layout, so `focusProject` can open a folded manager before it puts the cursor there.
   - **Todo panel:** a `PanelState` signal in `ProjectPane`, since nothing outside the pane puts the keyboard there.
   - **Projects list:** a `railState` signal in `projectsStore`.
   - **Launch (spec §5):** the open-or-folded values are null or undefined until the owner's first move, and the pane then reads the panel's pin as shown, live. That also covers a pane that turns too narrow to pin before the owner has touched the panel.
4. **Folded and off.** A folded or off island is laid out like a floating one that has slid away. Off differs from folded only in having no strip. A pinned, open panel has no strip. A floating panel keeps its strip while it is out (spec §4.3).
5. **The width rules count the strips:**
   - `roomTaken` counts what each panel takes beside the board.
   - `roomToPin` decides whether the session panel can be pinned.
   - A panel's own clamp never depends on its own open or folded state. Its own strip counts only while it floats, and then it always shows. So folding a panel at its widest keeps its width.
6. **One strip component and one fold button:** `PanelStrip` and `FoldButton` in `src/renderer/src/panel/PanelStrip.tsx`, used by all four panels.
7. **The Mac's window buttons.** The installed Electron 44.10.2 `electron.d.ts` documents two calls, and this plan uses neither:
   - What it documents:
     - the constructor option `trafficLightPosition?: Point`;
     - the method `setWindowButtonPosition(position: Point | null)`;
     - both darwin-only, both "in frameless windows", and neither says what x and y measure;
     - the current custom-title-bar docs pair `trafficLightPosition` only with `titleBarStyle: 'hidden'`.
   - What this plan does:
     - The row keeps today's title-row geometry: 46 px high, buttons 6 px from the top and 4 px from the bottom, 80 px at its left for the window buttons. In that geometry `titleBarStyle: 'hiddenInset'` already places the window buttons, as it does in today's title rows.
     - If the owner's Mac check finds them off-centre, add `trafficLightPosition` in the constructor. A fixed row needs no runtime call.
8. **Drag regions (spec §8):**
   - **Kept:** on the Mac only, `.top-row` and the bars of the panes in the window's top row drag, and their children don't. `.resize-edge`'s no-drag also stays, because the pane divider crosses the row.
   - **Removed:** every other drag rule, no-drag carve-out and page-order workaround.
   - **Page order:** the pane's page order becomes its visual order, and the `order` rules go.
   - **Lower grid rows:** a lower grid row's bar doesn't drag. It isn't the window's title bar.
9. **Test ids:**
   - **New:** `top-row`, `projects-toggle`, `project-bar`; the fold buttons `rail-fold`, `todo-fold`, `manager-fold`, `panel-fold`; and the strips `rail-strip`, `todo-strip`, `manager-strip`, `panel-strip`.
   - **Kept:** `todo-toggle`, `manager-toggle`, `jump-next`, `new-task`, `arrange-columns` and `arrange-grid`, which only move.
   - **Gone:** `panel-hide`, `panel-show`, `manager-hide`, `manager-show` and `todo-hide`.

## Global Constraints

- **Project-agnostic** (root `CLAUDE.md`). No code, copy or test value names a project, path, branch or tool. The strips are named "Projects", "Todo", "Manager", and the selected session's title or "Session" (spec §6).
- **Several projects in one window** (root `CLAUDE.md`). "Each project's row buttons act only on the project below them; the Projects button and the projects list are the window's" (spec §7). Every task review asks both questions; a no is an Important finding.
- **Nothing new is saved** (spec §5). No new `localStorage` key. Folded states, the projects list's state and the manager's open flag live in memory only.
- **Anti-goals** (spec §2), each a hard rule:
  - No arrow or tab is left on a panel's edge or on the pane's edge.
  - The Mac's window buttons are never hidden.
  - "Folding hides a panel the way hiding does today: by moving it and turning it invisible, never by changing its size."
  - The keyboard never ends up in a folded or off panel.
- **Motion:** "opening and folding use the panels' existing slide (220 ms) and fade. With reduced motion, they switch at once."
- **Windows and Linux:** "the system's title bar stays above the page, and the row is plain page under it". No drag region off the Mac.
- **No dependency changes** on this branch.
- **UI work uses the `frontend-design` skill** (owner's global `CLAUDE.md`), within `app.css`'s tokens and today's button styles. This covers Tasks 1, 4 and 5's CSS, and the strip and fold looks in Tasks 2 and 3.
- **Dead code:** delete what each change makes dead (listed per task), including imports it leaves unused. Point out, don't remove, dead code found elsewhere.
- **No e2e run while the owner's Mainframe runs.** Each e2e run has its own step before it: `pgrep -fl "Simmesolo/Mainframe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"`, run on its own and read first.
  - If it prints a process, stop and ask the owner to quit Mainframe with Cmd+Q.
  - Never run it in the same batch as the e2e run.
- **Commits:** `type: plain sentence`, lowercase type. Never mention Claude, AI or Anthropic.
- **Commands:**
  - Run them from the worktree: `npm --prefix <worktree> …` and `git -C <worktree> …`, with absolute paths.
  - Never chain `cd` with another command.
  - Run `git add` and `git commit` as separate commands.

## Review Focus

1. **Folding a panel that sits at its widest:** it keeps its width and its terminal's size when folded and opened again. Its own clamp never counts its own strip. Test: Task 1 (pinned session panel).
2. **Two projects side by side:** one project's row buttons, folds and strips change nothing in the other. A project taken off screen and brought back finds its panels as it left them. Test: Task 4.
3. **The first project changes** (Cmd+W on it, a swap, the grid): the new first part starts right after Projects, and the old one loses its offset. Test: Task 4.
4. **Before the owner's first move, a panel looks as its pin as shown says.** A pinned session panel in a pane too narrow to pin it (a narrow window, a second project beside it) is folded, not floating open over the board. After a fold, it stays folded. Test: Task 1.
5. **The keyboard into a folded panel:** Ctrl+Tab to a task while the session panel is folded (pinned or not), and Cmd+1 (Ctrl+1) while the manager is folded, open the panel and put the cursor in its terminal. Tests: Tasks 1 and 2.

## Before Task 1

1. **The §9 fix has merged:** check that `git -C <worktree> log --oneline -10 main` shows it. If it hasn't, stop and ask the owner.
2. **Package check** (the owner's shared rule): run `npm --prefix <worktree> outdated` and `npm --prefix <worktree> audit --omit=dev`. Report anything behind to the owner, security first. Nothing updates on this branch.
3. **Baseline:** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck` pass.
4. **The design goes in with the code.** The spec, the mockup and this plan are not in git yet. Copy each into the worktree at its path under `docs/superpowers/` and commit them as the branch's first commit: `git -C <worktree> add docs/superpowers/specs/2026-11-11-mainframe-panel-strips-design.md docs/superpowers/mockups/2026-11-11-panel-strips.html docs/superpowers/plans/2026-11-11-mainframe-panel-strips.md`, then `git -C <worktree> commit -m "docs: the design and plan for the top row and the panels that fold into strips"`.

---

### Task 1: Folding's parts, and the session panel folds

**Files:**
- Create: `src/renderer/src/panel/PanelStrip.tsx`
- Modify:
  - `src/renderer/src/panel/panelPrefs.ts`, `panelPrefs.test.ts`
  - `src/renderer/src/panel/SidePanel.tsx`
  - `src/renderer/src/panel/Chevron.tsx` (doc comment)
  - `src/renderer/src/tasksStore.ts` (`ProjectTasks.panelOpen`, `noTasks`)
  - `src/renderer/src/projects/ProjectPane.tsx` (the session panel's props, `roomToPin`)
  - `src/renderer/src/app.css`
  - `e2e/panel.e2e.ts`, `e2e/shortcuts.e2e.ts`

**Interfaces:**
- Produces, in `panelPrefs.ts`:
  - `type PanelState = 'open' | 'folded' | 'off'`.
  - `STRIP_WIDTH = 24`. It is app.css's `--strip-w`, counted without its margin, as the islands' widths are.
  - `stripShows(state: PanelState, pinned: boolean): boolean`: true when the panel is on and either folded or floating.
  - `roomTaken(state: PanelState, pinned: boolean, width: number): number`: what the panel takes beside the board. `STRIP_WIDTH` while its strip shows, `width` when open and pinned, 0 when off.
  - `roomToPin(paneWidth: number, beside: number): boolean`: `paneWidth - beside - MIN_WIDTH >= BOARD_ROOM.pinned`. It replaces `ProjectPane`'s inline `roomToPin`.
- Produces, in `PanelStrip.tsx`:
  - **The strip:** `default function PanelStrip(props: { name: string; label: string; side: 'left' | 'right'; mark?: JSX.Element; testId: string; class?: string; ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void); onOpen(): void })`.
    - All of it is one button with `aria-label={props.label}`. Top to bottom it holds: a `Chevron` toward the board (`points="right"` on the left side), the mark, and the name written vertically.
    - The name reads bottom-to-top on the left and top-to-bottom on the right, as in the mockup, and is cut short with an ellipsis.
    - `side` also picks the strip's margins.
  - **The fold button:** `export function FoldButton(props: { label: string; points: 'left' | 'right'; testId: string; ref?: …; onFold(): void })`. It has the pin's look and sits left of the pin, with `aria-label` and `title` set to `label`.
- Produces, in `tasksStore.ts`: `ProjectTasks.panelOpen: boolean | null`, null in `noTasks()` and `NO_TASKS` until the first move. `select()` still sets it true, and `setPanelOpen(dir, open: boolean)` is unchanged.
- Produces, in `SidePanel`:
  - `open` now means open rather than folded, pinned or not.
  - New prop `stripName: string`.
  - `badge` and `badgeLabel` become the strip's mark and its words.
  - Test ids: `panel-fold`, `panel-strip`.

- [ ] **Step 1: Write the failing unit tests** in `panelPrefs.test.ts`:
  - `stripShows`:
    - `('open', true)` → false;
    - `('open', false)`, `('folded', true)` and `('folded', false)` → true;
    - `('off', true)` and `('off', false)` → false.
  - `roomTaken`:
    - `('off', true, 400)` → 0;
    - `('open', true, 400)` → 400;
    - `('open', false, 400)` and `('folded', true, 400)` → `STRIP_WIDTH`.
  - `roomToPin`:
    - `(780, 0)` → true, and `(779, 0)` → false;
    - `(828, 2 * STRIP_WIDTH)` → true, and `(827, 2 * STRIP_WIDTH)` → false.
- [ ] **Step 2: Run** `npm --prefix <worktree> test -- src/renderer/src/panel/panelPrefs.test.ts`. Expected: FAIL (the exports don't exist).
- [ ] **Step 3: Write the e2e tests.** They name test ids that don't exist yet, so they fail until Step 4.
  - **`panel.e2e.ts`, the unpinned test** becomes "unpinned, a press on the board folds the panel into its strip, which stays beside it while it is out; a card or the strip brings it out, and its terminal keeps its size":
    - After `panel-pin`: `data-pinned` is false, `data-open` is true, `panel-strip` is visible, and the panel's right edge is at most the strip's x.
    - A board press: `data-open` false, the panel hidden, the strip visible.
    - A card click: `data-open` true.
    - `panel-fold`: `panel-strip` is focused. A `blocked:kind=question` report gives the strip a `task-glyph` with `data-glyph` `ask`, and the strip's accessible name is `Show Task, Needs input`.
    - A strip click: `data-open` true, and `panel-fold` is focused.
    - `termSize` is unchanged at every step, and `stty size` matches it.
  - **The sideways test:** the strip replaces `panel-show`, and `panel-fold` is focused at the end.
  - **The hidden-start test:** `panel-fold` replaces `panel-hide`.
  - **New, Review Focus 1:** "pinned, the panel folds into a strip at its pane's right edge and gives the board its room; a card or the strip opens it, and a panel at its widest keeps its width and its terminal's size".
    - Set the window to 1600 and start a task.
    - Press ArrowLeft on `panel-resize` until `aria-valuenow` equals its `aria-valuemax`. Record the panel's width and `termSize`.
    - `panel-fold`:
      - the panel is hidden and `panel-strip` is focused;
      - the strip is 24 px wide, and its right edge is the `project-pane`'s right edge minus 8 (±1);
      - the board's right edge is past the panel's old x.
    - A card click opens the panel at the same width.
    - Fold again, then click the strip: `panel-fold` is focused, the width is the same, `termSize` is the same, and `stty size` matches.
    - `panel-strip` has a count of 0 while the panel is pinned and open.
  - **New, Review Focus 4:** "before the owner folds or opens it, the session panel follows its pin as shown; once folded, it stays folded".
    - `setWindowWidth` 1200: a 1004 px pane can't pin it beside the 400 px manager. `data-pinned` false, `data-open` false, `panel-strip` visible.
    - At 1600: `data-pinned` true, `data-open` true, `panel-strip` count 0.
    - `panel-fold`, then 1200, then 1600: `data-open` is false both times.
  - **`shortcuts.e2e.ts`:** the put-away test becomes "from the panel folded, pinned or not, Ctrl+Tab brings it out with the terminal focused" (Review Focus 5).
    1. Pinned: `panel-fold`, then `Control+Tab` → the panel is visible, and `expectJumpedTo` holds.
    2. Then `panel-pin` (unpinned), `panel-fold`, `Control+Tab` → the same.
- [ ] **Step 4: Implement** (use `frontend-design` for the strip and fold looks):
  - **`ProjectPane`:**
    - The panel's open state is `panelOpen = () => tasks().panelOpen ?? panelPrefs().pinned`.
    - `roomToPin` comes from `panelPrefs`.
    - `SidePanel`'s `besideWidth` is `besideWidth() + (panelPrefs().pinned ? 0 : STRIP_WIDTH)`. Its own strip counts only while it floats (Decision 5).
    - `stripName` is `selected()?.title ?? 'Session'`.
  - **`SidePanel`:**
    - A `FoldButton` (`points="right"`, `label` "Fold the session panel") sits beside the pin.
    - After the aside, `PanelStrip` (`side="right"`, mark `badge`, label `Show ${stripName}` plus `, ${badgeLabel}` when set) shows while `stripShows(open ? 'open' : 'folded', prefs.pinned)`.
    - Folding calls `onOpenChange(false)`, then focuses the strip. The strip calls `onOpenChange(true)`, then focuses the fold button.
    - `data-open` is `String(props.open)`.
  - **`app.css`:**
    - `:root { --strip-w: 24px; }`.
    - `.panel-strip`: an island like the panels (background, border, radius), full height, lighter on hover.
    - `.panel-fold` shares `.panel-pin`'s rule at `right: 42px`, and `.side-panel { --panel-pin-room: 76px; }`.
    - `.side-panel:is([data-pinned='false'], [data-open='false'])` is laid out at the floating place, `right: calc(16px + var(--strip-w))`.
    - `.side-panel[data-open='false']` slides past the pane's right edge and turns invisible.
    - Under `prefers-reduced-motion: no-preference`, the transform transition goes on `.side-panel` itself and the delayed visibility on `[data-open='false']`, so a pinned panel slides too.
    - The lanes' mask applies only to a panel that is pinned and open.
  - **`Chevron.tsx`:** its doc comment names the fold button and the strip.
  - **Dead, remove:**
    - `SidePanel`'s `panel-hide` and `panel-show` buttons, their refs, and `shown()`.
    - `.side-panel[data-pinned='false'] .panel-hide`.
    - The `.side-panel` halves of the `.panel-show` visibility and motion rules. `.panel-show`'s base rule stays for the manager until Task 2.
- [ ] **Step 5: Run** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: PASS.
- [ ] **Step 6: Check that the owner's Mainframe isn't running:** `pgrep -fl "Simmesolo/Mainframe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"`. Expected: no output. Otherwise stop and ask the owner to quit it with Cmd+Q.
- [ ] **Step 7: Run** `npm --prefix <worktree> run test:e2e -- e2e/panel.e2e.ts e2e/shortcuts.e2e.ts`, then `npm --prefix <worktree> run test:e2e`. Expected: all pass.
- [ ] **Step 8: Commit.** First `git -C <worktree> add -A src e2e`, then `git -C <worktree> commit -m "feat: the session panel folds into a strip at its pane's right edge, pinned or not, and its hide pill and way back go"`.

### Task 2: The manager folds

**Files:**
- Modify:
  - `src/renderer/src/manager/ManagerColumn.tsx`, `src/renderer/src/manager/managerStore.ts`
  - `src/renderer/src/projects/projectsStore.ts`, `src/renderer/src/projects/ProjectPane.tsx`
  - `src/renderer/src/app.css`
  - `e2e/manager.e2e.ts`, `e2e/projects.e2e.ts`, `e2e/todo.e2e.ts`

**Interfaces:**
- Consumes: `PanelState`, `STRIP_WIDTH`, `stripShows`, `roomTaken`, `PanelStrip` and `FoldButton` (Task 1).
- Produces, in `projectsStore.ts`:
  - The store gains `managerOpen: Record<string, boolean>`. It sits outside `layout` and is never saved.
  - `managerOpenOf(dir: string): boolean | undefined` and `setManagerOpen(dir: string, open: boolean): void`.
  - `toggleManagerOf(dir)` also sets the manager open when it turns it on (spec §4.2: "never as a strip").
  - `focusProject(dir)` calls `setManagerOpen(dir, true)` before putting the cursor in the manager's terminal.
  - A closed project's entry goes in `setProjects`, beside `forgetManager`.
- Produces, in `managerStore.ts`: `managerStateOf(dir: string)`, which returns what `ManagerColumn`'s `state` memo returns today, now shared with the row button.
- Produces, in `ManagerColumn`:
  - The prop `open: boolean` becomes `state: PanelState`.
  - `onOpenChange(open: boolean)` now folds and opens.
  - Its terminal is selected while `project.shown() && state === 'open'`, as now.
  - Test ids: `manager-fold`, `manager-strip`.
- Produces, in `ProjectPane`: `managerState(): PanelState`. It is `'off'` unless `isManagerShown(dir)`, then `'open'` when `managerOpenOf(dir) ?? managerPinned()`, else `'folded'`.

- [ ] **Step 1: Write the e2e tests:**
  - **`manager.e2e.ts`, the arrow test** becomes "the manager's fold button folds it into a strip at its pane's left edge, the board takes its room, and the strip opens it again; the focus goes from one to the other, and Manager stays lit":
    - `manager-fold`:
      - the column is hidden, and `manager-toggle` still has `aria-pressed` true;
      - the board's x is less than the pinned column's x plus 100;
      - `manager-strip` is focused, 24 px wide, at `project-pane` x plus 8 (±1).
    - A strip click: the column is visible, `manager-fold` is focused, and `manager-strip` has a count of 0.
    - The header at its narrowest (spec §7):
      - press ArrowLeft on `manager-resize` six times, to 320;
      - `manager-title`'s right edge is less than `manager-fold`'s x, and the fold's right edge is less than `manager-pin`'s x;
      - the three share a centre line (±1).
  - **The unpinned test** becomes "unpinned, the manager floats over the board beside its strip, a press on the board folds it, and its terminal keeps its size; unpinned at a restart, it starts folded":
    - After `manager-pin`: `data-open` true, `manager-strip` visible, and the column's x is at least the strip's right edge.
    - `isOnTop(manager-toggle)` stays, and so do the lost rows under the top bar until Task 4.
    - A board press: `data-open` false, the column hidden, `manager-toggle` still pressed, the strip visible.
    - A blocked report gives the strip the `ask` glyph and the accessible name `Show manager, Needs input`.
    - A strip click: `manager-fold` is focused. The fold button: the strip is focused.
    - `managerTermSize` equals the floating size.
    - After a restart: `data-pinned` false, `data-open` false, and `manager-strip` visible.
  - **New:** "the Manager button turns the manager off and on: off leaves no strip and the button shows its state; on opens it fully, even from folded; the focus in it goes to the button".
    1. `manager-fold`, then `manager-toggle`: the column is hidden, `manager-strip` has a count of 0, and `aria-pressed` is false.
    2. A blocked report gives `manager-toggle` a `task-glyph` with `data-glyph` `ask`.
    3. Toggle again: `data-open` true, and the strip count is 0.
    4. Click the column, so the focus is in its terminal, then toggle: the column is off, `manager-toggle` is focused, and `focusInManager` is false.
  - **New, Review Focus 5:** "Cmd+1 (Ctrl+1 on Windows and Linux) opens a folded manager and puts the cursor in its terminal". With no task: `manager-fold`, then `ControlOrMeta+1` → `data-open` true, and `focusInManagerTerminal` is true.
  - **The edge-drag test:** its comment no longer names a hide pill.
  - **`projects.e2e.ts`:** "the way back to a manager put away shows on screen only" becomes "beside others, each manager starts off and leaves no strip".
    - Use three projects, with b beside a.
    - In each pane, `manager-strip` has a count of 0 and `manager-column` is hidden.
    - a's `manager-toggle` has `aria-pressed` false.
  - **`todo.e2e.ts`:**
    - In the pinned test, `manager-fold` and `manager-strip` replace the hide and show: "Folded, the manager's strip sits right of the Todo panel", meaning its x is at least the Todo panel's right edge.
    - Delete "floating over the board, the Todo panel hides the manager's way back…". Its subject goes, and Task 3 adds the Todo button's test.
- [ ] **Step 2: Implement:**
  - **`ProjectPane`:**
    - `managerState()` replaces the local `setManagerOpen` and `managerTakesRoom()`.
    - `besideWidth`'s manager term and `todoRoom`'s become `roomTaken(managerState(), managerPinned(), …)`, at the widths they use today.
    - `managerWidthIn` clamps in `width() - todoBeside() - (managerPinned() ? 0 : STRIP_WIDTH)`.
    - A board press calls `setManagerOpen(dir, false)` for a floating manager. It folds; off stays off.
  - **The Manager row button:**
    - `aria-pressed` is `showManager()`.
    - While it is off, the button shows `managerStateOf(dir)`'s `StatusGlyph`.
    - On click: `const on = showManager(); toggleManagerOf(dir);`. If it was on and the focus is in this pane's `.manager-column`, focus the button. Nothing moves when the focus is elsewhere, as today's toggle does.
  - **`ManagerColumn`:**
    - A `FoldButton` (`points="left"`, `label` "Fold the manager") sits beside the pin.
    - Before the aside, `PanelStrip` (`class="manager-strip"`, `side="left"`, name "Manager", the state glyph as its mark, label `Show manager` plus `, ${state.text}`) shows while `stripShows(state, pinned)`.
    - It hands the focus as in Task 1.
    - `data-open` is `String(state === 'open')`.
  - **`app.css`:**
    - `.manager-column { --panel-pin-room: 76px; }`.
    - `.manager-strip { order: -1; }`, which goes with the other order rules in Task 4.
    - `.manager-column:is([data-pinned='false'], [data-open='false'])` is laid out at the floating place, `left: calc(16px + var(--strip-w) + var(--left-room, 0px))`.
    - `[data-open='false']` slides left and turns invisible, with the motion as in Task 1.
    - `--left-room` stays. The spec lists it among the tabs' rules, but it also places the floating manager right of the Todo panel.
  - **Dead, remove:**
    - `manager-hide` and `manager-show`, and their refs.
    - `.manager-column[data-pinned='true'][data-open='false'] { display: none; }`.
    - The `.manager-column` half of `.manager-column .panel-hide, .todo-panel .panel-hide`.
    - Every `.panel-show` rule, since the manager was its last user: the base rule, `.manager-column + .panel-show`, the "level with the floating manager's arrow", "below the hide pill" and "out of sight under the floating Todo" rules, the visible rule, the hover and svg halves, and the motion rule.
- [ ] **Step 3: Run** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: PASS.
- [ ] **Step 4: Check that the owner's Mainframe isn't running:** the `pgrep` command from Task 1, Step 6, on its own. Expected: no output.
- [ ] **Step 5: Run** `npm --prefix <worktree> run test:e2e -- e2e/manager.e2e.ts e2e/projects.e2e.ts e2e/todo.e2e.ts`, then the whole suite. Expected: all pass.
- [ ] **Step 6: Commit.** `git -C <worktree> add -A src e2e`, then `git -C <worktree> commit -m "feat: the manager folds into a strip in its place, a press on the board folds it instead of turning it off, and the Manager button turns it on fully"`.

### Task 3: The Todo panel folds

**Files:**
- Modify:
  - `src/renderer/src/todo/TodoPanel.tsx`, `src/renderer/src/projects/ProjectPane.tsx`
  - `src/renderer/src/app.css`
  - `THIRD_PARTY_NOTICES.md`
  - `e2e/todo.e2e.ts`

**Interfaces:**
- Consumes: Task 1's parts, and Task 2's `managerState()`.
- Produces, in `TodoPanel`:
  - The props `open: boolean; onHide(): void` become `state: PanelState; onOpenChange(open: boolean): void`.
  - Test ids: `todo-fold`, `todo-strip`.
  - Sync always has an `aria-label` ("Sync" or "Stop the sync"), and its word sits in a span that the header can drop.
- Produces, in `ProjectPane`:
  - `const [todo, setTodo] = createSignal<PanelState>(todoPrefs().pinned ? 'open' : 'off')`, as today's launch (spec §5).
  - `showTodo(state: PanelState)` closes the ticket unless the panel is open.

- [ ] **Step 1: Write the e2e tests** in `todo.e2e.ts`:
  - **The pinned test:**
    - `todo-fold` replaces `todo-hide`: the panel is hidden, `todo-strip` is focused, and the toggle is still pressed. A strip click shows the panel, with `todo-fold` focused.
    - A board press on the floating panel: `data-open` false, the panel hidden, `todo-toggle` still `aria-pressed` true, `todo-strip` visible, and the manager column still visible.
    - After a restart, unpinned: the panel is hidden, `todo-strip` has a count of 0, and the toggle isn't pressed (off).
    - The third start, pinned, opens it.
  - **New**, in the deleted test's place: "the Todo button turns the panel off, from open or folded, leaving no strip, and on again opens it fully; the focus in it goes to the button, and its ticket closes".
    1. Toggle: the panel is open and floating, so its strip shows.
    2. `todo-fold`, then toggle: off, with `todo-strip` count 0 and `aria-pressed` false.
    3. Toggle: `data-open` true.
    4. Quick Add focuses the ticket's Title. Toggle: off, `todo-toggle` focused, `ticket-panel` count 0.
    5. Toggle: still no ticket.
  - **"The Todo panel going away takes it along":**
    - `todo-fold`, then `todo-strip`: no ticket.
    - With the ticket open again, the toggle twice: no ticket.
  - **The header at 280:**
    - Left to right: the name, then add, then sync, then `todo-fold`, then the pin.
    - All share one centre line (±1).
    - `todo-sync` has the accessible name "Sync".
  - **New:** "a strip whose panel is off leaves no gap, and the pinned session panel's widest counts the strips". At window width 1600:
    1. Todo on (floating, so its strip shows) and `manager-fold`:
       - `todo-strip`'s x is `project-pane` x plus 8 (±1), and `manager-strip`'s x is at least `todo-strip`'s right edge;
       - `panel-resize`'s `aria-valuemax` is the pane's width minus 48 minus 360.
    2. Todo toggled off:
       - `manager-strip`'s x is the pane's x plus 8 (±1);
       - `aria-valuemax` is the pane's width minus 24 minus 360.
- [ ] **Step 2: Implement:**
  - **`ProjectPane`:**
    - `todo` replaces `todoOpen`.
    - `todoBeside` is `roomTaken(todo(), todoPrefs().pinned, shownTodoWidth())`.
    - `todoRoom`'s floating term is `width() - STRIP_WIDTH`.
    - A board press calls `showTodo('folded')` only when the panel floats and is open, so an off panel stays off.
  - **The Todo row button:**
    - `aria-pressed` is `todo() !== 'off'`.
    - On click: off becomes open. Otherwise the panel turns off, and when the focus is in this pane's `.todo-panel` it moves to the button. `hideTodo` goes.
  - **`TodoPanel`:**
    - A `FoldButton` (`points="left"`, "Fold the Todo panel") sits beside the pin.
    - Before the aside, `PanelStrip` (`class="todo-strip"`, `side="left"`, name "Todo", label "Show Todo") shows while `stripShows(state, pinned)`.
    - It hands the focus as in Task 1.
    - `data-open` is `String(state === 'open')`.
  - **`app.css`:**
    - `--panel-pin-room: 76px` becomes the islands' shared value, and Tasks 1 and 2's overrides go.
    - `.todo-strip { order: -2; }`.
    - `.todo-panel:is([data-pinned='false'], [data-open='false'])` is laid out at the floating place, `left: calc(16px + var(--strip-w))`, and slides and hides as the others do.
    - `.todo-panel { container-type: inline-size; }` with `@container (max-width: 300px)` dropping Sync's word. That is how the 280 px header makes room (spec §10).
    - Z-index:
      - `.todo-panel { z-index: 5; }` covers the floating panel too, over the floating manager (4), which slides away under it.
      - `.todo-panel:has(> .ticket-panel) { z-index: 6; }`: holding a ticket, it is over the floating session panel (5). The comment says so.
  - **Dead, remove:**
    - `todo-hide`.
    - `.todo-panel[data-pinned='true'][data-open='false'] { display: none; }`.
    - The `[data-pinned='false']` half of the `z-index: 7` rule, whose ticket half becomes 6 as above.
    - Every `.panel-hide` rule, since the Todo panel was its last user: the base, the `.todo-panel .panel-hide` rule, and the hover and svg halves.
    - The words "and hide pill" in `.ticket-panel`'s comment.
    - In `THIRD_PARTY_NOTICES.md`, the line "`src/renderer/src/app.css` (the side panel's hide pill) ← `src/components/task-board.css` (`.board-side-panel-close`)". No CSS adapted from it remains.
- [ ] **Step 3: Run** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: PASS.
- [ ] **Step 4: Check that the owner's Mainframe isn't running:** the `pgrep` command on its own. Expected: no output.
- [ ] **Step 5: Run** `npm --prefix <worktree> run test:e2e -- e2e/todo.e2e.ts`, then the whole suite. Expected: all pass.
- [ ] **Step 6: Commit.** `git -C <worktree> add -A src e2e THIRD_PARTY_NOTICES.md`, then `git -C <worktree> commit -m "feat: the Todo panel folds into a strip, its button turns it on and off, and the last hide pill goes"`.

### Task 4: The top row

**Files:**
- Create: `src/renderer/src/projects/TopRow.tsx`, `e2e/top-row.e2e.ts`
- Modify:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/projects/Panes.tsx`, `ProjectPane.tsx`, `ProjectRail.tsx`, `layout.ts`, `layout.test.ts`, `projectsStore.ts`
  - `src/renderer/src/manager/ManagerColumn.tsx` and `src/renderer/src/todo/TodoPanel.tsx` (comments only)
  - `src/renderer/src/app.css`
  - `src/main/index.ts` (the comment on `titleBarStyle` only)
  - `e2e/tasks.ts`, `e2e/app.e2e.ts`, `e2e/manager.e2e.ts`, `e2e/panel.e2e.ts`, `e2e/session-panel.e2e.ts`, `e2e/todo.e2e.ts` (comments)

**Interfaces:**
- Consumes: Task 1's `PanelState`. Task 2's `managerStateOf`.
- Produces, in `layout.ts`:
  - `interface PanePlace { first: boolean; top: boolean; last: boolean }`.
  - `columnsOf(layout: Layout): number`: in the grid (two or more on screen), `Math.ceil(Math.sqrt(shown.length))`; otherwise `shown.length`.
  - `panePlace(layout: Layout, dir: string): PanePlace`. From `at = shown.indexOf(dir)` and `cols = columnsOf(layout)`:
    - `first: at === 0`;
    - `top: at < cols`;
    - `last: at === Math.min(cols, shown.length) - 1`;
    - all false off screen.
- Produces, in `projectsStore.ts`:
  - `railState: Accessor<PanelState>`, `'open'` at launch and never saved, and `setRailState`.
  - `toggleRail(): void`: off becomes open, anything else becomes off.
  - `offScreenNeedsYou(): number`: `needsYouCount` summed over the open projects not on screen.
- Produces, in `TopRow.tsx`: `default function TopRow(props: { onStartWidth(px: number): void })`.
  - It renders `.top-row` (`data-testid="top-row"`) with `.top-start`, which holds Projects (`projects-toggle`).
  - It reports `.top-start`'s right edge from a `ResizeObserver`, first in `onMount`, before the first paint.
- Produces, in `App`: `.app` gets `data-rail={railState()}` and `style={{ '--row-start': `${rowStart()}px` }}`.
- Produces, in `ProjectPane`:
  - New prop `place: PanePlace`, shown as `data-first` and `data-top` on `.project-pane`.
  - Its children are `.project-bar` (`data-testid="project-bar"`), `.pane-body` and the dialog.
- Produces, in CSS: `--row-height: 46px` and `--rail-w` (196px open, 0px off).

- [ ] **Step 1: Write the failing unit tests** in `layout.test.ts`:
  - `columnsOf`: three side by side → 3; a grid of 1 → 1, of 3 → 2, of 4 → 2, of 5 → 3.
  - `panePlace`:
    - Three side by side: `/a` is `{ first: true, top: true, last: false }`, `/b` is `{ first: false, top: true, last: false }`, and `/c` is `{ first: false, top: true, last: true }`.
    - A grid of 3: `/b` is `{ top: true, last: true }` with `first` false, and `/c` is all false.
    - A grid of 5: `/c` is last, and `/d` is all false.
    - One alone is all true.
    - A project off screen is all false.
- [ ] **Step 2: Run** `npm --prefix <worktree> test -- src/renderer/src/projects/layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the e2e tests:**
  - **`tasks.ts`:** `export const ROW_HEIGHT = 46`.
  - **The panels start under the row:**
    - `panel.e2e.ts`'s pinned panel spans `[ROW_HEIGHT, height - 8]`.
    - `manager.e2e.ts`'s fits test: `{ x: rail.x + rail.width + 8, y: ROW_HEIGHT, width: 400, height: height - ROW_HEIGHT - 8 }`.
    - The unpinned manager test: floating, it is as tall as pinned, so `managerTermSize` equals the pinned size.
  - **`app.e2e.ts`, "the window follows its system":**
    - `.top-start`'s `padding-left` is `80px` on darwin and `8px` elsewhere.
    - `.top-row`'s `-webkit-app-region` is `drag` on darwin and `none` elsewhere.
  - **`manager.e2e.ts`:** the window-buttons test becomes "the manager's column sits left of the board under the top row, and its title bar is no drag region".
    - The column's right edge is at most the board's x, and its y is `ROW_HEIGHT`.
    - `manager-title-bar` is 46 px high, and its app-region isn't `drag` on any system.
  - **`session-panel.e2e.ts`:** the drag test becomes "the title bar is no drag region, and its title, actions, fold button and pin sit in one row".
    - `.p-title-bar`'s app-region isn't `drag`.
    - The glyph lines up with `panel-project`.
    - Reopen is 6 px left of `panel-fold`, on its centre line, and `panel-fold` is 6 px left of `panel-pin`.
    - The empty-space hit test and the overlap checks go: they existed for the drag region.
  - **`top-row.e2e.ts`, new:**
    1. "the row holds Projects, then the project's Todo, Manager, name and New task, and Next that needs you at its right end; every panel starts under it"
       - Left to right: `projects-toggle`, `todo-toggle`, `manager-toggle`, `.tb-project`, `new-task`, `jump-next`.
       - All share one centre line (±1), and `jump-next`'s right edge is at least `innerWidth - 20`.
       - `project-rail`, `manager-column` and `side-panel` start at y `ROW_HEIGHT`.
    2. "the first project's part starts right after Projects with the list open or off, the next part lines up with its pane and follows the divider, and Cmd+W hands the first place on" (Review Focus 3). With two projects side by side:
       - **The gap:** `todo.x - (projects.x + projects.width)` equals `manager.x - (todo.x + todo.width)` (±1) for the first pane, with the list open and after `projects-toggle` turns it off. Turn it on again.
       - **The second part:** globex's `project-bar` x equals its pane's x (±1), still after a 100 px divider drag.
       - **Next:** `jump-next` has a count of 1, inside globex's pane.
       - **Cmd+W:** `rail-show` acme, then `Meta+w` on darwin or `Control+Shift+W` elsewhere. globex is alone, its gap matches, and `jump-next` is in globex.
    3. "in the grid, a project in a lower row has its part at its own pane's top, and its buttons act on it"
       - Three projects in the grid: c's `project-bar` y equals c's pane y (±1).
       - c's `todo-toggle` shows c's `todo-panel`, while a's and b's stay hidden.
       - `jump-next` has a count of 1, in b's pane.
    4. "each project's row buttons, folds and strips act on that project only, and a project taken off screen and back keeps its panels as they were" (Review Focus 2). With a, b and c, and b beside a:
       1. a's `manager-toggle` shows a's column but not b's.
       2. a's `todo-toggle`, then `todo-fold`: a's `todo-strip` shows, and b has none.
       3. `rail-show` a, then `rail-show` c (c takes a's place), then `rail-show` a: a's `todo-strip` and `manager-column` are visible, and b is unchanged.
    5. "on the Mac the row is the window's title bar: nothing that takes clicks starts in its first 80 px, and a lower grid row's part doesn't drag". Skipped off darwin, saying CDP can't press native drag regions and Windows and Linux have none.
       - Take the old manager test's loop over no-drag elements, run against `.top-row`'s box: the smallest start is at least 80.
       - The top panes' `project-bar` is `drag`.
       - In a grid of 3, c's isn't.
    6. "Projects turns the list off and on; off, it counts the sessions waiting in projects off screen, and focus in the list goes to it"
       - With two projects, start a task in globex (off screen) through the bridge and report it blocked.
       - Focus acme's `rail-show`, then click `projects-toggle`:
         - `project-rail` is hidden and `projects-toggle` is focused with `aria-pressed` false;
         - the button holds `1`, and its accessible name includes "1 need you";
         - acme's pane x is at most 9.
       - `projects-toggle` again: the list is visible.
- [ ] **Step 4: Implement** (use `frontend-design` for the row, the bars and the projects list's island):
  - **`App`:** in the projects view it renders `TopRow`, `ProjectRail` and `Panes`, with `data-rail` and `--row-start` on `.app`.
  - **`TopRow`:**
    - Projects uses the mockup's `i-proj` icon and the word "Projects", in `.tb-toggle`'s look.
    - `aria-pressed` is `railState() !== 'off'`. The `title` is "Show the projects list" or "Hide the projects list". Mousedown uses `keepFocus`.
    - While the list is off and `offScreenNeedsYou() > 0`, the button shows the count with `aria-label` `${n} need you`.
    - On click: `toggleRail()`. Turning the list off moves the focus to the button when it was in `.rail`.
  - **`Panes`:**
    - Each pane gets `place={panePlace(layout(), project.dir)}`.
    - The grid's template uses `columnsOf(layout())`, and the local `gridColumns` goes.
  - **`ProjectPane`:**
    - **`.project-bar`:** Todo toggle, Manager toggle, a `.tb-sep` divider (aria-hidden), the `.tb-project` chip, New task, then `jump-next` when `place.last`.
    - **`.pane-body`:** `TodoPanel`, `ManagerColumn`, the `board-column` section holding only `.board`, and `SidePanel`, in visual order.
    - `--left-room` moves to `.pane-body`.
    - `.topbar` goes.
  - **`ProjectRail`:**
    - It is an island under the row, rendered while `railState() !== 'off'`.
    - Its `.rail-header` holds an `h2` "Projects" and the arrange group, laid out like the islands' headers.
    - Its doc comment no longer says "under the window buttons".
  - **`app.css`, the row:**
    - **The page:** `:root { --row-height: 46px; }`, `.app { --rail-w: 196px; }`, and `.app[data-rail='off'] { --rail-w: 0px; }`.
    - **`.top-row`:** placed absolute at the window's top left, `--row-height` high, and only as wide as `.top-start`. The panes' bars cover the rest of the row, so nothing lies over their buttons. A full-width row would paint over the bars and take their clicks.
    - **`.top-start`:** padding `6px 0 4px 8px`, with `padding-left: 80px` under `html[data-platform='darwin']`, the window buttons' room moved from `.rail-titlebar`.
    - **The group:** Projects, Todo and Manager read as one group, so the gap from Projects to the first part's Todo equals Todo to Manager.
  - **`app.css`, the panes:**
    - **`.project-pane`:** a column flex, unclipped.
    - **`.pane-body`:** takes the old `.project-pane` box: relative, isolated, a flex row with `overflow: clip`. The focus frame `::after` moves to it ("framed round its islands", as its comment says).
    - **`.project-bar`:**
      - `--row-height` high, with today's `.topbar` look and padding;
      - `container-type: inline-size` and the 560 px word drop, moved from `.board-column`;
      - `.tb-jump { margin-left: auto; }`.
    - **The first bar:** `.project-pane[data-first='true'] > .project-bar { margin-left: calc(var(--row-start) - var(--rail-w)); }`.
    - **Islands and strips:** they start directly under the row: top margin 0, and floating `top: 0`.
    - **The projects list:** its width, margin included, comes from `--rail-w`.
  - **`app.css`, the Mac's drag regions:**
    - One rule: `html[data-platform='darwin'] :is(.setup-titlebar, .top-row, .project-pane[data-top='true'] > .project-bar) { -webkit-app-region: drag; }`.
    - Their children don't drag: `:is(.top-start, .project-bar) > * { -webkit-app-region: no-drag; }`.
    - `.resize-edge { -webkit-app-region: no-drag; }` stays. Its comment says that the pane divider crosses the row.
  - **`main/index.ts`:** the comment on `titleBarStyle` says the window buttons sit at the left of the top row (Decision 7). The option itself is unchanged.
  - **Dead, remove:**
    - **Markup:**
      - `.rail-titlebar`'s markup and its two rules;
      - `.topbar`'s markup.
    - **Drag rules and carve-outs:**
      - `.rail-arrange`'s no-drag line;
      - `.topbar` and `.topbar > *`;
      - the drag selectors and comments for `.todo-tabs`, `.p-title-bar` and `.manager-title-bar`;
      - `.p-title-bar > *` and `.todo-add, .todo-sync`'s no-drag;
      - the islands' no-drag carve-out (`.side-panel, .manager-column, .todo-panel, .ticket-panel`).
    - **Layout rules:**
      - `.board-column`'s `container-type` and its `@container` block (moved);
      - `.manager-column { order: -1; }`, `.todo-panel { order: -2; }`, and the `.manager-strip` and `.todo-strip` order rules;
      - the floating manager's and Todo panel's `top: 46px`, and the "over the pinned manager" `top: 8px` rule.
    - **Comments:**
      - `ProjectPane`'s page-order comments ("macOS carves a drag region only for what comes after it");
      - `ManagerColumn`'s and `TodoPanel`'s "Last in the …, so macOS carves it out" comments;
      - `todo.e2e.ts`'s comments that name the board's top bar.
    - **Renamed selector:** `.project-pane:has(> .side-panel…) .lanes` becomes `.pane-body:has(…)`.
- [ ] **Step 5: Run** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: PASS.
- [ ] **Step 6: Check that the owner's Mainframe isn't running:** the `pgrep` command on its own. Expected: no output.
- [ ] **Step 7: Run** `npm --prefix <worktree> run test:e2e -- e2e/top-row.e2e.ts e2e/app.e2e.ts e2e/manager.e2e.ts e2e/panel.e2e.ts e2e/session-panel.e2e.ts`, then the whole suite. Expected: all pass.
  - Any other test that assumes the panels start 8 px from the top changes to `ROW_HEIGHT`.
  - Any other test that assumes a button sits in the board's top bar is fixed at its cause.
- [ ] **Step 8: Commit.** `git -C <worktree> add -A src e2e`, then `git -C <worktree> commit -m "feat: one row along the window's top holds the window buttons, Projects and each project's buttons above its own pane"`.

### Task 5: The projects list folds

**Files:**
- Modify: `src/renderer/src/projects/ProjectRail.tsx`, `src/renderer/src/app.css`, `e2e/top-row.e2e.ts`

**Interfaces:**
- Consumes: `railState`, `setRailState`, `offScreenNeedsYou` (Task 4); `PanelStrip` and `FoldButton` (Task 1).
- Produces: test ids `rail-fold` and `rail-strip`; `.app[data-rail='folded'] { --rail-w: calc(var(--strip-w) + 8px); }`.

- [ ] **Step 1: Write the e2e tests** in `top-row.e2e.ts`:
  - **New:** "the projects list folds into a strip at the window's left that counts the sessions waiting off screen, and opens again from it; Projects stays lit, and the focus goes from one to the other". With two projects, globex off screen with a blocked session:
    1. `rail-fold`:
       - the island is hidden, and `rail-strip` is focused, 24 px wide, at x 8 (±1) and y `ROW_HEIGHT`;
       - its accessible name is `Show projects, 1 need you`;
       - `projects-toggle` has `aria-pressed` true.
    2. `Control+Tab` brings globex on screen: the strip's name is `Show projects`.
    3. A strip click: the island is visible, and `rail-fold` is focused. `rail-fold` sits right of `arrange-grid`, on its centre line.
    4. `rail-fold`, then `projects-toggle`: no strip and no island.
    5. `projects-toggle` again: the island, not the strip.
  - **Test 2:** its gap check also runs with the list folded.
- [ ] **Step 2: Implement** (use `frontend-design` for the strip's place):
  - `.rail-header` gets a `FoldButton` (`points="left"`, "Fold the projects list") at `right: 8px`, since the list has no pin.
  - While `railState() === 'folded'`, `ProjectRail` renders `PanelStrip`:
    - `side="left"` and the name "Projects";
    - as its mark, the count while `offScreenNeedsYou() > 0`;
    - the label `Show projects`, plus `, ${n} need you` when there is a count.
  - It hands the focus as in Task 1.
  - Add the folded `--rail-w`.
- [ ] **Step 3: Run** `npm --prefix <worktree> test` and `npm --prefix <worktree> run typecheck`. Expected: PASS.
- [ ] **Step 4: Check that the owner's Mainframe isn't running:** the `pgrep` command on its own. Expected: no output.
- [ ] **Step 5: Run** `npm --prefix <worktree> run test:e2e -- e2e/top-row.e2e.ts`, then the whole suite. Expected: all pass.
- [ ] **Step 6: Commit.** `git -C <worktree> add -A src e2e`, then `git -C <worktree> commit -m "feat: the projects list folds into a strip at the window's left that counts the sessions waiting off screen"`.

## Finish (root `CLAUDE.md`)

After Task 5, follow "When `/simplify` and `/code-review high` run" in the root `CLAUDE.md`, in its order:
1. **`/simplify`** on `main...HEAD`. Check its edits, run the three suites (e2e after its own `pgrep` step), commit, and record the tip.
2. **The final whole-branch review.** It asks the two Mainframe questions and judges proportion.
3. **`/code-review high`** on `main...HEAD`. Fix its findings, run the three suites, commit, and record the tip in both files.
4. **The owner's acceptance, on the Mac:**
   - The window buttons sit centred in the row and clear of Projects (Decision 7).
   - The window drags by the row's empty space, and not by a panel header or a lower grid row's part.
   - Every fold, strip and row button works, alone, side by side and in a grid.
   - The slide works with motion, and everything switches at once with reduced motion.
5. **Windows and Linux:** the CI run of the reviewed push shows the row as plain page.
6. **Then:** acceptance fixes count as new work, as the root `CLAUDE.md` says. After them comes `superpowers:finishing-a-development-branch`.

**Dead code found elsewhere:** none in the files read for this plan. `createWindow`'s comment ("the window buttons sit in the manager's column") is stale today; Task 4 rewrites it because it changes those lines.
