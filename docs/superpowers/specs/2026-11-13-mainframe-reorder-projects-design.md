# Reorder projects in the list by drag (short design)

## Intent

The owner wants to put the open projects in the order they like by dragging a row up or down in the Projects list,
instead of being stuck with the order they opened them in. A click on a row keeps focusing the project, as it does now.

## Goals

- Drag a row in the Projects list to a new place. The rows make room as it moves, and it drops where it is let go.
- The new order lasts: it is saved in `projects.json` and comes back at the next start.
- Cmd+1 to Cmd+9 (Ctrl on Windows and Linux) follow the new order, as they already follow the list.
- Alt+↑ / Alt+↓ on a row's button moves that project one place up or down (my call: a few lines, and it lets the
  owner reorder without a mouse).

## Non-goals

- The panes on screen keep their own left-to-right order (`layout.shown`). Reordering the list doesn't move a pane
  (owner picked option A on 2026-11-13).
- No drag between windows, and no dragging a pane in or out of the screen from the list.

## Anti-goals

- A click that is read as a drag, or a drag that also focuses the project.
- An order that shows on screen but is lost at Quit, or that differs between the list and Cmd+N.

## Constraints

- Main owns the order: `ProjectRegistry` keeps the open projects in a `Map` and writes `projects.json` on every change.
  The renderer only shows what `onProjects` sends.
- It has to work with several projects open side by side. The list is the window's single list, so nothing in it can
  depend on a project being on screen.
- It has to be project-agnostic: it names no project and adds no setting.

## Approaches

- **Pointer events with a small movement threshold (picked).** This works like the pane divider's drag
  (`ResizeEdge`). A press that moves a few pixels becomes a drag, the other rows shift to make room, and letting go
  sends the move. Anything shorter is a click. This gives full control over how a click differs from a drag and over
  how the rows look while one is dragged.
- **HTML5 drag and drop.** This comes built in, but the browser's ghost image and drop effects are hard to style. It
  also fires `click` in ways that clash with the row's focus button.
- **Move up / down buttons only.** This is the simplest, but it isn't what was asked for. The keyboard moves above
  cover that need anyway.

## Design

- **Main.** `ProjectRegistry.move(dir, to)` rebuilds the map with `dir` at index `to` (clamped to the list). It then
  runs `changed()`, which writes `projects.json` and sends the whole list. An unknown folder, or a move to the place
  it already has, does nothing. A new IPC call, `moveProject(dir, to)`, is wired through `shared/ipc.ts`, the preload
  and `ipc.ts`.
- **Renderer.** `ProjectRail` rows start a drag on pointerdown past the threshold, but not from the close or
  show-beside buttons, and not while a row is asking "Close …?". On drop it calls `moveProject`. To avoid a flicker
  while main replies, it may put the new order in the store at once. `setProjects` already reconciles by `dir`, so
  main's reply settles it either way. If a project opens or closes mid-drag, the move uses the list as it is at the
  drop.
- **Keyboard.** Alt+↑ / Alt+↓ on `rail-show` calls the same move with ±1.

## Left to the builder

- The exact threshold, and how the dragged row looks: lifted, following the pointer, the others sliding. This goes
  through `frontend-design` and the existing rail styles.
- How to split the drop-index maths into a pure, unit-tested function.
- Tests: unit tests for `ProjectRegistry.move` (order, file, broadcast, unknown folder, clamping) and for the index
  maths; an e2e test that drags a row and checks the list order and Cmd+1.
