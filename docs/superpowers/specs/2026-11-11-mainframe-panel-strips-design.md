# Mainframe: a top row, and panels that fold into strips

Design, 2026-11-11. Written after a brainstorm with the owner, who compared mockups at each step: labelled strips over one arrow per side or top-bar buttons only; a Firefox-like top row over hiding the Mac's window buttons; labelled row buttons over one group of icons. It changes how the projects list, the Todo panel, the manager's column and the session panel are put away and brought back, and moves the buttons into one row along the window's top. Decisions the owner made are marked **(owner)**. Decisions the designer made on the owner's behalf are marked **(designer's call)**; the owner may overturn them.

Approved mockup: `docs/superpowers/mockups/2026-11-11-panel-strips.html`. Its cards and terminals are made up; the look is the app's current one (`src/renderer/src/app.css`).

## 1. Why

The owner puts panels away to make room on the board **(owner)**. Today each panel comes back a different way:

- **The session panel** (right): unpinned, a pill on its edge hides it, and a half-round tab on the pane's right edge brings it back. Pinned, it can't be put away at all.
- **The manager** (left): a pill on its right edge hides it, pinned or not. A half-round tab on the left edge, carrying the manager's state, brings it back, as does the top bar's Manager button.
- **The Todo panel** (far left): a pill on its right edge hides it, but nothing is left behind. Only the top bar's Todo button brings it back.
- **The projects list** (the window's left): can't be put away. On the Mac it holds the window buttons.

The owner hid the Todo panel with its arrow and reached for the arrow to get it back, because that's what hid it, and found nothing **(owner)**. With Todo out and the manager hidden, Todo's hide pill and the manager's tab stack on the same edge. The owner called several arrows on the left bad UX **(owner)**.

The owner wanted the projects list to fold like the panels, or it would look off beside them **(owner)**. Folding it raised the question of where the Mac's window buttons go. The owner's answer was a row along the window's top, as Firefox has, holding the window buttons and the buttons, with every panel below it **(owner)**. Then the owner found the projects list's button far from Todo and Manager confusing, and asked for the three to sit together **(owner)**.

## 2. Goals, non-goals, anti-goals

**Goals**
- One row along the window's top for the window buttons and the buttons; every panel and strip starts below it **(owner)**.
- The panel buttons, Projects, Todo and Manager, side by side in the panels' order, all labelled, all meaning on/off **(owner)**.
- A folded panel comes back from right where it went: its strip **(owner)**.
- One rule for all four panels, pinned or not.
- Never two controls stacked on one edge.

**Non-goals**
- Keyboard shortcuts for folding or turning off, or menu items. Not asked for.
- Saving the folded state across restarts (§5).
- Changing what pinning does, the panels' widths, or how a floating panel slides.
- A row button for the session panel.

**Anti-goals**
- Any arrow or tab left on a panel's edge or on the pane's edge.
- Hiding the Mac's window buttons.
- A folded panel that resizes its terminal. Folding hides a panel the way hiding does today: by moving it and turning it invisible, never by changing its size, so its terminal keeps its size and output.
- The keyboard ending up in a folded or off panel.
- A row button that can't tell which project it belongs to (`CLAUDE.md`: several projects in one window).

## 3. The top row

### 3.1 What it holds

From left to right:
1. **The window buttons** (on the Mac).
2. **[Projects] [Todo] [Manager]**, each with its icon and word, lit while its panel is on (§4).
3. **The project's name and New task,** as the board's top bar holds them today.
4. **Next that needs you,** once, at the row's right end. It jumps across every open project, so it is the window's, not one per project **(designer's call)**.

The board's top bar moves up into this row. Its buttons span the whole project, not just the board.

### 3.2 With several projects

- **Each project's part of the row sits above its own pane** and holds that project's [Todo] [Manager], name and New task. The left end, with the window buttons and [Projects], belongs to the window and appears once, and so does Next that needs you at the right end.
- **Side by side,** the parts line up into one row along the window's top (mockup step 6).
- **In a grid,** a project in a lower row of the grid has its part as a row of its own at its top, the same height (mockup step 7) **(designer's call)**. Every project's buttons are then above its own panels.
- **The first project's part always starts right after the left end,** whether the projects list is open, folded or off. That keeps Projects, Todo and Manager together, as the owner asked (mockup steps 1 and 3). The first project's part therefore doesn't line up with its pane's left edge; the parts after it do **(designer's call)**. Starting above the first pane instead would leave about 110 px between Projects and Todo on Windows and Linux, where the row has no window buttons.
- Where a project's part is narrow, words drop as the top bar's hints do today.

### 3.3 The window's edge

- **On the Mac,** the row is the window's title bar. Its empty space drags the window, and the window buttons sit in it, centred on the row's height. The panels' header rows stop being drag regions.
- **On Windows and Linux,** the system's title bar stays above the page, and the row is plain page under it, the same as on the Mac without the window buttons.

### 3.4 The cost

The panels' header rows no longer double as the window's top edge, so the panels and their terminals get about one row shorter. The owner accepted this with the top-row mockup.

## 4. The panels

### 4.1 Three states, two for the session panel

| State | Projects list, Todo panel, manager | Session panel |
|---|---|---|
| **Open** | The panel. The Todo panel and the manager can be pinned beside the board or float over it, as today. The projects list is always in the layout, as now. | Same, pinned or floating as today. |
| **Folded** | A narrow labelled strip in the panel's place. | Same. |
| **Off** | Nothing at all: no panel, no strip. | Doesn't exist: it has no row button. |

### 4.2 What moves between them

- **The fold button** in each panel's header: open → folded. Its chevron points the way the panel folds: « on the projects list, the Todo panel and the manager, » on the session panel.
  - It sits beside the pin. The pin keeps its place.
  - The projects list has no pin. Its header holds its name, the two layout buttons (side by side, grid) and «.
- **The strip,** all of it one button: folded → open.
- **The row button** (Projects, Todo, Manager): off → open; open or folded → off. Turning a panel on opens it fully, never as a strip **(designer's call)**. The button stays lit while its panel is on, folded or open.
- **An off button still shows what matters** **(designer's call)**. Manager shows the manager's state glyph, so a manager waiting for you still shows. Projects shows the count its strip would (§6).
- **A click on the board** outside any card, as today, puts away the floating panels. A floating panel goes back into its strip; it doesn't turn off.
- **Selecting a card** opens the session panel if it is folded, as selecting one opens the floating panel today **(designer's call)**.
- **Anything that puts the keyboard into a panel opens it first** if it is folded. For example, Cmd+1–9 (Ctrl+1–9 on Windows and Linux) puts the cursor in the manager's terminal when no task is selected (`focusProject` in `projectsStore.ts`). Ctrl+Tab still skips the manager, as now.
- **Focus hand-off stays as today:** folding puts the focus on the strip, opening from the strip puts it on the fold button, and turning a panel off puts it on its row button.
- **The Todo panel's open ticket closes** when the panel folds or turns off, as hiding it does today.

### 4.3 Where the strips sit

In the panel's own place, in the layout like a pinned panel, not floating over the board:
- **Left to right:** the projects list's strip at the window's far left, then in each pane the Todo panel's and the manager's. The session panel's is at the pane's far right. A strip whose panel is off is gone, and the next one moves into its place.
- **A floating panel** slides out over the board beside its strip (mockup step 4). The strip stays put while the panel is out.
- **Each project pane has its own strips,** on its own edges. The projects list's strip is the window's, once.

## 5. What is remembered

Nothing new is saved **(designer's call)**:
- Whether the manager is on or off, alone or beside other projects, stays in the layout exactly as it does now.
- The Todo panel starts on if pinned and off if not, as now.
- The projects list starts on and open.

What a panel that is on looks like at launch follows from its pin as shown, not just the owner's pin. A pane too narrow to pin the session panel makes it float (`roomToPin()`), and that counts as floating here **(designer's call)**:
- **Pinned as shown:** it starts open.
- **Floating:** it starts folded, so no panel opens over the board by itself at launch. Today the unpinned session panel starts hidden, and a click on the board turns the floating manager off and saves that. Starting folded keeps both out of the way now that the click folds instead.

Its state then changes only by the moves in §4.2.

## 6. The look

- **The row** is the board's top bar stretched across the window. It's about as tall as today's title rows, and uses the same button styles. The panel buttons look like today's Todo and Manager toggles: an icon and a word, lit with the accent while on. A thin divider separates them from the project's name.
- **The projects list becomes an island** like the other panels, with a header like theirs **(designer's call, following the mockup)**. The rest stays as today: the projects, their counts, Show beside, Close, Open project.
- **The strip** is the panel folded: an island like the panels (their background, border, radius and margins), the full height below the row, as narrow as its vertical label allows (about 20–24 px).
- **Top to bottom, the strip holds** a chevron pointing toward the board, then a mark, then the name written vertically.
  - **The mark:** the manager's and the session panel's state glyph, or for the projects list the number of sessions needing you in projects that aren't on screen (none when all are on screen) **(designer's call)**.
- **Names:** "Projects", "Todo", "Manager", and the selected session's title (cut short with an ellipsis), or "Session" when none is selected **(designer's call)**.
- **On hover,** the strip lightens as the pins and buttons do. Its accessible name says what it opens and the state, e.g. "Show manager, Waiting for you".
- **The fold button** looks like the pin: same size, same quiet colour, same hover.
- **Motion:** where motion is allowed, opening and folding use the panels' existing slide (220 ms) and fade. With reduced motion, they switch at once.

## 7. Constraints

- **Mainframe's two rules** (`CLAUDE.md`): nothing names a project, and everything works with several projects side by side. Each project's row buttons act only on the project below them; the Projects button and the projects list are the window's.
- **Header room:** each header must still fit at its panel's narrowest width without wrapping or clipping, now with one more button. The tight one is the Todo panel's (Todo, Quick Add, Sync, fold, pin, at 280 px).
- **Width rules:** a strip takes room. The pane's width rules count the strips that are showing:
  - the board's room beside pinned panels;
  - the session panel's pin falling back to floating when there's no room;
  - the manager's and the Todo panel's clamps.
  The projects list on, folded or off changes the panes' widths, which each pane already measures itself.
- **A folded pinned session panel gives the board its room,** as a folded pinned manager or Todo panel does.
- **Terminals keep their size** while folded (anti-goal above). The manager's terminal is selected for output only while the column is open and the pane is on screen, as now.
- **The Mac's window buttons** must sit centred in the row and never over a button. Check Electron's current docs for placing them (`trafficLightPosition` / `setWindowButtonPosition`) before relying on either.

## 8. What goes away

All of this exists only for the arrows, the tabs, or the panels' header rows being the window's title bar, and is dead once they go:
- **The hide pills** (`.panel-hide`, test ids `panel-hide`, `manager-hide` and the Todo panel's).
- **The way-back tabs** (`.panel-show`, `panel-show`, `manager-show`).
- **The tabs' positioning rules:** `--left-room`, the "level with the floating manager's arrow" and "below the hide pill" offsets, and the z-index raises that exist only so the tabs and pills don't poke through.
- **The board's own top bar** and the projects list's title row (`.rail-titlebar`, with its 80 px for the window buttons). Their contents move to the row and the list's header.
- **What made the panels' header rows a drag region on the Mac:**
  - the `-webkit-app-region` rules on those rows;
  - the no-drag carve-outs for the islands;
  - the page-order workarounds noted in `ProjectPane.tsx` ("macOS carves a drag region only for what comes after it").
  Check each before removing it: some may still be needed for the row.
- **The e2e checks that drive the old controls,** rewritten for the row buttons, fold buttons and strips.
- **`THIRD_PARTY_NOTICES.md`:** the hide pill's CSS is adapted from Parallel Code. If the notices name that part on its own, its entry changes with it.

## 9. A separate bug: the pane that stops short of the window

The owner's first screenshot shows the session panel's tab about 133 px in from the window's right edge. The tab is where it should be. **The whole project pane is narrower than the window:** the board's lanes end at the tab, and the window's background goes on past it.

The likely cause is `Panes.tsx`: side by side, each pane gets `flex: <weight> 1 0`. Dragging a divider sets weights relative to each other: the two panes beside it keep their sum, so one may drop below 1. In CSS, when the grow factors of a row's items add up to less than 1, they share out only that fraction of the free space.

So a pane whose weight fell below 1 leaves a gap when it is shown alone, or beside another pane whose weights add up to less than 1. The fix is to normalize the shown panes' weights.

This is a different change from the strips. It gets its own small branch and its own test, and goes before the strips **(owner, 2026-11-11)**. Reproduce it first: two projects side by side, drag the divider, then show one of them alone.

Reading the code bears this out. `toggleBeside` can leave a pane with a weight below 1 alone, and `focusOn` can copy that weight to another project. Either way, the shown panes' grow factors add up to less than 1.

If that doesn't reproduce it, the cause is something else. The screenshot still shows a pane short of the window, so look again before the strips' edge tests are written. Those tests check that each strip sits on its pane's edge, which can't be done reliably while a pane can stop short.

## 10. Left to the builder

- **Sizes:** the row's exact height, the fold button's icon, and the strip's exact width and spacing, within §6.
- **The strip's label:** whether it reads bottom-to-top or top-to-bottom.
- **The Todo header at 280 px:** how it makes room. The top bar already drops its hints' words where the pane is narrow, so the same approach fits here.
- **State in code:** how the panels' open/folded/off state is held. The panels already share `PanelPrefs`, the pin, and the layout's manager on/off.
- **The row's structure:** how it is built so that each project's part sits above its pane, side by side and in a grid, and follows the panes' divider when it is dragged.
- **The tests:**
  - unit tests for the width rules with strips counted;
  - e2e for each move in §4.2, with two projects side by side and in a grid;
  - e2e that the row buttons act on their own project;
  - e2e that focus is never left in a folded or off panel.
