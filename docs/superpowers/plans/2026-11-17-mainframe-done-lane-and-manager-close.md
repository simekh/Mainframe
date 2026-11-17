# Done lane and manager close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running task that Mainframe proved merged leaves Needs you for a Done lane, and the manager gets a `close_session` tool that does what the owner's Close session button does.

**Architecture:** Main: `TaskService` runs its check round when a session reports `done`, reports `merged` to the manager, and gains one method that closes a session only when its turn is over. The MCP tool is a thin wrapper round that method. Renderer: `laneOf` sends the cards that say Merged today to a fourth lane, which `Board` draws only while it holds a card.

**Tech Stack:** TypeScript, Electron, Solid, vitest, Playwright, `@modelcontextprotocol/server`, zod.

**Spec:** `docs/superpowers/specs/2026-11-17-mainframe-done-lane-and-manager-close-design.md`

## Global Constraints

- Mainframe never ends a running session on its own: only the owner's buttons and `close_session` do.
- `close_session` deletes nothing and adds no Discard or Put back path.
- Nothing names a project, a branch, a language or a plugin. Each project's manager reaches only its own project's tasks.
- The owner's Close session button and `TaskService.close` keep their behaviour.
- Commands use absolute paths; the worktree is `/Users/simonekholm/Developer/Simmesolo/Mainframe/.claude/worktrees/manager-closes-done-tasks` (`$W` below). It has no `node_modules` yet: run `npm --prefix $W ci` once before Task 1.
- Unit tests: `npm --prefix $W test -- <file>`. Typecheck: `npm --prefix $W run typecheck`. e2e: `npm --prefix $W run test:e2e -- <file>`, and only after the owner has quit their own Mainframe.
- Commit messages carry no tool or AI attribution.

## Review Focus

1. **A list a moment old.** A session that was `done` when the manager listed it and is `working` when it calls `close_session` is refused and not killed. (Task 1)
2. **Two projects open.** A task id of another open project is unknown to this project's `close_session`, and that task's session keeps running. (Task 1)
3. **Closing twice.** A second `close_session` for a session already told to end is refused and sends no second kill. (Task 1)
4. **Several tasks finishing at once.** A burst of `done` reports starts at most one round and queues one more, not one fetch each. (Task 1)
5. **A merged task that asks.** A merged task whose session is `blocked` or `error`, or is being put back, is in Needs you, not Done. (Task 3)

---

### Task 1: TaskService: a round on `done`, `merged` in the reports, and a guarded close

**Files:**
- Modify: `src/main/tasks/carryOn.ts` (`TurnTracker`)
- Modify: `src/main/tasks/taskService.ts` (`SessionReport`, `reports`, `noteStatus`, new method next to `close`)
- Test: `src/main/tasks/carryOn.test.ts`, `src/main/tasks/taskService.test.ts`

**Interfaces:**
- Produces: `SessionReport.merged: boolean`
- Produces: `TaskService.closeWhenTurnOver(taskId: string): { title: string; msg: string | null; merged: boolean }`; throws `Error` with a sentence for the manager on every refusal.
- Produces: `TurnTracker.over(startedWithPrompt: boolean): boolean`

- [ ] **Step 1: Write the failing tests**

In `carryOn.test.ts`:

```ts
it('a turn is over on done or error, and on idle once it had a turn or had no prompt to take', () => {
  const over = (states: (ProgramState | null)[], startedWithPrompt = true) => {
    const turn = new TurnTracker(false);
    for (const s of states) turn.note(s);
    return turn.over(startedWithPrompt);
  };
  expect(over(['working', 'done'])).toBe(true);
  expect(over(['working', 'error'])).toBe(true);
  expect(over(['working', 'idle'])).toBe(true);
  expect(over(['idle'], false)).toBe(true);
  expect(over([])).toBe(false);
  expect(over(['idle'])).toBe(false); // the opening prompt is not taken yet
  expect(over(['working'])).toBe(false);
  expect(over(['done', 'blocked'])).toBe(false);
});
```

In `taskService.test.ts`, using `roundSetup()`, `NEW_TASK`, `MERGED`, `t.sessionStarted`, `t.statuses`, `t.killed`, `t.make` as the tests around line 1730 do (`vi` joins the file's vitest import). `sid` is `view.session!.id`; a second project's service on the same records is `t.make(records, otherDir)`:

```ts
it('a session that reports done starts a round, so a merged task is marked without waiting for the timer', async () => {
  // start, sessionStarted, states.set(view.branch, MERGED)
  t.service.noteStatus(sid, 'working');
  await Promise.resolve();
  expect(t.checked).toEqual([]);
  t.service.noteStatus(sid, 'done');
  await vi.waitFor(() => expect(t.service.list()[0].merged).toBe(true));
});

it('a burst of done reports starts one round and queues one more', async () => {
  // three started tasks; count fetchBase calls through roundSetup({ fetchBase: async () => { fetches++; } })
  for (const id of sids) t.service.noteStatus(id, 'done');
  await t.service.checkRound();
  expect(fetches).toBeLessThanOrEqual(2);
});

it("reports say whether a running task is marked merged", async () => {
  // merged running task after a round
  expect(t.service.reports()[0].merged).toBe(true);
  // and false for a task the round did not mark
});

describe('closeWhenTurnOver', () => {
  it('closes a session whose turn is over, as close does, and says what it closed', async () => {
    t.statuses.set(sid, { id: '', state: 'done', msg: 'All merged', updatedAt: 1 });
    t.service.noteStatus(sid, 'working');
    t.service.noteStatus(sid, 'done');
    expect(t.service.closeWhenTurnOver(view.id)).toEqual({ title: 'Fix login', msg: 'All merged', merged: false });
    expect(t.killed).toEqual([sid]);
    expect(t.readState()[0]).toMatchObject({ open: false });
  });

  it('says merged for a task the round marked', ...);            // merged: true

  it('refuses a session in a turn, and leaves it running', () => {
    // after noteStatus(sid, 'done') then noteStatus(sid, 'working'): the list the manager read is old
    expect(() => t.service.closeWhenTurnOver(view.id)).toThrow("Fix login's session is working; it can be closed once its turn is over.");
    // blocked -> "Fix login's session is waiting for the owner's answer; it can be closed once its turn is over."
    // no report yet, or idle before the opening prompt took -> "Fix login's session is still starting; it can be closed once its turn is over."
    expect(t.killed).toEqual([]);
    expect(t.readState()[0]).toMatchObject({ open: true });
  });

  it('refuses a second close of a session already told to end, without a second kill', () => {
    // closeWhenTurnOver once, then again before onSessionExit
    expect(() => t.service.closeWhenTurnOver(view.id)).toThrow("Fix login's session is already closing.");
    expect(t.killed).toEqual([sid]);
  });

  it('refuses a task with no session, saying where it is', async () => {
    // paused -> 'Fix login has no session running: it is paused.'
    // likewise 'put back', 'finished', 'discarded'
  });

  it('refuses a task that is being put back', ...);              // 'Fix login is being put back'

  it("does not know another open project's task, whose session keeps running", async () => {
    // a second service on the same records, as pausedTask's `service` option uses: other = t.make(...)
    expect(() => other.closeWhenTurnOver(view.id)).toThrow(`Unknown task ${view.id}`);
    expect(t.killed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm --prefix $W test -- src/main/tasks/carryOn.test.ts src/main/tasks/taskService.test.ts`
Expected: FAIL, `turn.over is not a function`, `closeWhenTurnOver is not a function`, `merged` missing.

- [ ] **Step 3: `TurnTracker.over(startedWithPrompt: boolean): boolean` in `carryOn.ts`**

True when the last noted state is `done` or `error`, or is `idle` and either the tracker has noted a state other than `idle`/null before, or `startedWithPrompt` is false. This mirrors the board's "Starting…" rule in `src/renderer/src/board/lanes.ts` (`standingOf`). False once `ending`.

- [ ] **Step 4: `SessionReport.merged` and the round on `done` in `taskService.ts`**

- `merged: boolean` on `SessionReport`, documented "A running task the last round found had nothing to lose"; `reports()` fills it from `this.merged`.
- In `noteStatus`: a `done` report starts `void this.checkRound()`, except for a Put back's session (its close starts one) and once the session is ending.

- [ ] **Step 5: `closeWhenTurnOver(taskId)` in `taskService.ts`, after `close`**

In this order: `this.find(taskId)` (its `Unknown task` error stands); no session → `` `${title} has no session running: it is ${where}.` `` with `where` one of `paused`, `put back`, `finished`, `discarded`; being put back → `` `${title} is being put back` ``; `session.turn.ending` → `` `${title}'s session is already closing.` ``; `!session.turn.over(session.startedWithPrompt)` → `` `${title}'s session is ${what}; it can be closed once its turn is over.` `` with `what` = `working`, `waiting for the owner's answer` (blocked) or `still starting`, from `this.deps.status(session.id)?.state`. Otherwise read `msg` and `merged` first, call `this.close(taskId)`, and return `{ title, msg, merged }`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npm --prefix $W test -- src/main/tasks` and `npm --prefix $W run typecheck`
Expected: PASS; typecheck fails only in `managerTools.test.ts`'s `REPORT` fixture (no `merged`), fixed in Task 2. If it fails anywhere else, fix it here.

- [ ] **Step 7: Commit**

`git -C $W add src/main/tasks` then `git -C $W commit -m "tasks: a done report starts a check round, reports say merged, and closeWhenTurnOver closes only a session whose turn is over"`

---

### Task 2: The manager's `close_session` tool

**Files:**
- Modify: `src/main/mcp/managerTools.ts`, `src/main/agents/claude.ts` (`MANAGER_ALLOWED_TOOLS` and its comment), `src/main/agents/opencode.ts` (`MANAGER_RULES` and its comment), `src/main/manager/rolePrompt.ts`
- Test: `src/main/mcp/managerTools.test.ts`, `src/main/agents/claude.test.ts`, `src/main/agents/opencode.test.ts`, `src/main/manager/managerService.test.ts`, `e2e/manager.e2e.ts`, `e2e/agents.e2e.ts`

**Interfaces:**
- Consumes: `TaskService.closeWhenTurnOver`, `SessionReport.merged` (Task 1).
- Produces: MCP tool `close_session`, input `{ taskId: string }`, result `{ taskId, title, msg, merged }` as JSON text, or `isError: true` with the refusal's sentence.

- [ ] **Step 1: Write the failing unit tests**

`managerTools.test.ts`: add `merged: false` to `REPORT`; give `setup` a `close?: (taskId: string) => { title: string; msg: string | null; merged: boolean }` override wired to `closeWhenTurnOver`, recording `'close'` in `calls`.

```ts
it('registers list_sessions, start_task, sync_todo and close_session, and nothing else, each with a description', () => {
  expect([...tools.keys()]).toEqual(['list_sessions', 'start_task', 'sync_todo', 'close_session']);
});

it('list_sessions says what merged means', () => {
  expect(tools.get('list_sessions')!.config.description).toContain('merged: true once Mainframe found its branch merged with nothing uncommitted');
});

it('close_session closes the task it is given and returns what was closed', async () => {
  const { call, calls } = setup({ close: () => ({ title: 'Fix login', msg: 'All merged', merged: true }) });
  expect(json(await call('close_session', { taskId: 'task-1' }))).toEqual({ taskId: 'task-1', title: 'Fix login', msg: 'All merged', merged: true });
  expect(calls).toEqual(['close']);
});

it("close_session passes a refusal on as an error, in the service's words", async () => {
  const { call } = setup({ close: () => { throw new Error("Fix login's session is working; it can be closed once its turn is over."); } });
  const result = await call('close_session', { taskId: 'task-1' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe("Fix login's session is working; it can be closed once its turn is over.");
});

it('close_session is for when the owner asks, and says it deletes nothing', () => {
  const d = tools.get('close_session')!.config.description;
  expect(d).toContain('Only when the owner asks for it');
  expect(d).toContain('nothing is deleted');
});
```

Agents and prompt, changing the existing assertions:
- `opencode.test.ts` `RULES`: add `{ action: 'mainframe_close_session', resource: '*', effect: 'allow' }` after `mainframe_sync_todo`.
- `managerService.test.ts` (the allow-list test near line 134) and `e2e/manager.e2e.ts:74`: `['mcp__mainframe__list_sessions', 'mcp__mainframe__sync_todo', 'mcp__mainframe__close_session']`.
- `e2e/agents.e2e.ts` (near line 141): the same rule added.
- `claude.test.ts` "rolePrompt with Claude's words": the second paragraph becomes the sentence in Step 3.

- [ ] **Step 2: Run and see them fail**

Run: `npm --prefix $W test -- src/main/mcp src/main/agents src/main/manager`
Expected: FAIL on the tool list, the rules, the allow list and the prompt text.

- [ ] **Step 3: Implement**

- `managerTools.ts`: `tasks` becomes `Pick<TaskService, 'reports' | 'start' | 'startCheck' | 'closeWhenTurnOver'>`. Register `close_session` last, `inputSchema: z.object({ taskId: z.string() })`, handler `text({ taskId, ...tasks.closeWhenTurnOver(taskId) })` with `failure(err)` on a throw. Update the function's doc comment. Descriptions, exact:
  - `close_session`: `"Closes a task's session, as the owner's Close session button does: the session ends and nothing is deleted. The task goes to Paused, or to Finished once Mainframe finds its branch merged with nothing uncommitted; the owner can reopen it either way. Only when the owner asks for it. taskId is the one list_sessions gives. Refused while the session is working, waiting for the owner's answer, still starting or being put back: say so to the owner rather than try again. Returns the task's title, its last message, and merged: whether it goes to Finished."`
  - `list_sessions`: after `"…its last reported state (…) and message,"` insert `" merged: true once Mainframe found its branch merged with nothing uncommitted while it runs (its card is then in the board's Done lane),"`.
- `claude.ts`: add `'mcp__mainframe__close_session'` to `MANAGER_ALLOWED_TOOLS`; the comment adds why: a close is undone with Reopen and deletes nothing.
- `opencode.ts`: the rule above, `allow`; the comment says closing does not ask for the same reason.
- `rolePrompt.ts`, second paragraph, exact: `"The owner talks to you about their to-do list, about the work in progress, and about work that has no task yet. Mainframe's tools (mainframe) let you list the task sessions, start new ones, close one, and sync the Todo panel's list. Start or close a session only when the owner asks you to."`

- [ ] **Step 4: Run the unit tests and the typecheck**

Run: `npm --prefix $W test` and `npm --prefix $W run typecheck`
Expected: PASS, both.

- [ ] **Step 5: e2e in `e2e/manager.e2e.ts`**

Change the listed tools at line 105 to the four names, and add:

```ts
test('close_session closes a session that finished its turn, and refuses one that is working', async () => {
  // launchApp, wait for the manager, startTask 'Alpha' and 'Beta'
  await sendLine(page, alpha, report('working'));
  await sendLine(page, alpha, report('done:msg=QWxsIGRvbmU=')); // "All done", base64 as the report carries it
  await sendLine(page, beta, report('working'));
  await expect(cardIn(page, 'needs-you', alpha)).toHaveCount(1);

  expect(await callTool(dataDir, 'close_session', { taskId: alpha })).toEqual({ taskId: alpha, title: 'Alpha', msg: 'All done', merged: false });
  await expect(cardIn(page, 'paused', alpha)).toHaveCount(1);

  const refused = await mcpCall(dataDir, 'tools/call', { name: 'close_session', arguments: { taskId: beta } });
  expect(refused.body!.result!.isError).toBe(true);
  expect(refused.body!.result!.content![0].text).toContain("Beta's session is working");
  await expect(cardIn(page, 'working', beta)).toHaveCount(1);
});
```

Run: `npm --prefix $W run test:e2e -- e2e/manager.e2e.ts e2e/agents.e2e.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

`git -C $W add src e2e` then `git -C $W commit -m "manager: a close_session tool that closes a session whose turn is over, allowed without asking on both agents"`

---

### Task 3: The Done lane

**Files:**
- Modify: `src/renderer/src/board/lanes.ts` (`Lane`, `laneOf`, `cardAsk`, `laneOrder`), `src/renderer/src/board/Board.tsx` (`LANES`, the lane's `Show`), `e2e/tasks.ts` (`cardIn`'s lane type gains `'done'`)
- Modify: `README.md` (line 5's list of lanes; line 98's sentence on a running merged task), `docs/superpowers/specs/2026-11-16-mainframe-finished-tasks-design.md` (one dated line under the title pointing to the new spec: a running merged task's card now sits in Done)
- Test: `src/renderer/src/board/lanes.test.ts`, `e2e/board.e2e.ts`

**Interfaces:**
- Produces: `Lane = 'needs-you' | 'working' | 'paused' | 'done'`; `laneOrder(...)` returns a `done` array too.

- [ ] **Step 1: Write the failing unit tests in `lanes.test.ts`**

Replace the `cardAsk` cases that pass a merged task with lane `'needs-you'` (lines 146-175) by these, with the file's own `task`, `state` helpers:

```ts
describe('the Done lane', () => {
  const merged = task({ merged: true });
  it('holds a merged running task whose turn is over', () => {
    expect(laneOf(merged, state('done'))).toBe('done');
    expect(laneOf(merged, state('idle'))).toBe('done');
  });
  it('gives a merged task back when it works again, asks, stops, or is being put back', () => {
    expect(laneOf(merged, state('working'))).toBe('working');
    expect(laneOf(merged, state('blocked', { kind: 'question' }))).toBe('needs-you');
    expect(laneOf(merged, state('blocked', { kind: 'permission' }))).toBe('needs-you');
    expect(laneOf(merged, state('error'))).toBe('needs-you');
    expect(laneOf(task({ merged: true, puttingBack: true }), state('done'))).toBe('needs-you');
  });
  it('leaves an unmerged task that finished its turn in Needs you', () => {
    expect(laneOf(task(), state('done'))).toBe('needs-you');
  });
  it('a Done card says Merged and offers Finish', () => {
    expect(cardAsk(merged, state('done'), 'done')).toEqual({ text: 'Merged', tone: 'success', act: 'finish' });
  });
  it('a merged card in Needs you offers Answer under its own label', () => {
    expect(cardAsk(merged, state('blocked'), 'needs-you')).toEqual({ text: 'Needs input', tone: 'warn', act: 'answer' });
  });
  it('laneOrder puts Done cards in done, oldest first, and out of needs-you', () => {
    // two merged done tasks (createdAt 2 and 1) and one unmerged done task
    expect(lanes.done.map((t) => t.id)).toEqual([older.id, newer.id]);
    expect(lanes['needs-you'].map((t) => t.id)).toEqual([unmerged.id]);
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npm --prefix $W test -- src/renderer/src/board/lanes.test.ts`
Expected: FAIL, `laneOf` returns `needs-you`, `lanes.done` undefined.

- [ ] **Step 3: Implement in `lanes.ts`**

- `laneOf` returns `'done'` for exactly the condition `cardAsk` tests today (`task.merged && !task.puttingBack` and standing `done` or `waiting`); otherwise the table's lane.
- `cardAsk`: lane `'done'` returns the Merged/Finish row. The merged branch under `lane === 'needs-you'` can no longer be hit: remove it, and reword the doc comment.
- `laneOrder`: a `done` array, sorted by `createdAt` ascending. Update its doc comment.
- `needsYou`, `needsYouCount` and `jumpToNeedsYou` in `tasksStore.ts` read `laneOrder(...)['needs-you']` and need no change.

- [ ] **Step 4: Implement in `Board.tsx`**

`LANES` gains `{ lane: 'done', name: 'Done', empty: '' }` last. The Done `section` is rendered only while `order().done.length > 0`; the other three always. No stylesheet change: `.lane` already shares the row, and `.lanes` scrolls sideways when four don't fit.

- [ ] **Step 5: Run the unit tests and the typecheck**

Run: `npm --prefix $W test` and `npm --prefix $W run typecheck`
Expected: PASS, both.

- [ ] **Step 6: e2e in `e2e/board.e2e.ts`**

Next to "a closed task whose branch is merged leaves Paused for Finished", reusing its `commitFile`, `git`, `branchList`:

```ts
test('a running task whose branch is merged moves to Done when its turn ends, and Finish there sends it to Finished', async () => {
  const doneLane = page.locator('[data-testid=lane][data-lane=done]');
  // startTask 'Fix login'; an unmerged turn end stays in Needs you and draws no Done lane
  await sendLine(page, id, report('working'));
  await sendLine(page, id, report('done'));
  await expect(cardIn(page, 'needs-you', id)).toHaveCount(1);
  await expect(doneLane).toHaveCount(0);

  // commitFile in the worktree, merge --no-ff into the base, push, as the test above does
  await sendLine(page, id, report('working'));
  await sendLine(page, id, report('done'));
  await expect(cardIn(page, 'done', id)).toHaveCount(1, { timeout: 15_000 });
  await expect(cardIn(page, 'done', id).getByTestId('task-ask')).toHaveText(/Merged/);
  await expect(page.locator('[data-testid=lane][data-lane=needs-you] [data-testid=task-card]')).toHaveCount(0);

  await cardIn(page, 'done', id).getByTestId('finish').click();
  await expect(card(page, id)).toHaveCount(0, { timeout: 15_000 });
  await expect(doneLane).toHaveCount(0);
  expect(branchList(main, 'worktree-fix-login')).toBe('');
});
```

Run: `npm --prefix $W run test:e2e`
Expected: PASS, the whole suite (other specs count lanes or read lane names).

- [ ] **Step 7: README and the older spec's pointer, then commit**

`git -C $W add src e2e README.md docs` then `git -C $W commit -m "board: a Done lane holds running tasks found merged, shown only while it has a card"`

---

## After the last task

As this repo's `CLAUDE.md` says: `/simplify` on `main...HEAD`, the three suites, the final whole-branch review, `/code-review high`, then the owner tries it (a merged task hopping to Done, and asking the manager to close the done ones) before the merge menu.
