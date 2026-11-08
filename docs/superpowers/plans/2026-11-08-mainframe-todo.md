# Mainframe plan 2b, part 2: the Todo panel — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each project pane gets a Todo panel. Sync fills it from the owner's to-do list, through whatever connector they have, in a background `claude -p` run. The panel also holds the owner's own notes. A ticket panel shows a whole card. Start on a card or a note starts a task that knows its card, and the board orders Needs you by card.

**Architecture:**
- **Main.**
  - A `TodoService` per project, beside `TaskService` and `ManagerService`, owns that project's Todo file, its sync steps and its notes, and starts tasks from its items.
  - A sync is one `claude -p` child process. Its answer is the run's structured output, checked with zod.
  - A PreToolUse hook in the run's `--settings` blocks every tool except the confirmed read tools.
  - Tasks gain an optional card on their record and in their opening prompt.
  - The manager gets a `sync_todo` tool, and `start_task` takes a card id.
- **Renderer.**
  - A `todoStore` keyed by project folder.
  - A `TodoPanel` island on the pane's left, with pin, hide arrow and resize edge.
  - A `TicketPanel` joined to its right edge.
  - A Todo button in each pane's top bar.

**Tech Stack:** Electron 44, electron-vite, SolidJS 1.9, TypeScript 5.9, zod 4.6.7 (already a dependency), Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-mainframe-manager-and-todo-design.md`. Read §5, §6, §7, §4.2 (Sync and Start a task) and §3 (the header link), then **§11, which overrides them where they differ**.

**Design:** `docs/superpowers/mockups/2026-11-06-plan-2b-todo-and-ticket.html`. Its cards and its "Trello · Damela" copy are made up. Ignore its board lanes (the board doesn't change) and the left-edge handle in `…-manager-layout.html` (dropped, §11.3).

**Facts checked on 2026-11-08** (Claude Code 2.1.319 on the owner's machine; probes in the planning session). A task that relies on one cites it.
- **F1. Connectors load in `-p` only with the user's settings.**
  - A run with `--tools "" --permission-mode dontAsk --permission-prompts none` loaded the owner's connectors and the project's `CLAUDE.md`.
  - `--setting-sources ""` or `project,local` loaded no connector. `user` loaded the connectors but not the project's `CLAUDE.md`.
  - So the run passes no `--setting-sources`.
- **F2. A PreToolUse hook blocks a tool that an allow rule lets through.**
  - With `--allowedTools Read`, a hook whose matcher is `^(?!(StructuredOutput)$)` and whose command exits 2 blocked Read.
  - With matcher `^(?!(StructuredOutput|Read)$)`, Read ran.
  - The docs agree (permissions.md, "Precedence among rules, hooks, and mods": "A hook that exits with code 2 stops the tool call before permission rules are evaluated").
- **F3. Structured output.**
  - `--output-format json --json-schema <schema>` prints one JSON object: `{ type: "result", subtype: "success", is_error, result, structured_output, … }`.
  - The answer travels through a tool named `StructuredOutput`, which hooks see.
  - The prompt can come on stdin.
- **F4. `--model haiku`** resolves to the newest Haiku. `--no-session-persistence` keeps the run out of `--resume`.
- **F5. `--max-budget-usd` and `--disable-slash-commands` exist.** There is no `--max-turns` flag, so a wall-clock limit is Mainframe's own.
- **F6. MCP timeouts (mcp.md, "Time limits on MCP tool calls").**
  - A server entry's `timeout` (ms) is its tool calls' wall-clock limit.
  - It also raises the per-request timer, which defaults to 60 s, and floors the idle timeout.
  - A main-conversation call past two minutes moves to a background task.
- **F7. zod 4's `z.toJSONSchema(schema)`** emits `additionalProperties: false` and `"type": ["string", "null"]` for nullable fields.

## Global Constraints

- **Paths:** `<root>` = `/Users/simonekholm/Developer/Simmesolo/Mainframe`. Every command passes absolute paths (`npm --prefix <root> …`, `git -C <root> …`), never `cd x && …`.
- **Branch:** work on `todo`, made from `main`.
- **Project-agnostic (repo CLAUDE.md):**
  - `src/` and `e2e/` name no Trello, Damela, "In Progress", "You" or "Blocker". The one exception is the example list of trackers in the sync prompt.
  - Tests use a made-up source called `Tracker`.
  - A prompt defers to "this repo's CLAUDE.md" and names no skill or plugin.
- **Several projects (repo CLAUDE.md):**
  - Every Todo call, event, file and store entry names its project by folder.
  - No width is taken from the window where the pane's is meant.
- **No e2e run reaches a real connector, Trello or the browser:** `e2e/fake-claude.sh` answers every `-p` run.
- **`state.json` stays version 1.** A task's `card` is optional, so older builds still read the file.
- **Copy:**
  - Sentence case and plain words.
  - Buttons say what happens ("Allow and sync", "Start", "Start anyway", "Set up again", "Save note", "Delete note").
- **UI tasks (6, 7, 8) invoke `frontend-design:frontend-design`** while implementing (owner's CLAUDE.md), within the app's current look and the mockup.
- **TDD for every task:** the test fails first. Each task ends with `npm --prefix <root> test`, `npm --prefix <root> run typecheck` and the e2e files it touches, all passing.

## Review Focus

1. **A sync answer that asks for more than reading.** Read tools that include a built-in (`Bash`), a malformed name, or an empty list are refused whole, and nothing is allowed (Task 4 test).
2. **A run that hangs, prints junk, or exits non-zero.** The panel says why, the list stays, and Sync works again (Tasks 2 and 4 tests).
3. **A project closed, or Mainframe quit, during a sync.** The child is stopped and nothing it answers later is written (Task 4 test, Task 5 wiring).
4. **A re-sync that returns a card whose task is open.** It stays hidden. A closed one shows Reopen and never a second Start (Task 6 `todoItems` test). Two Starts of one card refuse the second (Task 3 test).
5. **Two projects syncing at once.** Each list lands in its own pane and file (Task 6 e2e).

## File structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | Todo types, `TaskCardRef`, `TaskView.card` |
| `src/main/tasks/naming.ts` | `projectKey(dir)`, the per-project folder name the manager already uses |
| `src/main/todo/todoSchema.ts` | zod schemas for cards, sources, lists, notes, card refs and the sync answer |
| `src/main/todo/todoFile.ts` | Reads and writes a project's `todo.json` |
| `src/main/todo/syncRun.ts` | The run's argv, settings (hook), prompts, answer reading, and the child process |
| `src/main/todo/todoService.ts` | One project's Todo: sync steps, notes, starting items, cancel |
| `src/main/tasks/{taskStore,taskService,openingPrompt}.ts` | A task's card |
| `src/main/{ipc,index}.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | Wiring |
| `src/main/mcp/{managerTools,mcpServer}.ts`, `src/main/manager/{managerService,rolePrompt}.ts` | `sync_todo`, `start_task` with a card, the timeout |
| `src/renderer/src/todo/todoStore.ts` | Each project's `TodoView` and the calls on it |
| `src/renderer/src/todo/todoItems.ts` | Pure: the list as the panel shows it, and the sync line |
| `src/renderer/src/todo/todoPrefs.ts` | The Todo panel's width and pin per project, and its clamp |
| `src/renderer/src/todo/TodoPanel.tsx`, `TicketPanel.tsx` | The two islands |
| `src/renderer/src/projects/ProjectPane.tsx`, `app.css` | Layout, the Todo button, starting |
| `src/renderer/src/board/{lanes,TaskCard}.ts(x)`, `panel/SessionPanel.tsx` | Needs you order, card number, header link |
| `e2e/fake-claude.sh`, `e2e/tasks.ts`, `e2e/todo.e2e.ts` | The fake sync, helpers, the end-to-end tests |

---

### Task 1: Todo types, the project key and the Todo file

**Files:**
- Modify: `src/shared/types.ts`, `src/main/tasks/naming.ts`, `src/main/manager/managerService.ts:62-63`
- Create: `src/main/todo/todoSchema.ts`, `src/main/todo/todoFile.ts`
- Test: `src/main/tasks/naming.test.ts`, `src/main/todo/todoFile.test.ts`

**Interfaces:**
- Produces in `src/shared/types.ts`:
  ```ts
  export interface TodoSource { kind: string; board: string | null; list: string; url: string | null }
  export interface TodoChecklist { name: string; items: { text: string; done: boolean }[] }
  export interface TodoCard {
    id: string; number: string | null; title: string; description: string; labels: string[];
    checklists: TodoChecklist[]; url: string | null; forOwner: boolean; urgent: boolean;
  }
  export interface TodoNote { id: string; title: string; text: string }
  export interface TodoListRef { name: string; board: string | null; url: string | null }
  export type TodoAsk = { kind: 'tools'; connector: string; tools: string[] } | { kind: 'lists'; lists: TodoListRef[] };
  export interface TodoView {
    source: TodoSource | null; syncedAt: number | null; cards: TodoCard[]; notes: TodoNote[];
    syncing: boolean; error: string | null; ask: TodoAsk | null;
    /** Whether tools are confirmed or a list picked, so "Set up again" has something to forget. */
    setUp: boolean;
  }
  /** What a task started from a card keeps of it. */
  export interface TaskCardRef {
    sourceKind: string; id: string; number: string | null; url: string | null; labels: string[];
    /** The card's place in the list when the task started, from 0. */
    position: number; urgent: boolean;
  }
  ```
- Produces `projectKey(projectDir: string): string` in `naming.ts`, which is `<slugify(basename)>-<first 8 hex of sha256(projectDir)>`, exactly what `ManagerService` computes today. `ManagerService` then calls it.
- Produces in `todoSchema.ts`: `TODO_SOURCE`, `TODO_CARD`, `TODO_NOTE`, `TODO_LIST_REF` and `TASK_CARD_REF`, zod objects matching the types above. Keep them free of `.min`, `.max` and `.regex`, which may not be valid in a structured-output schema (F7). Also `SYNC_ANSWER` and `SYNC_ANSWER_JSON`:
  ```ts
  export const SYNC_ANSWER = z.object({
    kind: z.enum(['tools', 'lists', 'cards', 'none']),
    message: z.string().optional(),       // none
    connector: z.string().optional(),     // tools
    readTools: z.array(z.string()).optional(),
    lists: z.array(TODO_LIST_REF).optional(),
    source: TODO_SOURCE.optional(),       // cards
    cards: z.array(TODO_CARD).optional(),
  });
  export type SyncAnswer = z.infer<typeof SYNC_ANSWER>;
  export const SYNC_ANSWER_JSON = JSON.stringify(z.toJSONSchema(SYNC_ANSWER));
  ```
- Produces in `todoFile.ts`:
  ```ts
  export interface TodoRecord {
    version: 1;
    readTools?: { connector: string; tools: string[] };
    pickedList?: TodoListRef;
    source?: TodoSource; syncedAt?: number;
    cards: TodoCard[]; notes: TodoNote[];
  }
  export const emptyTodo = (): TodoRecord;
  export class NewerTodoError extends Error {}   // message like the manager's: names the file, its version and 1
  export function loadTodo(file: string, now: number, warn: (msg: string) => void): TodoRecord;
  export function saveTodo(file: string, record: TodoRecord): void;  // makes the folder; writeJsonAtomic
  ```

- [ ] **Step 1: Write the failing tests**
  - `naming.test.ts`: `it('projectKey is the folder name the manager uses: the slug of the basename and 8 hex of the path hash')`. Use `/Users/a/My Project` → `my-project-` plus `createHash('sha256').update('/Users/a/My Project').digest('hex').slice(0, 8)`.
  - `todoFile.test.ts`, in a temp folder:
    - `'a missing file is an empty list with no notes'` → `toEqual({ version: 1, cards: [], notes: [] })`.
    - `'round-trips a record with a source, cards, notes, confirmed tools and a picked list'`.
    - `it.each(['{', 'null', '{"version":1,"cards":"x","notes":[]}', '{"version":1,"cards":[{"id":1}],"notes":[]}'])('a file it cannot use (%s) is kept aside as .bad-<now>, said, and the list starts empty')`.
    - `'a file from a newer Mainframe throws NewerTodoError and is left as it is'`, with `{"version":2,…}`: the bytes are unchanged afterwards.

- [ ] **Step 2: Run them and watch them fail.** Run `npm --prefix <root> test -- naming todoFile`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement.** Add the types and `projectKey`, and point `ManagerService` at `projectKey`. Write the schemas, then `loadTodo`/`saveTodo`, with the version check before the shape check and the shape check through `z.object({ version: z.literal(1), …, cards: z.array(TODO_CARD), notes: z.array(TODO_NOTE) })`.

- [ ] **Step 4: Run all unit tests and the typecheck.** `npm --prefix <root> test` and `npm --prefix <root> run typecheck`: PASS, including the manager's tests, unchanged.

- [ ] **Step 5: Commit.** `feat: Todo types, a project key shared with the manager, and the Todo file`

---

### Task 2: The sync run

**Files:**
- Create: `src/main/todo/syncRun.ts`
- Test: `src/main/todo/syncRun.test.ts`

**Interfaces:**
- Consumes `SYNC_ANSWER`, `SYNC_ANSWER_JSON` and `SyncAnswer` (Task 1).
- Produces:
  ```ts
  export const SYNC_TIMEOUT_MS = 5 * 60_000;
  export type SyncStep = { kind: 'discover' } | { kind: 'read'; list: TodoListRef | null };
  export const isMcpToolName = (name: string): boolean;  // /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/
  export function syncArgv(claudeBin: string, settingsPath: string): string[];
  export function syncSettings(allowTools: string[]): string;   // JSON text for --settings
  export function syncPrompt(step: SyncStep): string;
  export function readSyncAnswer(stdout: string): SyncAnswer;   // throws Error with the panel's message
  export function runClaude(o: { argv: string[]; cwd: string; env: NodeJS.ProcessEnv; input: string; timeoutMs: number }):
    { done: Promise<string>; cancel(): void };
  ```
- **`syncArgv`** is exactly (F1–F5, spec §11.4): `[claudeBin, '-p', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--settings', settingsPath, '--output-format', 'json', '--json-schema', SYNC_ANSWER_JSON, '--max-budget-usd', '1']`.
- **`syncSettings(allow)`** is (F2):
  ```json
  { "permissions": { "allow": [<allow>] },
    "hooks": { "PreToolUse": [ { "matcher": "^(?!(StructuredOutput|<allow, regex-escaped, joined by |>)$)",
      "hooks": [ { "type": "command", "command": "echo \"Mainframe's sync may only read the to-do list.\" >&2; exit 2", "timeout": 10 } ] } ] } }
  ```
  `permissions` is left out when `allow` is empty.
- **`syncPrompt`** is exact copy, with paragraphs joined by a blank line.
  - Both steps start with:

    > Mainframe, the app that runs this project's Claude Code sessions, shows the owner's to-do list for this project in its Todo panel.
  - **discover** continues:

    > This run only finds where that list is: don't call any tool.
    >
    > Look at the tools your connectors (MCP servers) give you, and find the connector that holds the owner's to-do list: a task tracker such as Trello, Linear, Jira or GitHub Issues, or the one this repo's CLAUDE.md names. Answer kind "tools" with that connector's name as the owner would know it, and the full names (mcp__…) of the tools a run needs to find the to-do list and read its cards: only tools that read, such as list, get or search. Never name a tool that creates, changes, moves or deletes anything.
    >
    > If no connector holds a to-do list, answer kind "none" with a message that tells the owner so.
  - **read** continues:

    > Read that list with your connector's tools and answer with its cards. Only read: never create, change, move or delete anything.

    Then, with a list:

    > Read the list "‹name›"[ on "‹board›"][ (‹url›)].

    Or, without one:

    > Find the list that holds the work still to do: the one this repo's CLAUDE.md names, or else the one named like To do, Todo or Backlog. If exactly one list is clearly it, read it. If several could be, don't read any cards: answer kind "lists" with each candidate's name, the board or project it belongs to, and its URL.

    Then always:

    > Answer kind "cards" with the source (the service's name, such as Trello; the board or project; the list; the list's URL) and every card in the list's order. Copy each card's title, description and checklist items word for word, and give its id, its short number as the service shows it (such as #128), its labels and its URL. Mark a card forOwner when this repo's CLAUDE.md says cards like it are for the owner rather than for an agent, and urgent when it says cards like it come first; otherwise leave both false.
    >
    > If you can't read the list, answer kind "none" with a message that tells the owner why.
- **`readSyncAnswer`** throws these messages:
  - not JSON → `The sync run printed something Mainframe can't read`;
  - `is_error` true or `subtype` not `success` → its `result` if that is a non-empty string, else `` `The sync run stopped (${subtype})` ``;
  - no `structured_output` → `result`, or else `The sync run gave no answer`;
  - fails `SYNC_ANSWER` → `The sync run's answer didn't have the shape Mainframe asked for`.
- **`runClaude`:**
  - It spawns `argv[0]` with the rest, in `cwd` and with `env`, never through a shell, and writes `input` to stdin and closes it.
  - It resolves with stdout whenever stdout is non-empty, whatever the exit code, since `-p` prints its JSON on failure too.
  - It rejects with:
    - the last non-empty stderr line, or `` `claude exited with code ${code}` ``, when stdout is empty;
    - `` `Could not run ${argv[0]}: ${err.message}` `` on a spawn error;
    - `The sync took longer than 5 minutes and was stopped` at the limit (the minutes come from `timeoutMs`), after sending SIGTERM;
    - `The sync was stopped` on `cancel()`, after sending SIGTERM.
  - It settles once, and later events change nothing.

- [ ] **Step 1: Write the failing tests** in `syncRun.test.ts`:
  - `'syncArgv is the background run of spec §11.4, with the schema and the settings file'` → `toEqual` the exact array above.
  - `'the hook blocks every tool but StructuredOutput and the allowed ones'`:
    - Parse `syncSettings(['mcp__tracker__get_list'])` and compile its matcher with `new RegExp`.
    - It matches `Bash`, `mcp__tracker__update_card`, `StructuredOutputX` and `xStructuredOutput`.
    - It doesn't match `StructuredOutput` or `mcp__tracker__get_list`.
    - `permissions.allow` equals `['mcp__tracker__get_list']`.
  - `'with nothing allowed, only StructuredOutput gets through and there are no allow rules'`.
  - `'the hook's command exits 2 and says why'`: run `execFileSync('/bin/sh', ['-c', command])` and expect `status` 2 and stderr containing `may only read the to-do list`.
  - `'isMcpToolName takes connector tools only'`:
    - true for `mcp__claude_ai_Linear__list_issues` and `mcp__tracker__get_list`;
    - false for `Bash`, `mcp__tracker`, `mcp__a__b c` and `mcp__a__b;rm`.
  - `'the read prompt names the picked list; without one it asks for candidates'` (`toContain` the list line, and the "several could be" sentence).
  - `'the discover prompt calls no tool and asks for read tools only'`.
  - `it.each` over `readSyncAnswer`'s four failures, each with its message, plus a success returning the parsed answer.
  - **`runClaude` against a stub script** written to a temp folder (`#!/bin/sh`, made executable):
    - `'passes the input on stdin, runs in cwd, and resolves with stdout'`. The stub runs `cat > got-input; pwd > got-cwd; printf '{"ok":1}'`.
    - `'resolves with stdout even when the run exits non-zero'`.
    - `'rejects with the last line of stderr when the run prints nothing'`.
    - `'stops a run that outlasts its time, and says so'` (`timeoutMs: 200`, stub `sleep 5`). It rejects within 2 s with the message for `0` minutes or more. Assert `toMatch(/took longer than/)`.
    - `'cancel stops the run and rejects'`.
    - `'a program that is missing rejects with why'`.

- [ ] **Step 2: Run and watch them fail.** `npm --prefix <root> test -- syncRun`: FAIL.

- [ ] **Step 3: Implement `syncRun.ts`.** Escape the allowed names in the matcher with `s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.

- [ ] **Step 4: Run.** `npm --prefix <root> test -- syncRun`: PASS.

- [ ] **Step 5: Check the schema against the real CLI** (costs well under a cent and reads nothing, since no connector loads):
  - Node 24 strips types itself, so `todoSchema.ts` must load only `zod/v4` at runtime, with its type imports written as `import type`. Then run:
    ```
    claude -p --model haiku --no-session-persistence --setting-sources "" --tools "" --output-format json --json-schema "$(node --input-type=module -e "const m = await import('<root>/src/main/todo/todoSchema.ts'); process.stdout.write(m.SYNC_ANSWER_JSON)")" <<< 'Answer kind none with the message ok.'
    ```
  - Expected: `structured_output` is `{"kind":"none","message":"ok"}`.
  - If the CLI rejects the schema, adjust `SYNC_ANSWER` (not the code that reads it) until it passes, and note the change in the commit message.

- [ ] **Step 6: Commit.** `feat: the background sync run, limited to the confirmed read tools`

---

### Task 3: Tasks remember their card

**Files:**
- Modify: `src/shared/types.ts` (`TaskView.card: TaskCardRef | null`), `src/main/tasks/taskStore.ts`, `src/main/tasks/openingPrompt.ts`, `src/main/tasks/taskService.ts`
- Test: `taskStore.test.ts`, `openingPrompt.test.ts`, `taskService.test.ts`

**Interfaces:**
- Consumes `TaskCardRef` and `TASK_CARD_REF` (Task 1).
- Produces:
  - `TaskRecord.card?: TaskCardRef`, validated in `isTaskRecord` through `TASK_CARD_REF.safeParse`.
  - `TaskService.start(req: { title: string; description: string; noQuestions: boolean; card?: TaskCardRef }): Promise<TaskView>`.
  - `TaskView.card` (`null` without one).
  - `openingPrompt(t: { title; description; branch; noQuestions; card?: Pick<TaskCardRef, 'sourceKind' | 'number' | 'url' | 'labels'> })`.
- **`start` refuses a card that already has an open task** (`open === true`) in this project with the same `sourceKind` and `id`. It throws `` `${req.card.number ?? req.title} is already open as the task "${other.title}"` ``. This covers the panel's starts and the manager's (spec §4.2).
- **The opening prompt with a card** (exact copy, spec §6 as changed by §11.1). Parts are joined by a blank line:
  1. `BRIEF`
  2. `` `Task: ${number ? `${number} ` : ''}${title}` ``
  3. `` `This task is a card on the owner's to-do list in ${sourceKind}${labels.length ? `, labelled ${labels.join(', ')}` : ''}${url ? `: ${url}` : '.'}` ``
  4. `` `Before you plan, read the live card with your ${sourceKind} connector: it is your brief, and it may have changed since Mainframe last synced it. If you can't read it, ask me. Then mark the card as in progress the way this repo's CLAUDE.md says, or else by moving it to its board's in-progress list or status, if it has one.` ``
  5. `` `From the owner: ${description}` ``, only when the description isn't blank
  6. the worktree note
  7. `NO_QUESTIONS`, if set

  Without a card the prompt is unchanged. Reopen, when it has to begin the conversation again, passes the record's card, through `startArgvOf`.

- [ ] **Step 1: Write the failing tests**
  - `openingPrompt.test.ts`:
    - `'a card's prompt names it, asks the session to read the live card first and mark it in progress, and puts the owner's words after it'`. Use `toBe` with the full string for `{ sourceKind: 'Tracker', number: '#128', url: 'https://tracker.example/c/128', labels: ['UI', 'Backend'] }` and description `web only`.
    - `'a card without a number, a URL or labels reads cleanly'`.
  - `taskStore.test.ts`:
    - `'keeps a task's card'` (round trip).
    - `'sets aside a file whose task has a card of the wrong shape'`.
  - `taskService.test.ts`:
    - `'a task started from a card keeps it, shows it, and its launch carries the card's prompt'`.
    - `'a second start of a card whose task is open is refused, and says which task has it'`.
    - `'a card whose task has closed can start again'`.
    - `'a reopen that must begin the conversation again keeps the card in its prompt'`.

- [ ] **Step 2: Run and watch them fail.** `npm --prefix <root> test -- openingPrompt taskStore taskService`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all unit tests and the typecheck.** PASS.
- [ ] **Step 5: Commit.** `feat: a task started from a card keeps the card and reads it first`

---

### Task 4: The Todo service

**Files:**
- Create: `src/main/todo/todoService.ts`
- Test: `src/main/todo/todoService.test.ts`

**Interfaces:**
- Consumes Task 1's file and types, Task 2's `syncArgv`, `syncSettings`, `syncPrompt`, `readSyncAnswer`, `runClaude`, `isMcpToolName` and `SYNC_TIMEOUT_MS`, and Task 3's `TaskService['start']`.
- Produces:
  ```ts
  export interface TodoServiceDeps {
    projectDir: string; dataDir: string; claudeBin: string; env: NodeJS.ProcessEnv;
    startTask: TaskService['start'];
    onChange(view: TodoView): void;
    run?: typeof runClaude; newId?: () => string; now?: () => number; warn?: (msg: string) => void;
  }
  export type SyncOutcome = { cards: number } | { ask: TodoAsk['kind'] } | { error: string };
  export class TodoService {
    view(): TodoView;
    sync(): Promise<SyncOutcome>;             // a second call while one runs returns the same promise
    confirmTools(): Promise<SyncOutcome>;     // keeps ask.tools as readTools, then syncs
    pickList(index: number): Promise<SyncOutcome>;  // keeps ask.lists[index] as pickedList, then syncs
    resetSource(): void;                      // forgets readTools and pickedList; keeps cards and notes
    saveNote(note: { id?: string; title: string; text: string }): TodoNote;
    deleteNote(id: string): void;
    startItem(item: { kind: 'card' | 'note'; id: string }, opts: { noQuestions: boolean; brief?: string }): Promise<TaskView>;
    cancel(): void;                           // stops a running sync; nothing it answers is kept
  }
  ```
- **Files:** `<dataDir>/todo/<projectKey(projectDir)>/todo.json`, plus `sync-settings.json` beside it, written before each run.
- **The steps** (spec §5.3 and §11.4):
  - **Without `readTools`, the step is `discover`,** with nothing allowed.
    - `tools` with a connector and a non-empty `readTools` that are all MCP names → `ask = { kind: 'tools', … }`.
    - Any non-MCP name → error `` `The sync named tools that aren't a connector's: ${names}` ``, and nothing is kept.
    - `none` → error = its message.
    - Any other kind → error `The sync run answered something Mainframe didn't ask for`.
  - **With `readTools`, the step is `read`,** with exactly those tools allowed and the `pickedList`.
    - `cards` with a source → the source, cards and `syncedAt = now()` are kept, and the error and ask are cleared.
    - `lists` (non-empty) → `ask = { kind: 'lists', … }`.
    - `none` → error.
    - Any other kind → the same error as above.
  - **The run** is `{ argv: syncArgv(claudeBin, settingsPath), cwd: projectDir, env, input: syncPrompt(step), timeoutMs: SYNC_TIMEOUT_MS }`.
  - **A rejection** (`runClaude` or `readSyncAnswer`) → error = its message, and the list stays.
  - `syncing` is true from the start to the end of a run. `onChange` fires on every change.
  - `view().setUp` is true while `readTools` or `pickedList` is kept.
- **A note's** title is trimmed and must not be empty (`A note needs a title`).
- **`startItem`:**
  - **A card** calls `startTask({ title: card.title, description: opts.brief ?? '', noQuestions, card: { sourceKind: source.kind, id, number, url, labels, position: index, urgent } })`.
  - **A note** calls `startTask({ title, description: text, noQuestions })`, then deletes the note. A start that fails keeps it.
  - **An unknown item** → `` `No card ${id} in the synced list; sync it again` `` / `` `No note ${id}` ``.
- **A file from a newer Mainframe** (`NewerTodoError`):
  - the service holds an empty list in memory, and `view().error` is the error's message;
  - `sync`, `saveNote`, `deleteNote` and `startItem` of a note reject with the same message;
  - it never writes the file.

- [ ] **Step 1: Write the failing tests.** Use a fake `run` that records each call and returns a `done` the test resolves with a canned `-p` JSON, and a fake `startTask` that records its request.
  - `'a first sync runs with no tools allowed, then asks the owner to confirm the connector's read tools'`:
    - the call's argv, cwd and input are as above;
    - `sync-settings.json` has no `permissions`;
    - `view().ask` is the tools ask;
    - the outcome is `{ ask: 'tools' }`.
  - `'read tools that aren't all connector tools are refused whole'` (`['Bash', 'mcp__tracker__get_list']`, and `[]`).
  - `'confirming keeps the tools and syncs with exactly those allowed; the cards, the source and the time are kept'`:
    - the settings file allows them;
    - `todo.json` holds `readTools`;
    - the outcome is `{ cards: 2 }`.
  - `'several candidate lists: the one picked is kept and read'` (the prompt `toContain` its name).
  - `'a run that fails or answers none leaves the list as it was and says why'`.
  - `'an answer of the wrong kind for the step is an error'`.
  - `'a second Sync while one runs joins it'` (one run call, both promises give the same outcome).
  - `'Set up again forgets the tools and the list and keeps the cards and notes'`.
  - `'cancel stops the run, and an answer that comes after changes nothing'`.
  - `'notes are added, edited and deleted, kept in todo.json, and a sync leaves them'`.
  - `'a card starts a task with its title, the brief and its card'`, with the exact `TaskCardRef` (position from the card's index).
  - `'a note starts a task with its title and text, then leaves the list; a start that fails keeps it'`.
  - `'an unknown card or note is refused, saying so'`.
  - `'a Todo file from a newer Mainframe: the panel says so, and nothing syncs or saves'`.

- [ ] **Step 2: Run and watch them fail.** `npm --prefix <root> test -- todoService`: FAIL.
- [ ] **Step 3: Implement `TodoService`.**
- [ ] **Step 4: Run all unit tests and the typecheck.** PASS.
- [ ] **Step 5: Commit.** `feat: each project's Todo service: sync steps, notes, and starting from an item`

---

### Task 5: Wiring in main, and the manager's tools

**Files:**
- Modify:
  - `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`;
  - `src/main/mcp/managerTools.ts`, `src/main/mcp/mcpServer.ts`;
  - `src/main/manager/managerService.ts` (`ALLOWED_TOOLS`), `src/main/manager/rolePrompt.ts`.
- Test: `managerTools.test.ts`, `mcpServer.test.ts`, `e2e/manager.e2e.ts:72,101`

**Interfaces:**
- Consumes `TodoService` (Task 4).
- Produces these IPC channels: `getTodo: 'todo:get'`, `todoChanged: 'todo:changed'`, `syncTodo: 'todo:sync'`, `confirmTodoTools: 'todo:confirm-tools'`, `pickTodoList: 'todo:pick-list'`, `resetTodoSource: 'todo:reset-source'`, `saveTodoNote: 'todo:save-note'`, `deleteTodoNote: 'todo:delete-note'`, `startTodoItem: 'todo:start-item'`.
- Produces on `MainframeApi`:
  ```ts
  getTodo(dir: string): Promise<TodoView>;
  onTodo(cb: (e: { dir: string; view: TodoView }) => void): () => void;
  syncTodo(dir: string): Promise<void>;          // the outcome shows in the view
  confirmTodoTools(dir: string): Promise<void>;
  pickTodoList(dir: string, index: number): Promise<void>;
  resetTodoSource(dir: string): Promise<void>;
  saveTodoNote(dir: string, note: { id?: string; title: string; text: string }): Promise<TodoNote>;
  deleteTodoNote(dir: string, id: string): Promise<void>;
  startTodoItem(dir: string, req: { item: { kind: 'card' | 'note'; id: string }; noQuestions: boolean }): Promise<TaskView>;
  ```
- **`Project` gains `todo: TodoService`.** `makeProject` builds it:
  - with `env: buildSpawnEnv(process.env)`, the same environment sessions get;
  - with `startTask: (req) => service.start(req)`;
  - with `onChange` sending `todoChanged` through the project's `send`.

  `release` calls `todo.cancel()` before `mcp.close()`. The `before-quit` handler cancels every open project's sync (`for (const { dir } of projects.list()) projects.get(dir)?.todo.cancel()`).
- **`mcpConfigJson`** adds `"timeout": 360000` to the `mainframe` entry (F6: past the run's 5 minutes).
- **`registerManagerTools(server, deps: Pick<TaskService, 'reports' | 'start' | 'startCheck'> & { todo: Pick<TodoService, 'sync' | 'startItem'> })`:**
  - **`sync_todo`**, which takes no input. Its description: "Syncs the Todo panel: a background run reads the owner's to-do list through their connector, and Mainframe shows it. Returns the number of cards, what the owner must do in the Todo panel first (allow the tools that read the list, or pick the list), or why it couldn't. Only when the owner asks." It returns, by outcome:
    - `{ cards: n }` → `text({ cards: n })`;
    - an `ask` → `text({ needsOwner: 'Allow the tools that read the to-do list, in the Todo panel' })` or `text({ needsOwner: 'Pick the to-do list, in the Todo panel' })`;
    - an `error` → an `isError` result with the message.
  - **`start_task`** takes an optional `cardId: z.string()`. With one, it calls `todo.startItem({ kind: 'card', id: cardId }, { noQuestions, brief })`. Without one, it behaves as today. Add to its description: "With cardId (a synced card's id), the task starts from that card, and the brief is what the owner added." The start check and its warning are unchanged.
- **The manager's `ALLOWED_TOOLS`** becomes `['mcp__mainframe__list_sessions', 'mcp__mainframe__sync_todo']` (spec §11.4).
- **The second sentence of `ROLE_PROMPT`'s second paragraph** becomes: "Mainframe's tools (mainframe) let you list the task sessions, start new ones, and sync the Todo panel's list." A resumed chat keeps its old prompt, so the tool descriptions carry the rest.

- [ ] **Step 1: Write the failing tests**
  - `managerTools.test.ts`:
    - the registration test now expects `['list_sessions', 'start_task', 'sync_todo']`;
    - `'sync_todo returns the card count, what the owner must do first, or the error'`;
    - `'start_task with a cardId starts from that card with the brief'`;
    - `'start_task takes an optional cardId'` (schema).
  - `mcpServer.test.ts`: the `mcpConfigJson` string includes `"timeout":360000`.
  - `e2e/manager.e2e.ts`:
    - line 72 expects the allow list above;
    - line 101 expects the three tool names.

- [ ] **Step 2: Run and watch them fail.** `npm --prefix <root> test -- managerTools mcpServer`: FAIL.
- [ ] **Step 3: Implement the wiring and the tools.**
- [ ] **Step 4: Run all unit tests, the typecheck, the build and the manager e2e.** Run `npm --prefix <root> test`, `npm --prefix <root> run typecheck` and `npm --prefix <root> run test:e2e -- manager`: PASS.
- [ ] **Step 5: Commit.** `feat: the Todo service in each project, over IPC, and the manager's sync_todo`

---

### Task 6: The Todo panel, its Sync and its place on the left

Invoke `frontend-design:frontend-design` for this task's visual work.

**Files:**
- Create:
  - `src/renderer/src/todo/todoStore.ts`;
  - `src/renderer/src/todo/todoItems.ts` (+ `.test.ts`);
  - `src/renderer/src/todo/todoPrefs.ts` (+ `.test.ts`);
  - `src/renderer/src/todo/TodoPanel.tsx`;
  - `e2e/todo.e2e.ts`.
- Modify:
  - `src/renderer/src/panel/panelPrefs.ts` (+ test), `src/renderer/src/projects/projectsStore.ts`, `src/renderer/src/projects/ProjectPane.tsx`, `src/renderer/src/app.css`;
  - `e2e/fake-claude.sh`, `e2e/tasks.ts`.

**Interfaces:**
- Consumes Task 5's API.
- Produces **`todoStore.ts`**:
  - `todoOf(dir): TodoView | undefined`, `loadTodo(dir)` and `forgetTodo(dir)`, called beside `loadManager` and `forgetManager` in `projectsStore.setProjects`;
  - thin wrappers `syncTodo`, `confirmTodoTools`, `pickTodoList`, `resetTodoSource`, which log their rejection as the other stores do.
- Produces **`todoItems.ts`**:
  ```ts
  export interface TodoItem {
    key: string;                       // `card:<id>` | `note:<id>`
    kind: 'card' | 'note';
    title: string; body: string; number: string | null; labels: string[]; forOwner: boolean;
    /** Start; Reopen of the newest closed task that has this card; none for a card for the owner. */
    action: { kind: 'start' } | { kind: 'reopen'; taskId: string } | null;
    card: TodoCard | null; note: TodoNote | null;
  }
  export function todoItems(view: TodoView, tasks: TaskView[]): TodoItem[];
  export function sourceLine(view: TodoView): string;    // `${kind} · ${board} · ${list}`, board left out when null; '' with no source
  export function syncedLine(view: TodoView, now: number): string;  // 'Not synced yet' | 'Synced just now' | 'Synced 12 min ago' | 'Synced 3 h ago'
  ```
  - A card is hidden while a task with its `sourceKind` and `id` has a session.
  - Notes come after the cards.
- Produces **`panelPrefs.ts`**:
  - `loadPanelPrefs(storage, dir, opts?: { key?: string; defaults?: PanelPrefs })` and `savePanelPrefs(storage, dir, prefs, key?)`;
  - the session panel keeps its key, its defaults and its shared fallback.
- Produces **`todoPrefs.ts`**:
  - `TODO_WIDTH = { default: 320, min: 280, max: 480 }`;
  - `loadTodoPrefs` and `saveTodoPrefs` (key `mainframe.todo`, defaults `{ width: 320, pinned: false }`);
  - `clampTodoWidth(width, paneWidth)`, which keeps `MIN_WIDTH + BOARD_ROOM.pinned` beside it as `clampManagerWidth` does.
- Produces **`TodoPanel`** with props `{ width; pinned; open; onDrag; onDone; onPinnedChange; onOpenChange }`, reading its project from `useProject()`.
  - **Markup:** an `aside.todo-panel` (`data-testid="todo-panel"`, `aria-label="Todo"`, `data-pinned`, `data-open`) holding:
    - the pin (`todo-pin`, as the manager's);
    - a tab strip with one tab, "Todo";
    - the source row, with `sourceLine`, `syncedLine` and the Sync button (`todo-sync`, "Sync", or "Syncing…" and disabled while syncing);
    - the ask (below);
    - the error (`todo-error`, `role="alert"`);
    - the list (`todo-item`, `data-key`, `data-for-owner`), showing the number, the title, two clamped lines of body, the labels, and a "Note" mark on notes;
    - "Set up again" (`todo-reset`), shown when `setUp`;
    - the hide arrow (`todo-hide`, chevron pointing left), which hands the focus to the top bar's Todo button;
    - the `ResizeEdge` (`todo-resize`, grows right, label "Todo width"), last.
  - **No Start or Reopen yet** (Task 7).
  - **The ask:**
    - **Tools:** "Sync reads your to-do list in ‹connector› with these tools, which only read:", the names in `<code>`, and "Allow and sync" (`todo-confirm-tools`).
    - **Lists:** "Which list is your to-do list?" with one button per list (`todo-pick-list`), showing its name and board.
  - **Empty,** with no source and no notes: "Sync reads your to-do list through the connector you use for it. Notes you add stay in Mainframe."
- **`ProjectPane`** changes:
  - It keeps the Todo prefs and an open signal, which starts as `prefs.pinned` (spec §11.3).
  - `todoBeside = open && pinned ? width : 0`.
  - `besideWidth()` becomes the manager's beside width plus `todoBeside()`.
  - The manager clamps against `width() - todoBeside()`, and the Todo panel against `width()` less the manager's beside width.
  - It sets `--left-room: ${todoBeside() ? todoBeside() + 8 : 0}px` on the pane.
  - A Todo toggle (`todo-toggle`, `aria-pressed`, "Todo", a list icon) goes in the top bar, before the Manager toggle.
  - `TodoPanel` comes after `ManagerColumn` in the DOM (the drag-region rule in the comment there).
  - `hideUnpinned` also closes an unpinned Todo panel.
- **CSS:**
  - `.todo-panel` joins the island rule and the no-drag rule. It has `order: -2`, `margin: 8px 0 8px 8px` and width from its style.
  - Pinned and closed, it is `display: none`.
  - Unpinned, it is `position: absolute; left: 8px; z-index: 7`, with the manager's shadow. Closed, it gets the manager's `translateX(calc(-100% - 24px))` and `visibility: hidden`.
  - The floating manager's `left` becomes `calc(8px + var(--left-room, 0px))`, and its show pill's `left` becomes `var(--left-room, 0px)`.
  - The reduced-motion block covers the new transitions.
- **`e2e/fake-claude.sh`,** right after the argv line: when `$1` is `-p`, it writes stdin to `$FAKE_CLAUDE_LOG_DIR/$$.stdin`, prints `$FAKE_CLAUDE_LOG_DIR/sync-reply.json` if it exists, and exits 0.
- **`e2e/tasks.ts`:**
  - `launches` and `managerLaunches` leave out `-p` runs.
  - It adds `syncLaunches(dataDir)` (with each one's `stdin`), `syncReply(dataDir, answer)` (writes `{ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: answer }`), and `todoDir(dataDir)`.

- [ ] **Step 1: Write the failing unit tests**
  - `todoItems.test.ts`:
    - `'cards keep the source's order and notes follow'`;
    - `'a card whose task runs is hidden, even when a sync brings it back'`;
    - `'a card whose task has closed offers Reopen of the newest such task'`;
    - `'a card for the owner offers nothing'`;
    - `'a task matches a card only from the same source'`;
    - `sourceLine` with and without a board;
    - `syncedLine` buckets at 0, 30 s, 12 min and 3 h.
  - `panelPrefs.test.ts`: `'another key and defaults leave the session panel's alone'`.
  - `todoPrefs.test.ts`:
    - `'the Todo panel starts unpinned at 320 px, per project'`;
    - `clampTodoWidth` cases at pane widths 1400, 1100 and 900.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Write the failing e2e tests** in `e2e/todo.e2e.ts`. Each project is a fresh temp folder.
  - `'Sync finds the connector and asks to allow its read tools; allowed, it shows the list, and the list is kept across a restart'`:
    - Reply with the tools answer for `Tracker` / `['mcp__tracker__get_list']`, then press `todo-toggle` and `todo-sync`.
    - The first sync launch's args include `-p` and `'--tools', ''`, and its stdin includes `don't call any tool`.
    - `sync-settings.json` has no `permissions`.
    - The ask shows `mcp__tracker__get_list`.
    - Reply with two cards, the first `#128`, labelled `UI`, with a two-line description.
    - Press `todo-confirm-tools`. The items show `#128` and its title, the source row reads `Tracker · Shop · To do` and `Synced just now`, and the second launch's settings allow exactly that tool.
    - Relaunch on the same data folder: the cards show, and no new sync launch happened.
  - `'a sync that fails says why and keeps the list'` (answer `none`).
  - `'two projects side by side keep their own lists'` (two panes; sync in one; the other reads `Not synced yet`).
  - `'pinned, the Todo panel takes the pane's left edge and the manager sits right of it; unpinned, it floats over the manager, and a press on the board puts it away'`:
    - Compare boxes: the pinned Todo panel's right edge is left of the manager column's left edge.
    - With the manager put away, its show pill's left edge is right of the Todo panel's right edge.
    - Unpinned, the Todo panel overlaps the manager column, and `elementFromPoint` at its centre is inside the Todo panel.
    - A press on the board hides it.
    - The pin and width survive a restart.
- [ ] **Step 4: Run and watch them fail.** `npm --prefix <root> run test:e2e -- todo`: FAIL.
- [ ] **Step 5: Implement** the store, `todoItems`, the prefs, `TodoPanel`, the pane changes, the CSS and the fake.
- [ ] **Step 6: Run** the unit tests, the typecheck and the whole e2e suite: PASS.
- [ ] **Step 7: Commit.** `feat: the Todo panel: Sync through the owner's connector, its notes list, and its place beside the manager`

---

### Task 7: The ticket panel, notes and starting from the list

Invoke `frontend-design:frontend-design` for this task's visual work.

**Files:**
- Create: `src/renderer/src/todo/TicketPanel.tsx`
- Modify: `TodoPanel.tsx`, `ProjectPane.tsx`, `src/renderer/src/tasksStore.ts`, `todoStore.ts` (`saveTodoNote`, `deleteTodoNote`), `app.css`, `e2e/todo.e2e.ts`

**Interfaces:**
- Consumes `todoItems`, `TodoItem` and the Task 5 API.
- Produces in `tasksStore.ts`:
  - `startTodoItem(dir, req): Promise<void>`, which shares `startTask`'s `startPending` and select-on-arrival through one private helper `startAndSelect(dir, start: () => Promise<TaskView>)`. `startTask` uses the same helper.
- Produces **`TicketPanel`** with props:
  ```ts
  {
    item: TodoItem | 'new-note'; warning: StartCheck | null;
    onClose(): void;
    onStart(o: { noQuestions: boolean; note?: { title: string; text: string } }): void;
    onReopen(taskId: string): void;
  }
  ```
  - It is a `section.ticket-panel` (`data-testid="ticket-panel"`) placed at the Todo panel's right edge and over the board and manager. The open card in the list gets `data-open="true"` and reaches into it, as in the mockup.
  - **For a card:**
    - the number and title;
    - the labels;
    - `` `Open in ${source.kind} ↗` `` (`ticket-link`, `openLink`), when it has a URL;
    - the description, with its line breaks;
    - the checklists, read-only, each under its name;
    - a quiet line: `` `The card as of the last sync, ${syncedLine}` ``;
    - a footer with Start (`ticket-start`, "Start anyway" with a warning) and "Don't ask me questions" (`ticket-no-questions`).
    - A card for the owner has no footer. A closed task's card shows Reopen (`ticket-reopen`) in its place.
  - **For a note, and for `'new-note'`:**
    - a Title input and a Text textarea;
    - "Save note" (`note-save`) and "Delete note" (`note-delete`, saved notes only);
    - the same footer.
    - Start on a saved note with unsaved edits saves them first, then starts it with `startTodoItem`. Start on `'new-note'` calls `startTask` with the fields' title and text, like New task, and keeps no note.
  - **The warning** (`ticket-warning`) is the New task dialog's warning, word for word.
  - **It closes with:** ✕ (`ticket-close`), Esc (a keydown on the document while it is open, unless a modal dialog is open), a press on the board, a second click on the open item, the Todo panel going away, and Start. Clicking another item swaps it in place.
- **`TodoPanel`** gains:
  - Start or Reopen on each item (`todo-start`, `todo-reopen`; `aria-label` names the item);
  - item click → open the ticket;
  - "+ Add note" (`todo-add-note`) → `'new-note'`.
- **Start from the list** (spec §5.4):
  - It calls `startCheck(dir)`.
  - When `ahead > 0`, it opens that item's ticket with the warning and starts nothing.
  - Otherwise it calls `startTodoItem`.
  - Start in the ticket starts at once, whatever the warning, since the warning is already shown.
  - A failure shows in the ticket's footer (`ticket-error`, `role="alert"`).

- [ ] **Step 1: Write the failing e2e tests** in `e2e/todo.e2e.ts`, synced through the fake as in Task 6:
  - `'Start on a card starts its task at once: under Working, selected; its prompt names the card and asks the session to read it first; the card leaves the list, and comes back with Reopen once the task closes'`.
    - The launch's last argument contains `Task: #128 …`, the card's URL and `read the live card with your Tracker connector`.
  - `'the ticket shows the whole card; Open in Tracker opens its link; Esc, ✕, a press on the board and a second click close it; another card swaps in place'`.
    - Check `openedLinks` for the link.
  - `'a start the check warns about opens the ticket with the warning, and Start anyway starts it'`.
    - Use a `repo()` project with one local commit on its main branch that `origin` lacks, made as `tasks.e2e.ts` makes one.
  - `'a note is added, edited, kept across a restart, and started as a task, which takes it off the list'`.
    - The task's title and description are the note's.
  - `'a card for the owner opens its ticket but offers no Start'`.
- [ ] **Step 2: Run and watch them fail.** `npm --prefix <root> run test:e2e -- todo`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, the typecheck and the whole e2e suite: PASS.
- [ ] **Step 5: Commit.** `feat: the ticket panel, notes, and Start from the Todo list`

---

### Task 8: The board and the session panel show the card

Invoke `frontend-design:frontend-design` for the card number and the link.

**Files:**
- Modify: `src/renderer/src/board/lanes.ts`, `src/renderer/src/board/TaskCard.tsx`, `src/renderer/src/panel/SessionPanel.tsx`, `app.css`
- Test: `lanes.test.ts`, `e2e/todo.e2e.ts`

**Interfaces:**
- Consumes `TaskView.card` (Task 3).
- **`laneOrder`'s Needs you order** (spec §7, as changed by §11.1):
  1. tasks whose card is urgent, by `card.position` and then `createdAt`;
  2. other tasks with a card, by `card.position` and then `createdAt`;
  3. tasks without a card, by `createdAt`.

  Working and Closed are unchanged. Update the comment on `laneOrder` ("to-do order until plan 2b").
- **`TaskCard`** shows the card's number before the title, in a `span.card-number` (`data-testid="task-card-number"`), muted, as `.num` in the mockup.
- **`SessionPanel`'s branch bar** gains `` `Open in ${card.sourceKind} ↗` `` (`panel-card-link`) when the task's card has a URL. It opens through `openLink` and keeps the focus where it was.

- [ ] **Step 1: Write the failing tests**
  - `lanes.test.ts`: `'Needs you puts urgent cards first, then other cards by their place in the list, then tasks without a card by age'`, with five tasks, all blocked. Also `'Working and Closed keep their order whatever the cards'`.
  - `e2e/todo.e2e.ts`: `'a task started from a card shows its number on the board, and the session panel's link opens the card'`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, the typecheck and the whole e2e suite: PASS.
- [ ] **Step 5: Commit.** `feat: Needs you follows the to-do list, and tasks show their card`

---

### After Task 8: simplify, then the final review

As the repo's CLAUDE.md sets out:
- **`/simplify`** with args `main...HEAD`. Then the three suites, a commit, and the tip recorded in `.git/claude-simplified`.
- **The whole-branch final review.**
- **`/code-review high main...HEAD`.** Then its fixes, the three suites, a commit, and the tip recorded in both `.git/claude-reviewed` and `.git/claude-simplified`.

The task reviews and the final review ask both of the CLAUDE.md questions: another language, a `master` branch and no plugins; and Damela and Word² side by side.

### Task 9: Acceptance with the owner

Run Mainframe from this branch on the owner's real data folder with Damela open (memory `owner-launches-mainframe-on-damela`). Record what is seen in `docs/superpowers/findings/2026-11-0X-plan-2b-todo-acceptance.md`, in the format of `2026-11-07-plan-2b-manager-acceptance.md`. The owner decides Pass or Fail.

**Before the run, the owner adds the label and list conventions to Damela's `CLAUDE.md`** (spec §11.1). Mainframe ships none. Suggested line, which the owner words as they like:

> **Trello (the to-do list):** cards labelled "You" are the owner's, not an agent's; cards labelled "Blocker" come first; a session that starts a card moves it to the "In Progress" list.

**Checks:**
1. **The first Sync.**
   - It names the Trello connector and only read tools.
   - "Allow and sync" fills the list in the board's order.
   - "You" cards are greyed with no Start.
   - The source row and the synced time are right.
2. **The sync run itself.**
   - Read its launch from the process list or `MAINFRAME_LOG_OSC`. Expect no Bash, no file tools and no Trello write tools.
   - It doesn't show in `claude --resume` in Damela.
3. **Start on a card.**
   - The task reads the live card and moves it to In Progress.
   - Watch whether the owner's `auto` mode asks first (spec §9's acceptance check). If it does, the owner decides: approve once, or allow the connector in their settings.
4. **The ticket panel.**
   - Description and checklists match Trello.
   - "Open in Trello ↗" opens the card.
5. **Notes.** Add, edit, delete, restart, and Start on a note.
6. **The manager.**
   - "Sync my list" calls `sync_todo` with no prompt and reports the count.
   - "Start #<n>, <brief>" starts that card with the brief.
7. **Needs you.** A Blocker card's task comes before older ones.
8. **Two projects.** With Damela and a second project side by side, each Todo panel keeps its own list.
9. **Feel.**
   - Pinned and unpinned Todo beside the pinned, floating and hidden manager, on the laptop screen.
   - The board's room with all three islands pinned.

Then the merge/PR menu of `superpowers:finishing-a-development-branch`, after any acceptance fixes have had their own `/simplify` and `/code-review high` runs.
