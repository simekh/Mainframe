# Reorder Projects in the List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner drags a row in the Projects list (or presses Alt+↑/↓ on it) to reorder the open projects. The
order is saved in `projects.json` and followed by Cmd+1 to Cmd+9.

**Architecture:** Main's `ProjectRegistry` owns the order. A new `move(dir, to)` rebuilds its map and runs
`changed()`, which writes `projects.json` and broadcasts the whole list. The renderer puts the new order in its store
at once (so nothing flickers), calls the new `moveProject` IPC, and lets main's broadcast settle it through the
existing `setProjects` reconcile. The drag uses pointer events with a movement threshold, as `ResizeEdge` does. The
index maths lives in a pure, unit-tested module.

**Tech Stack:** Electron 44, Solid 1.9, TypeScript, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-mainframe-reorder-projects-design.md`

## Global Constraints

- The panes on screen (`layout.shown`) keep their own order. Reordering the list never touches the layout.
- Project-agnostic: no project name, path or setting is added. It works with any number of projects, side by side or
  not.
- A click on a row's name still focuses the project. A drag never does.
- No new dependency.
- Run e2e only after the owner has quit their own Mainframe (Cmd+Q). Ask first.

## Review Focus

1. **The click that ends a drag.** Letting go over the row's `rail-show` button must not focus the dragged project
   (Task 3's e2e drags the unfocused row and checks the focus stays put).
2. **A press that barely moves (under the threshold).** It is a click, and it focuses the project (Task 3's e2e
   covers it with a 2 px move).
3. **Focus after Alt+↑/↓.** Solid moves the row's DOM node, and Chromium drops the focus from a moved node. The
   button has to keep the focus, so a second Alt+↓ moves it again (Task 2's e2e presses twice).
4. **A move to its own place, or past either end.** Nothing is written and nothing is broadcast. Alt+↑ on the first
   row does nothing (Task 1's unit tests, Task 2's store guard).
5. **A drag started on the close or show-beside button, or on a row asking "Close …?".** No drag starts (Task 3:
   the pointerdown handler ignores those targets; the e2e checks that the show-beside button still toggles).

---

### Task 1: Main moves a project and remembers the order

**Files:**
- Modify: `src/main/projectRegistry.ts` (add `move`, and the class comment no longer says "in the order the owner
  opened them")
- Modify: `src/shared/ipc.ts` (channel `moveProject: 'projects:move'`, `MainframeApi.moveProject`; `listProjects`'s
  comment: "in the order the list shows them")
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts` (handler next to `closeProject`)
- Test: `src/main/projectRegistry.test.ts`

**Interfaces:**
- Produces: `ProjectRegistry.move(dir: string, to: number): void` and
  `window.mainframe.moveProject(dir: string, to: number): Promise<void>`

- [ ] **Step 0: Install dependencies in this worktree** (`node_modules` is missing): run `npm ci` and expect it to
  exit 0.

- [ ] **Step 1: Write the failing tests** in `projectRegistry.test.ts`, using the existing `setup()` and a third
  folder `const INITECH = '/work/initech'`:

```ts
it('moves a project to a new place in the list, remembers it, and says so', async () => {
  const { registry, changes, remembered } = setup();
  for (const dir of [ACME, GLOBEX, INITECH]) await registry.open(dir);
  changes.length = 0;
  registry.move(INITECH, 0);
  expect(registry.list().map((p) => p.dir)).toEqual([INITECH, ACME, GLOBEX]);
  expect(remembered()).toEqual([INITECH, ACME, GLOBEX]);
  expect(changes.map((list) => list.map((p) => p.dir))).toEqual([[INITECH, ACME, GLOBEX]]);
  registry.move(INITECH, 2);
  expect(registry.list().map((p) => p.dir)).toEqual([ACME, GLOBEX, INITECH]);
});

it('clamps a move past either end of the list', async () => {
  const { registry } = setup();
  for (const dir of [ACME, GLOBEX, INITECH]) await registry.open(dir);
  registry.move(ACME, 99);
  expect(registry.list().map((p) => p.dir)).toEqual([GLOBEX, INITECH, ACME]);
  registry.move(ACME, -5);
  expect(registry.list().map((p) => p.dir)).toEqual([ACME, GLOBEX, INITECH]);
});

it('does nothing for a folder that is not open, or a move to the place it has', async () => {
  const { registry, changes } = setup();
  for (const dir of [ACME, GLOBEX]) await registry.open(dir);
  changes.length = 0;
  registry.move('/work/gone', 0);
  registry.move(GLOBEX, 1);
  expect(changes).toEqual([]);
  expect(registry.list().map((p) => p.dir)).toEqual([ACME, GLOBEX]);
});
```

- [ ] **Step 2: Run** `npx vitest run src/main/projectRegistry.test.ts`. Expected: the 3 new tests FAIL with
  "registry.move is not a function".

- [ ] **Step 3: Implement `move(dir: string, to: number): void`** on `ProjectRegistry`. It returns if `dir` is not
  in the map. It clamps `to` to `[0, size - 1]` and returns if that equals the current index. Otherwise it rebuilds
  `this.projects` (clear it, then re-set the entries in the new order; it is `readonly` but mutable) and calls
  `this.changed()`. Add `ipcMain.handle(IPC.moveProject, (_e, dir: string, to: number) => projects.move(dir, to))`,
  the preload entry `moveProject: (dir, to) => ipcRenderer.invoke(IPC.moveProject, dir, to)`, and the
  `MainframeApi` member with a one-line comment.

- [ ] **Step 4: Run** `npx vitest run src/main/projectRegistry.test.ts` and `npm run typecheck`. Expected: PASS,
  and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/projectRegistry.ts src/main/projectRegistry.test.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat: main moves an open project to a new place in the list and remembers the order"
```

---

### Task 2: The renderer reorders at once; Alt+↑/↓ moves a row

**Files:**
- Create: `src/renderer/src/projects/railOrder.ts`
- Test: `src/renderer/src/projects/railOrder.test.ts`
- Modify: `src/renderer/src/projects/projectsStore.ts` (add `moveProjectTo`; fix the `projects` field comment,
  "in the order the owner opened them" → "in the order the list shows them")
- Modify: `src/renderer/src/projects/ProjectRail.tsx` (`onKeyDown` on `rail-show`)
- Test: `e2e/projects.e2e.ts`

**Interfaces:**
- Consumes: `window.mainframe.moveProject(dir, to)` (Task 1)
- Produces:
  - `moved<T>(list: readonly T[], from: number, to: number): T[]`, a copy with the item at `from` now at `to`
  - `dropIndex(mids: readonly number[], from: number, center: number): number`, the index the dragged row lands
    at: the count of rows `i !== from` whose midpoint `mids[i]` is above `center`
  - `shiftOf(i: number, from: number, to: number): -1 | 0 | 1`, which way row `i` (not the dragged one) slides
    while row `from` hovers over slot `to`: -1 when `from < i <= to`, 1 when `to <= i < from`, else 0
  - `moveProjectTo(dir: string, to: number): void` in `projectsStore.ts`

- [ ] **Step 1: Write the failing unit tests** in `railOrder.test.ts`:

```ts
it('moved puts the item at its new place', () => {
  expect(moved(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moved(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
});

it('dropIndex counts the other rows whose middle is above the dragged row’s middle', () => {
  const mids = [16, 50, 84];
  expect(dropIndex(mids, 0, 16)).toBe(0);
  expect(dropIndex(mids, 0, 55)).toBe(1);
  expect(dropIndex(mids, 0, 200)).toBe(2);
  expect(dropIndex(mids, 2, 40)).toBe(1);
  expect(dropIndex(mids, 2, -30)).toBe(0);
});

it('shiftOf slides the rows between the dragged row and its slot', () => {
  expect([0, 1, 2, 3].map((i) => shiftOf(i, 0, 2))).toEqual([0, -1, -1, 0]);
  expect([0, 1, 2, 3].map((i) => shiftOf(i, 3, 1))).toEqual([0, 1, 1, 0]);
  expect([0, 1, 2].map((i) => shiftOf(i, 1, 1))).toEqual([0, 0, 0]);
});
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/projects/railOrder.test.ts`. Expected: FAIL, the module is
  not found.

- [ ] **Step 3: Implement the three functions** in `railOrder.ts`, each with a one-line doc comment.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Implement `moveProjectTo(dir, to)`** in `projectsStore.ts`. It finds `from`, the index of `dir` in
  `store.projects`, and returns if `dir` is missing or `to` is outside `[0, length - 1]` or equal to `from`.
  Otherwise it does `setStore('projects', moved(store.projects, from, to))` and then
  `window.mainframe.moveProject(dir, to).catch(...)`, logging as `closeProject` does: `[projects] could not move
  ${dir}: …`. Main's broadcast then reconciles the same order.

- [ ] **Step 6: Write the failing e2e** in `e2e/projects.e2e.ts`:

```ts
test('Alt+Up and Alt+Down on a row move its project in the list, Cmd+1 follows, and a restart keeps the order', async () => {
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page, dataDir } = await launchApp({}, [a, b, c]);
  const order = () => page.getByTestId('rail-project').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-project')));
  await row(page, a).getByTestId('rail-show').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(order).toEqual([b, a, c]);
  await expect(row(page, a).getByTestId('rail-show')).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(order).toEqual([b, c, a]);
  await page.keyboard.press('Alt+ArrowDown'); // already last: nothing moves
  await expect.poll(() => openProjects(dataDir)).toEqual([b, c, a]);
  await page.keyboard.press('ControlOrMeta+1');
  await expect(pane(page, b)).toHaveAttribute('data-focused', 'true');
  await app.close();

  const again = await launchApp({ MAINFRAME_DATA_DIR: dataDir }, openProjects(dataDir));
  await expect.poll(() => again.page.getByTestId('rail-project').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-project')))).toEqual([b, c, a]);
  await again.app.close();
});
```

- [ ] **Step 7: Build and run it.** Ask the owner to quit their Mainframe first. Run
  `npm run build && npx playwright test e2e/projects.e2e.ts -g "Alt\+Up"`. Expected: FAIL at the first order
  check.

- [ ] **Step 8: Implement the key handler** on `rail-show`. On Alt+ArrowUp or Alt+ArrowDown, with no Meta, Ctrl or
  Shift held, it calls `preventDefault()` and `moveProjectTo(project.dir, index() ± 1)` (the `For` callback's second
  argument is the index accessor). Then, in a `queueMicrotask`, it focuses the button again, since moving its DOM
  node drops the focus.

- [ ] **Step 9: Run the e2e again.** Expected: PASS. Also run `npx vitest run` and `npm run typecheck`, and expect
  both to pass.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/projects/railOrder.ts src/renderer/src/projects/railOrder.test.ts src/renderer/src/projects/projectsStore.ts src/renderer/src/projects/ProjectRail.tsx e2e/projects.e2e.ts
git commit -m "feat: Alt+Up and Alt+Down on a row move its project in the projects list"
```

---

### Task 3: Drag a row to reorder

**Files:**
- Modify: `src/renderer/src/projects/ProjectRail.tsx`
- Modify: `src/renderer/src/app.css` (rail rules, around `.rail-item`)
- Test: `e2e/projects.e2e.ts`

**Interfaces:**
- Consumes: `dropIndex`, `shiftOf` (Task 2), `moveProjectTo` (Task 2)

Invoke the `frontend-design:frontend-design` skill for the look of the lifted row and the sliding ones. Keep it
within the existing rail tokens (`--island`, `--island-border`, `--radius-sm`). Under `prefers-reduced-motion`, rows
jump instead of sliding.

- [ ] **Step 1: Write the failing e2e** in `e2e/projects.e2e.ts`:

```ts
test('dragging a row moves its project in the list; a short press is still a click, and a drag focuses nothing', async () => {
  const [a, b, c] = [repo(), repo(), repo()];
  const { app, page, dataDir } = await launchApp({}, [a, b, c]);
  const order = () => page.getByTestId('rail-project').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-project')));
  const drag = async (dir: string, dy: number) => {
    const r = await boxOf(row(page, dir).getByTestId('rail-show'));
    const [x, y] = [r.x + 20, r.y + r.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 8 });
    await page.mouse.up();
  };
  await expect(row(page, a)).toHaveAttribute('data-focused', 'true');

  // c to the top: the focus stays on a.
  const rowStep = (await boxOf(row(page, b))).y - (await boxOf(row(page, a))).y;
  await drag(c, -2 * rowStep);
  await expect.poll(order).toEqual([c, a, b]);
  await expect(row(page, a)).toHaveAttribute('data-focused', 'true');
  await expect.poll(() => openProjects(dataDir)).toEqual([c, a, b]);

  // A 2 px wobble is a click: it focuses b and moves nothing.
  await drag(b, 2);
  await expect(row(page, b)).toHaveAttribute('data-focused', 'true');
  await expect.poll(order).toEqual([c, a, b]);

  // The row's own buttons still work, and don't start a drag.
  await (await rowButton(page, c, 'rail-beside')).click();
  await expect(pane(page, c)).toHaveAttribute('data-shown', 'true');
  await expect.poll(order).toEqual([c, a, b]);
  await app.close();
});
```

- [ ] **Step 2: Build and run it** with `npm run build && npx playwright test e2e/projects.e2e.ts -g "dragging a
  row"`. Expected: FAIL at the first order check.

- [ ] **Step 3: Implement the drag** in `ProjectRail.tsx`:
  - Add one `drag` signal: `{ dir, from, to, dy, slot } | null`.
  - **`onPointerDown` on the `<li>`.** Act only for button 0. Ignore the press when its target is inside
    `.rail-act` or `.rail-confirm`. Remember the start Y and each row's midpoint (from the `<li>` rects of the list).
    Set pointer capture on the `<li>`.
  - **`pointermove`.** Nothing happens until `|dy| >= DRAG_THRESHOLD`, with `const DRAG_THRESHOLD = 4` (px). From
    then on, set `drag` with `to = dropIndex(mids, from, mids[from] + dy)`. `slot` is the dragged row's height plus
    the list's row gap, read from the `.rail-list` computed style.
  - **Styles.** The dragged row gets `transform: translateY(dy px)` and `data-dragging="true"`. Every other row gets
    `translateY(shiftOf(i, from, to) * slot px)`.
  - **`lostpointercapture`.** If a drag started, call `moveProjectTo(dir, to)`, clear `drag`, and swallow the
    `click` that follows: one capture-phase click listener on the `<li>`, with `{ once: true }`, that calls
    `stopPropagation` and `preventDefault`, removed on the next tick if no click came. A press that never passed the
    threshold leaves the click alone.
  - Add CSS for `.rail-item[data-dragging='true']`, which is lifted and above its neighbours, and a short `transform`
    transition on the other rows. There is no transition on the dragged row, and none at all under reduced motion.

- [ ] **Step 4: Run the e2e again.** Expected: PASS. Then run the whole `e2e/projects.e2e.ts`, `npx vitest run` and
  `npm run typecheck`, and expect all to pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/projects/ProjectRail.tsx src/renderer/src/app.css e2e/projects.e2e.ts
git commit -m "feat: drag a row in the projects list to move its project"
```

---

After the last task, follow this repo's `CLAUDE.md`: run `/simplify main...HEAD`, then the final whole-branch review,
then `/code-review high main...HEAD`, before the owner tries it.
