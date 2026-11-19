# Terminal text size, pasted images, and model pickers: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminal text size and line height in Settings; every image pasted or dropped into a session can be opened from its `[Image #N]` label or a strip of thumbnails; New Task can start a task on a chosen model and effort.

**Architecture:** Text settings live in `settings.json` (written only by `AgentsInUse`) and are applied live to every xterm through its options. Image lists live in main, one per agent conversation, in that conversation's data folder; the renderer records an image only once the agent's own label confirms its number, and reads image files only through a `mainframe-image:` protocol that serves listed entries. Model lists come from each agent's adapter (`taskModels`), and the pick rides on the task record into each launch.

**Tech Stack:** Electron 44, SolidJS 1.9, xterm.js 6.1 beta, zod 4, vitest, Playwright e2e with fake agents in `e2e/`.

**Spec:** `docs/superpowers/specs/2026-11-19-mainframe-text-images-models-design.md` (read it first; this plan argues from it).

## Global Constraints

- Project-agnostic (root `CLAUDE.md`): no project, path, branch, model or folder of the owner's in `src/` or `e2e/`.
- Multi-project: nothing keyed to "the" project; image lists are per conversation; two projects side by side each show their own.
- Defaults unchanged: font size 13, line height 1.0; a task started without touching the pickers launches with exactly today's argv and env.
- A wrong image number is never shown: no label, no entry; no pattern, no number.
- Renderer code can't read arbitrary files: images are served only for entries in a list.
- Works on macOS, Windows and Linux.
- External CLI flags, config keys, labels and slash commands are checked against current docs or the installed CLI in the task that uses them (installed here: Claude Code 2.1.328, Codex 0.169.0, OpenCode 2.2.7). Use context7 / WebFetch for docs.
- Every user-visible task adds one `New: …` line under `## Unreleased` in `CHANGELOG.md`, above existing lines.
- UI tasks (2, 5, 8) invoke the `frontend-design:frontend-design` skill while building, matching `src/renderer/src/app.css` tokens.
- Run after each task: `npm test`, `npm run typecheck`; after tasks 2, 5, 7, 8 also the touched e2e files (`npx playwright test e2e/<file>` after `npm run build`). Ask the owner to quit their Mainframe (Cmd+Q) before running e2e.

## Correction to the spec found while planning

OpenCode's TUI has no `-m` flag (`opencode --help`: only `--standalone`, `-s`, `--prompt`, `-c`, `--auto`). The model goes in through the config Mainframe already passes in the environment (`OPENCODE_CONFIG_CONTENT`, key `model`, value `provider/model`), verified against OpenCode's config docs in Task 4. A variant goes in only if those docs give a config key for it; otherwise OpenCode gets no Effort picker (the spec already allows that).

## Review Focus

1. **A paste the agent doesn't take** (pasted while a question or permission prompt shows): no label appears within the watch, nothing is recorded, later numbers stay right. Test in Task 7.
2. **Several image files dropped at once**, with existing labels already in the prompt: each gets the next new number in order; numbers already on screen are never reused. Test in Task 7.
3. **Settings arrive after terminals mount** (settings answer only once projects start): terminals open at the defaults and switch to saved values when the view arrives, refitting so the agent gets the new size. Test in Task 2.
4. **An image file deleted or moved after it was recorded**: thumbnail and viewer show "Not available" with the old path; arrows still step past it; Show in Finder is hidden. Test in Task 8.
5. **A retired model on Reopen** (Codex or OpenCode no longer lists it): the task reopens on Default with a warning, not a launch that fails. A model list that fails to load passes the pick as saved. Test in Task 4.

---

### Task 1: Terminal text settings in main

**Files:**
- Modify: `src/shared/types.ts` (types, constants, `SettingsView`)
- Modify: `src/main/setup/settings.ts` (`AppSettings`, zod schema)
- Modify: `src/main/setup/agentsInUse.ts` (`view()`, new `setTerminalText`)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` (`registerSettingsIpc`)
- Test: `src/main/setup/settings.test.ts`, `src/main/setup/agentsInUse.test.ts`

**Interfaces:**
- Produces (in `src/shared/types.ts`):
  ```ts
  export interface TerminalText { fontSize: number; lineHeight: number }
  export const TERMINAL_TEXT_DEFAULT: TerminalText = { fontSize: 13, lineHeight: 1 };
  export const TERMINAL_TEXT_LIMITS = { fontSize: { min: 10, max: 20, step: 1 }, lineHeight: { min: 1, max: 1.6, step: 0.1 } } as const;
  // SettingsView gains: terminalText: TerminalText  (always filled; defaults when nothing saved)
  ```
- Produces: `AgentsInUse.setTerminalText(patch: Partial<TerminalText>): void`; IPC `IPC.setTerminalText = 'settings:set-terminal-text'`; `MainframeApi.setTerminalText(patch: Partial<TerminalText>): Promise<void>`.

- [ ] **Step 1: Write the failing tests**
  - `settings.test.ts`: `'keeps the terminal text it saved'` — `writeSettings(dir, { terminalText: { fontSize: 15, lineHeight: 1.3 } })` then `readSettings(dir, warn).terminalText` equals `{ fontSize: 15, lineHeight: 1.3 }`. `'a file without terminal text still reads'` — a version 2 file with only `defaultAgent` reads with `terminalText` undefined and no warning.
  - `agentsInUse.test.ts`: `'Settings shows the default terminal text until one is saved'` — `view().terminalText` equals `TERMINAL_TEXT_DEFAULT`. `'saving the size keeps the line height and tells the page'` — after `setTerminalText({ fontSize: 16 })`, the written file has `{ fontSize: 16, lineHeight: 1 }` and `onChange` got a view with it. `'a size outside the limits is refused'` — `setTerminalText({ fontSize: 9 })`, `({ fontSize: 21 })`, `({ lineHeight: 1.7 })`, `({ fontSize: 13.5 })` each throw, nothing written. `({ lineHeight: 1.3 })` is accepted (float steps compare with a tolerance).
- [ ] **Step 2: Run** `npx vitest run src/main/setup` — expect the new tests to FAIL.
- [ ] **Step 3: Implement.** `AppSettings.terminalText?: TerminalText`; zod `terminalText: z.object({ fontSize: z.number(), lineHeight: z.number() }).optional()` inside `settingsV2`, which stays version 2 (an older build's `z.object` strips the unknown key, so it reads the file and drops the text settings at its next save: acceptable). `setTerminalText` merges onto the saved or default value, validates against `TERMINAL_TEXT_LIMITS` (in range, on a step within 1e-9), throws `Error('Terminal text size must be 10 to 20 px')` / `'Line height must be 1.0 to 1.6'`, then `save`. IPC handler accepts only numeric `fontSize`/`lineHeight` from the page, as `setAgentOptions` does.
- [ ] **Step 4: Run** `npx vitest run src/main/setup` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat: terminal text size and line height are kept in settings`

### Task 2: Terminal text in Settings, applied live

**Files:**
- Modify: `src/renderer/src/settings/SettingsDialog.tsx` (new "Terminal text" section)
- Create: `src/renderer/src/terminal/terminalText.ts` (+ `terminalText.test.ts`)
- Modify: `src/renderer/src/terminal/TerminalView.tsx`, `src/renderer/src/terminal/terminalFont.ts` (only if a new size needs a load), `src/renderer/src/app.css`
- Test: `e2e/terminal.e2e.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `SettingsView.terminalText`, `window.mainframe.setTerminalText`, `TERMINAL_TEXT_LIMITS`, `settingsView()` from `settingsStore.ts`, `redrawAllTerminals()` from `registry.ts`.
- Produces: `terminalTextChanged(term: { options: { fontSize?: number; lineHeight?: number } }, text: TerminalText): boolean` — sets both options, returns whether either changed (so the caller refits and redraws only then).

- [ ] **Step 1: Write the failing tests**
  - `terminalText.test.ts`: `'applies a new size and says it changed'`; `'the same values change nothing'` (returns false, options untouched).
  - `e2e/terminal.e2e.ts`: `'terminal text size and line height change from Settings without a restart'` — open Settings, set size to 16 and line height to 1.3 through the section's controls (`data-testid="settings-font-size"`, `"settings-line-height"`), then a running task's terminal reports `term.options.fontSize === 16` and `lineHeight === 1.3` (read through the e2e hooks the suite already uses, or the `.xterm-rows` inline `font-size: 16px`), and its PTY got a resize (rows changed). Then relaunch the app: the terminal opens at 16.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/terminal/terminalText.test.ts` — FAIL; e2e FAIL.
- [ ] **Step 3: Implement.** In `TerminalView`, open the terminal with `settingsView()?.terminalText ?? TERMINAL_TEXT_DEFAULT` over `TERMINAL_OPTIONS`; a `createEffect(on(() => settingsView()?.terminalText, …, { defer: true }))` calls `terminalTextChanged` and, when true, `fitToContainer()` and `redrawAllTerminals()`. The Settings section: two controls (a stepper or slider each, showing the value: "13 px", "1.0"), saving on change through `setTerminalText`, an error line on rejection like the other sections. No restart note unless building finds a case that needs one (then add the note under the controls). Invoke `frontend-design:frontend-design` for the section.
- [ ] **Step 4: Run** the unit test, `npm test`, `npm run typecheck`, `npm run build && npx playwright test e2e/terminal.e2e.ts` — PASS.
- [ ] **Step 5: Changelog** `New: Settings can make the terminal text larger and give it more line height.`
- [ ] **Step 6: Commit** `feat: terminal text size and line height in Settings, applied to open terminals at once`

### Task 3: Each agent lists its models and efforts

**Files:**
- Modify: `src/shared/types.ts`, `src/main/agents/agent.ts`
- Modify: `src/main/agents/claude.ts`, `src/main/agents/codex.ts`, `src/main/agents/opencode.ts` (reuse `opencodeSync.ts`'s model listing)
- Modify: `src/main/setup/agentsInUse.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`
- Test: `src/main/agents/claude.test.ts`, `codex.test.ts`, `opencode.test.ts`, `src/main/setup/agentsInUse.test.ts`
- Create: `src/main/agents/fixtures/codex-models.json` (a trimmed `codex debug models` output: two models, one hidden by `visibility`)

**Interfaces:**
- Produces (shared):
  ```ts
  export interface ModelChoice { id: string; name: string; efforts: string[] }
  /** `defaultEfforts`: what Effort offers while Model is Default. */
  export interface ModelChoices { models: ModelChoice[]; defaultEfforts: string[] }
  ```
- Produces (`AgentAdapter`): `taskModels(o: { bin: string; dataDir: string; env: Record<string, string> }): Promise<ModelChoices>`.
- Produces: `AgentsInUse.taskModelChoices(name: AgentName): Promise<ModelChoices>`; IPC `IPC.taskModelChoices = 'tasks:model-choices'`; `MainframeApi.taskModelChoices(agent: AgentName): Promise<ModelChoices>`.

- [ ] **Step 1: Write the failing tests**
  - Claude: `'lists its aliases and effort levels'` — models `fable, opus, sonnet, haiku` (names "Fable", "Opus", "Sonnet", "Haiku"), each with efforts `['low','medium','high','xhigh','max']`; `defaultEfforts` the same. Check the alias set and levels against `claude --help` and Claude Code's model docs before writing the test.
  - Codex: `'lists the catalog models it shows, with each model's efforts'` — from the fixture: only `visibility: 'list'` models, `id` = `slug`, `name` = `display_name`, `efforts` = `supported_reasoning_levels[].effort`; `defaultEfforts` = efforts every listed model supports. `'an unreadable catalog rejects'` — bad JSON rejects with an Error naming Codex.
  - OpenCode: `'lists the models the sync lists, with variants as efforts'` — fake run output with one model carrying variants and one without (`efforts: []`); `defaultEfforts: []`. Look up whether `api model.list` entries carry variants; if they don't, `efforts` is always `[]`.
  - `agentsInUse.test.ts`: `'an agent that isn't found has no model choices'` rejects.
- [ ] **Step 2: Run** `npx vitest run src/main/agents src/main/setup` — FAIL.
- [ ] **Step 3: Implement** each adapter's `taskModels`. Claude: constant list in `claude.ts`. Codex: run `<bin> debug models` with the agents' env (the same runner style as `codexInstructions.ts`), parse with zod, keep `visibility === 'list'`. OpenCode: call the existing listing (`listModels` in `opencodeSync.ts`; extract a shared helper if it's private) and map.
- [ ] **Step 4: Run** the tests and typecheck — PASS.
- [ ] **Step 5: Commit** `feat: each agent lists the models and efforts a task can start on`

### Task 4: A task starts, reopens and continues on its picked model and effort

**Files:**
- Modify: `src/main/tasks/taskStore.ts` (`TaskRecord.model?`, `effort?`, load/save validation)
- Modify: `src/main/agents/agent.ts` (`TaskStart`, `TaskReopen`)
- Modify: `src/main/agents/claude.ts`, `codex.ts`, `opencode.ts` (argv/env)
- Modify: `src/main/tasks/taskService.ts` (`start`, `reopen`, `continueTask`, `reopenInWorktree`), `src/shared/ipc.ts` (`startTask` req), `src/main/ipc.ts`
- Test: `claude.test.ts`, `codex.test.ts`, `opencode.test.ts`, `src/main/tasks/taskService.test.ts`, `taskStore.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter.taskModels` (Task 3).
- Produces: `TaskStart.model?: string; TaskStart.effort?: string`; same on `TaskReopen`; `startTask(dir, req: { title; description; noQuestions; agent?; model?: string; effort?: string })`; `TaskRecord.model?: string; TaskRecord.effort?: string`.

- [ ] **Step 1: Write the failing tests**
  - Claude argv: `'a picked model and effort go on the start and the resume'` — `--model opus --effort high` appear (before the prompt) in start and reopen argv; `'no pick, no flags'` — argv equals today's exactly.
  - Codex argv: `-m <model>` and `-c model_reasoning_effort="<effort>"` on start and on `resume --last` (confirm the key and that `resume` takes these options from Codex's config docs and `codex resume --help`).
  - OpenCode env: start and reopen env carry `OPENCODE_CONFIG_CONTENT` = `{"model":"<provider/model>"}` (variant only if Task 3 found a config key); with no pick, env equals today's `OPENCODE_ENV`.
  - `taskStore.test.ts`: model and effort round-trip; a record with a non-string model loads without it.
  - `taskService.test.ts`: `'the pick is saved and passed again on reopen'`; `'continue passes the pick again'`; `'a model the agent no longer lists reopens on Default with a warning'` (fake `taskModels` without it → reopen argv has no model flag, record loses `model` and `effort`, `warn` called); `'a model list that fails keeps the pick'` (rejecting `taskModels` → flags passed as saved). Claude tasks skip the check (its aliases don't retire).
- [ ] **Step 2: Run** the tests — FAIL.
- [ ] **Step 3: Implement.** The request's model and effort are trimmed strings or dropped; saved on the record; passed through `startLaunch`/`reopenLaunch`/`reopenInWorktree` into `TaskStart`/`TaskReopen`. The retired-model check runs in `reopen` and `continueTask` before the launch, for adapters other than Claude.
- [ ] **Step 4: Run** the tests, `npm test`, typecheck — PASS.
- [ ] **Step 5: Commit** `feat: a task starts on its picked model and effort, and keeps them on reopen`

### Task 5: Model and Effort pickers in New Task, with a help line

**Files:**
- Modify: `src/renderer/src/board/NewTaskDialog.tsx`, `src/renderer/src/tasksStore.ts` (`startTask` passes model/effort), `src/renderer/src/app.css`
- Create: `src/renderer/src/board/modelPick.ts` (+ `modelPick.test.ts`)
- Modify: `e2e/fake-claude.cjs` only if argv isn't already recorded (it is: `<pid>.argv`)
- Test: `e2e/tasks.e2e.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `window.mainframe.taskModelChoices(agent)`, `ModelChoices`.
- Produces (`modelPick.ts`):
  - `effortsFor(choices: ModelChoices | undefined, model: string | undefined): string[]` — `defaultEfforts` for Default, else the model's efforts, `[]` while loading.
  - `keptEffort(efforts: string[], effort: string | undefined): string | undefined` — the effort if still offered, else `undefined` (Default).
  - `SWITCH_HELP: Record<AgentName, string>` — the help line per agent.

- [ ] **Step 1: Write the failing tests**
  - `modelPick.test.ts`: `effortsFor(undefined, …)` is `[]`; Default gives `defaultEfforts`; a model gives its own; `keptEffort(['low','high'], 'max')` is `undefined`, `keptEffort(['low','high'], 'high')` is `'high'`. `SWITCH_HELP.claude` mentions `/model` and `/effort` and that a reopen starts on the pick made here.
  - `e2e/tasks.e2e.ts`: `'a task starts on the model and effort picked in New Task'` — pick Opus and high (`data-testid="new-task-model"`, `"new-task-effort"`), start, and the fake Claude's argv has `--model opus --effort high`. `'Default passes no model'` — argv has neither flag. `'the help line names how to switch in a running session'` — `data-testid="new-task-model-help"` text.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** A `createResource` keyed on the picked agent asks `taskModelChoices`; failures are logged and leave Default only. Model and Effort are `<select>`s under Agent, both starting on "Default"; changing the model applies `keptEffort`; Effort is hidden when `effortsFor` gives `[]`. The help line text per agent is checked against each CLI's current docs (Claude Code `/model`, `/effort`; Codex's and OpenCode's model commands) before writing `SWITCH_HELP`. Invoke `frontend-design:frontend-design` for the pickers' layout.
- [ ] **Step 4: Run** unit tests, typecheck, `npm run build && npx playwright test e2e/tasks.e2e.ts` — PASS.
- [ ] **Step 5: Changelog** `New: New Task can start a task on a chosen model and effort.`
- [ ] **Step 6: Commit** `feat: Model and Effort pickers in New Task, with how to switch in a running session`

### Task 6: Image lists in main, served by a protocol

**Files:**
- Create: `src/main/images/imageLog.ts` (+ `imageLog.test.ts`)
- Create: `src/main/images/imageProtocol.ts` (+ `imageProtocol.test.ts`)
- Modify: `src/shared/types.ts` (`ImageEntry`, `ManagerView.session.agent`)
- Modify: `src/main/tasks/taskService.ts` (`imagesDir`, clear on a new chat and on worktree removal)
- Modify: `src/main/manager/managerService.ts` (`imagesDir`, clear on a new chat, `agent` in the view)
- Modify: `src/main/projectRegistry.ts` (owner type gains `imagesDir`), `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` (register protocol; pass the paste folder)
- Modify: `src/renderer/index.html` (CSP `img-src 'self' data: mainframe-image:`)
- Test: `taskService.test.ts`, `managerService.test.ts`

**Interfaces:**
- Produces (shared):
  ```ts
  /** One image a conversation received through Mainframe. `number`: the agent's label number; null when the agent has no known label. */
  export interface ImageEntry { number: number | null; path: string; name: string }
  // ManagerView.session: { id: string; startedWithPrompt: boolean; agent: AgentName } | null
  ```
- Produces (`imageLog.ts`):
  - `readImages(dir: string): ImageEntry[]` — `[]` for a missing or unusable `images.json`.
  - `recordImages(dir: string, added: { path: string; number: number | null }[], pasteDir: string): ImageEntry[]` — a path inside `pasteDir` is moved into `dir` (rename, falling back to copy + unlink across volumes); others are kept as they are; appends and writes atomically (`writeJsonAtomic`); returns the whole list.
  - `clearImages(dir: string): void` — removes the folder; never throws (warns).
- Produces (owners): `imagesDir(sessionId: string): string | null` on `TaskService` (`<dataDir>/tasks/<id>/images`) and `ManagerService` (`<managerDir>/images/<agent>`).
- Produces (`imageProtocol.ts`): `IMAGE_SCHEME = 'mainframe-image'`; `imageUrl(sessionId: string, index: number): string` (shared, so the renderer builds URLs: put it in `src/shared/imageUrl.ts`); `resolveImageRequest(url: string, lookup: (sessionId: string) => ImageEntry[] | null): string | null` — the file path for a listed entry, else null.
- Produces (IPC): `getImages(sessionId): Promise<ImageEntry[]>`; `recordImages(sessionId, added: { path: string; number: number | null }[]): Promise<void>`; event `onImages(cb: (e: { sessionId: string; images: ImageEntry[] }) => void)`; `showImageInFolder(sessionId: string, index: number): Promise<void>` (`shell.showItemInFolder`, only for a listed entry whose file exists).

- [ ] **Step 1: Write the failing tests**
  - `imageLog.test.ts`: `'a pasted image moves into the conversation's folder'` (file gone from paste folder, entry path inside `dir`, name kept); `'a dropped file stays where it is'`; `'entries append in order and survive a read'`; `'a missing or broken list reads as none'`; `'clearing removes the folder and the list'`.
  - `imageProtocol.test.ts`: listed index → its path; index out of range, unknown session, a non-numeric index, `..` in the URL → null.
  - `taskService.test.ts`: `'a reopen that starts a new chat clears the task's images'`; `'a continue whose chat is gone clears them'`; `'a reopen that resumes keeps them'`; `'removing the worktree clears them'` (finish round and discard). Find every place a task gets a new chat id (`adapter.newSessionId` outside `start`, and `reopenInWorktree`) and cover each.
  - `managerService.test.ts`: `'a new manager chat clears that agent's images'`; `'a resumed chat keeps them'`; the view's session carries the agent.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The protocol is registered with `protocol.handle` on app ready (check Electron 44's docs for whether a custom scheme used in `<img>` must be registered as privileged first); it answers with the file (`net.fetch(pathToFileURL(path))`) or 404. `recordImages` IPC finds the owner with `projects.ownerOf(sessionId)`, records, then sends `onImages`. Keep today's emptying of the paste folder at start: unconfirmed pastes stay there and go at the next start.
- [ ] **Step 4: Run** tests, typecheck — PASS.
- [ ] **Step 5: Commit** `feat: each conversation keeps a list of the images it received, served to the page by a protocol`

### Task 7: Confirming numbers from the agent's label; Ctrl+V on the Mac

**Files:**
- Create: `src/shared/imageLabels.ts` (+ `imageLabels.test.ts`)
- Create: `src/renderer/src/terminal/imageWatch.ts` (+ `imageWatch.test.ts`)
- Modify: `src/renderer/src/terminal/keybindings.ts` (+ test), `src/renderer/src/terminal/TerminalView.tsx` (new `agent` prop; paste, drop, Ctrl+V)
- Modify: `src/renderer/src/panel/SessionPanel.tsx`, `src/renderer/src/manager/ManagerColumn.tsx` (pass `agent`)
- Modify: `e2e/fake-claude.cjs` (on a bracketed paste of an existing `.png`/`.jpg` path, print `[Image #N]`, counting from 1)
- Test: `e2e/terminal.e2e.ts`

**Interfaces:**
- Consumes: `recordImages`, `getImages` (Task 6), `ManagerView.session.agent`.
- Produces (`imageLabels.ts`):
  - `IMAGE_LABEL: Record<AgentName, RegExp | null>` — Claude `/\[Image #(\d+)\]/g`; OpenCode from a real paste (run the pty check below); Codex `null` unless it can be checked.
  - `IMAGE_EXTENSIONS: Record<AgentName, readonly string[]>` — the file types each agent takes as an image (check each).
  - `labelNumbers(text: string, label: RegExp): number[]`.
- Produces (`imageWatch.ts`): `newLabelNumbers(before: number[], now: number[], count: number): number[] | null` — the `count` smallest numbers in `now` above `max(before)`, ascending; `null` until `count` are there.
- Produces (`keybindings.ts`): new action `{ clipboard: 'paste-or-key' }` for Ctrl+V (no other modifier) on the Mac only.

- [ ] **Step 1: Check the labels.** Drive OpenCode in a pty (a throwaway Python `pty` script in the scratchpad, as the design's experiments did; run with `env -u CLAUDE_CODE_CHILD_SESSION`): bracketed-paste two PNG paths and read the label text; also try `codex` if it's signed in. Record the patterns.
- [ ] **Step 2: Write the failing tests**
  - `imageLabels.test.ts`: `labelNumbers('❯ [Image #3] see [Image #12]', IMAGE_LABEL.claude!)` is `[3, 12]`; text without labels gives `[]`.
  - `imageWatch.test.ts`: `newLabelNumbers([2], [1, 2, 3], 1)` is `[3]`; `newLabelNumbers([2], [2], 1)` is `null` (no label yet: the paste went into a question); `newLabelNumbers([], [4, 5], 2)` is `[4, 5]`; `newLabelNumbers([3], [3, 4], 2)` is `null`.
  - `keybindings.test.ts`: on darwin, Ctrl+V gives `{ clipboard: 'paste-or-key' }`; Ctrl+Shift+V and Ctrl+Option+V give nothing; on win32 and linux Ctrl+V stays `{ clipboard: 'paste' }`.
  - `e2e/terminal.e2e.ts`: `'a dropped image is recorded with the number the agent shows'` — drop a PNG on a fake-Claude task terminal; `getImages` gives one entry, number 1. `'an image the agent doesn't label isn't recorded'` — a fake-agent mode that ignores pastes; after the watch time, the list is empty.
- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement.** In `TerminalView`: before pasting image paths (paste or drop; only paths with the agent's image extensions count), read the label numbers in the last `SUGGESTION_SCAN_ROWS` rows of the buffer plus the numbers already in the list (`before`); paste; then every 100 ms for up to 3 s read the same rows (`now`) and call `newLabelNumbers`; on success `recordImages(sessionId, paths.map((path, i) => ({ path, number: numbers[i] })))`. For an agent with `IMAGE_LABEL` null, record at once with `number: null`. Mac Ctrl+V: `resolvePaste()`; a file or image pastes as Cmd+V does (with the watch); anything else sends `'\x16'` to the PTY. Pass `agent` from `SessionPanel` (the entry's task's `agent`) and `ManagerColumn` (`session.agent`).
- [ ] **Step 5: Run** unit tests, typecheck, `npm run build && npx playwright test e2e/terminal.e2e.ts` — PASS.
- [ ] **Step 6: Commit** `feat: a pasted or dropped image is recorded with the number the agent's label shows; Ctrl+V on the Mac pastes images through Mainframe`

### Task 8: The image strip, the full-size view, and clickable labels

**Files:**
- Create: `src/renderer/src/images/imagesStore.ts`, `ImageStrip.tsx`, `ImageViewer.tsx`, `images.css` (or rules in `app.css`, as the codebase does)
- Create: `src/renderer/src/terminal/imageLinks.ts` (+ `imageLinks.test.ts`)
- Modify: `src/renderer/src/terminal/TerminalView.tsx` (register the link provider), `src/renderer/src/panel/SessionPanel.tsx`, `src/renderer/src/manager/ManagerColumn.tsx`, `src/renderer/src/App.tsx` (mount the viewer once)
- Test: `e2e/terminal.e2e.ts` (or a new `e2e/images.e2e.ts`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `getImages`, `onImages`, `showImageInFolder`, `imageUrl`, `IMAGE_LABEL`, `linkClickHeld` from `keys.ts`.
- Produces:
  - `imagesStore.ts`: `imagesOf(sessionId: string): ImageEntry[]` (loads on first read, follows `onImages`); `openImage(sessionId: string, index: number): void`; `viewerState(): { sessionId: string; index: number } | null`; `closeImage(): void`.
  - `imageLinks.ts`: `labelRanges(line: string, label: RegExp): { start: number; end: number; number: number }[]` (columns of each label on a buffer line), used by an xterm `registerLinkProvider` whose `activate` opens the entry with that number when `linkClickHeld` (Cmd+click; Ctrl+click on Windows and Linux).
  - `stepIndex(index: number, length: number, delta: -1 | 1): number` — clamps (no wrap).

- [ ] **Step 1: Write the failing tests**
  - `imageLinks.test.ts`: `labelRanges('❯ [Image #3] see [Image #12]', IMAGE_LABEL.claude!)` gives `[{ start: 2, end: 12, number: 3 }, { start: 17, end: 28, number: 12 }]` (columns as xterm counts them; the `❯` is one column); `stepIndex(0, 3, -1)` is 0, `stepIndex(2, 3, 1)` is 2.
  - e2e: `'dropped images show in the strip under the terminal, numbered'` — drop two PNGs; two thumbnails `#1`, `#2` (`data-testid="image-thumb"`); the strip is absent before. `'Cmd+click on [Image #2] opens it full size; arrows step, Esc closes'` (Ctrl+click off the Mac). `'an image whose file is gone shows Not available'` — delete the second file, open it: "Not available", "The file has been moved or deleted.", its path, no Show in Finder. `'the manager's terminal has its own strip'`. `'two projects side by side each show their own images'`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the spec's "What the user sees" and the chosen mockup (option A in `.superpowers/brainstorm/`, if still on disk): strip under the well, hidden with no images, newest on the right, sideways scroll; viewer as a modal `<dialog>` over the window with number, name, natural size (from the loaded `<img>`), ←/→, Esc, close button, Show in Finder (label "Show in Explorer" on Windows, "Show in Folder" on Linux). A thumbnail or viewer whose `<img>` fails to load shows the hatched "Not available" state. The link provider is registered only when the terminal's agent has a label. Invoke `frontend-design:frontend-design` for the strip and viewer.
- [ ] **Step 4: Run** unit tests, `npm test`, typecheck, the e2e file — PASS.
- [ ] **Step 5: Changelog** `New: Images pasted or dropped into a session show as numbered thumbnails under its terminal, and Cmd+click on [Image #N] (Ctrl+click on Windows and Linux) opens one full size.`
- [ ] **Step 6: Commit** `feat: a strip of the session's images, a full-size view, and clickable image labels`

---

After Task 8: the branch gets `/simplify main...HEAD`, the full suites, the final whole-branch review, then `/code-review high main...HEAD`, as the project's `CLAUDE.md` sets out.
