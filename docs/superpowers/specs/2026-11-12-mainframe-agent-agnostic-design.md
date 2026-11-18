# Design: Mainframe without a required agent

2026-11-12, worktree `agent-agnostic`. Written after a brainstorm with the owner, who looked at two mockups:
- `docs/superpowers/mockups/2026-11-12-agent-agnostic-first-start.html`
- `docs/superpowers/mockups/2026-11-12-agent-agnostic-settings.html`
- `docs/superpowers/mockups/2026-11-12-agent-agnostic-settings-cog.html` (where the cog sits)

It builds on:
- `docs/superpowers/findings/2026-11-12-other-agent-clis.md`
- `docs/superpowers/findings/2026-11-12-opencode-manager-and-sync.md`, which has the OpenCode facts, the hand checks and the owner's decisions behind this design
- `docs/superpowers/specs/2026-11-12-mainframe-opencode-tasks-design.md`, already merged, which lets a task run on OpenCode

Decisions the owner made are marked **(owner)**. Decisions the designer made on the owner's behalf are marked **(designer's call)**; the owner may overturn them.

## 1. Why

- Mainframe is for friends to run on their own projects, and some of them have only OpenCode **(owner)**. Today Mainframe won't start without a working `claude`. The manager and the Todo sync also run only on Claude Code, so an OpenCode-only friend has no Mainframe at all.
- A friend with both agents may want one of them out of sight **(owner)**.
- The goal is that Claude Code becomes optional. Every part of Mainframe works on either agent: the manager, the Todo sync and the tasks **(owner)**.

## 2. Goals, non-goals, anti-goals

**Goals**
- **First start:** Mainframe asks which agents to use and, if more than one, which is the default **(owner)**.
- **A Settings screen** where those choices can be changed later. It is built so more settings can join it later, such as a theme **(owner)**.
- **The manager runs on OpenCode** when OpenCode is the default agent.
- **The Todo sync runs on OpenCode** when OpenCode is the default agent.
- **A warning for a long Todo sync,** on both agents **(owner)**.
- **One place in the code per agent** (an agent adapter), so the manager, the sync and the tasks ask the adapter instead of each knowing about Claude Code or OpenCode.

**Non-goals**
- Agents other than Claude Code and OpenCode, such as Codex or Copilot. The adapter should make one easy to add later. This branch adds none.
- A spending cap on the sync. A long sync gets a warning instead **(owner)**.
- A default agent per project. Settings apply to the whole app **(designer's call)**.
- A theme or any other new setting beyond those listed here. The screen only leaves room for them.
- Moving a manager chat from one agent to the other.

**Anti-goals: it fails if…**
- …an OpenCode-only user meets anything that needs Claude Code: a red check, an error, a hidden panel, or text that says "Claude Code" about their own sessions.
- …a Claude-only user's Mainframe behaves differently from today, apart from the new first-start step and the Settings screen.
- …an OpenCode sync can write to the user's tracker, or run a shell, an edit or any tool the user didn't confirm.
- …any launch leaves out `--standalone`. Without it, OpenCode can join its background service, which never sees Mainframe's per-launch config (findings: "`--standalone` is required on every launch").
- …it adds a one-project assumption (`CLAUDE.md`: two projects open side by side must both work), or a value from the owner's machine (`CLAUDE.md`: Mainframe is project-agnostic).

## 3. First start

See the first-start mockup. It is the setup screen as it is today, written out like a terminal, with one new step.

- **The checks.** Mainframe looks for git, `claude` and `opencode`, with a line for each, as it looks for them today.
  - git stays required.
  - An agent that is missing, too old or broken shows in grey, with "How to install ↗" and "Find…". It is not an error, as long as another agent works.
  - Only when no agent works does the screen show an error. It then offers both install links and "Look again".
  - `MAINFRAME_CLAUDE_BIN` and `MAINFRAME_OPENCODE_BIN` keep their meaning: when one is set, it is the only place looked for that agent.
- **"Which agents should I use?"** has a tick box for each agent **(owner)**. Every agent that works starts ticked. One that doesn't work can't be ticked until it is fixed. At least one must stay ticked.
- **"Which one runs the manager, the Todo sync and new tasks?"** appears only when two are ticked **(owner)**. Claude Code is picked to start with *(designer's call)*. Under it, a line says the New task box can still pick the other one for a single task, and that Settings can change all of this.
  - With one agent ticked, there is no question. A line says that agent runs everything.
- **"Which project should I open first?"** comes last, as today.
- **The welcome** says "coding agent sessions" where it now says "Claude Code sessions" **(designer's call)**.
- **Someone upgrading** from an earlier Mainframe skips this step. Their settings start with Claude Code ticked and as the default, plus OpenCode ticked if it is found **(designer's call)**. Nothing changes for them until they open Settings.
- **At a later start**, the setup screen appears only when no ticked agent works, or git doesn't. This is how today's "Something moved" screen works.
  - When the default agent stops working but another ticked agent works, Mainframe starts with that one as the default for this run. It shows a notice saying so **(designer's call)**. Settings is unchanged, so the default comes back once it works again.

## 4. Settings

See the Settings mockup.

- **Where:**
  - It is a dialog over the window, with the window dimmed behind it in the same way as the New task box **(owner)**.
  - It opens from a cogwheel icon at the far right of the window's top row, after "Next that needs you" **(owner)**. It is a toothed cog, not a sun with rays **(owner)**, drawn in the same stroke style as the row's other icons, with the tooltip "Settings". There is always exactly one cog, in the window's top-right corner. With projects side by side or in a grid, it sits at the end of the top-right pane's bar.
  - On the Mac it also opens from Mainframe ▸ Settings… (⌘,), the Mac's usual place.
  - Windows and Linux have no menu bar on purpose (`index.ts` sets none, so that Ctrl+W, reload and zoom stay away). There, Ctrl+, opens it, and the page catches the key before a focused terminal takes it, as `windowKeys.ts` does for Mainframe's other keys. No menu bar is added.
- **The layout** is a list of titled sections, so later settings (Appearance, say) become another section **(owner)**.
- **Agents section:**
  - A row per agent: a tick box, its version, its path and "Find…". A row for an agent that doesn't work says why, as the setup screen does.
  - Then the default agent, as at first start, shown only when two are ticked. Under it: "Runs the manager, the Todo sync and new tasks. Tasks that are already running keep their own agent."
- **OpenCode section,** shown while OpenCode is ticked:
  - **Manager's agent:** "Your default" (OpenCode's own default agent, named in brackets) or any primary agent the user has set up in OpenCode **(owner: the default, changeable in Settings)**. For a while, the user can also switch agents inside the manager's terminal, with OpenCode's own key **(owner)**. See §6 for the open point on this setting.
  - **Todo sync model:** the user's models, cheapest first, each with its price per million tokens in and out **(owner)**. A model with no known price comes last, marked "price unknown". It is empty until the first OpenCode sync asks (§7).
- **Settings apply to the whole app,** for every open project **(designer's call)**. They are saved in `settings.json` (§9).
- **A change applies from the next launch of each thing:**
  - Tasks that are running, or closed and reopened, keep the agent they were started on.
  - New tasks take the new default at once.
  - The manager switches at its next start (§6).
  - The sync switches at its next run (§7).
  
  The dialog says this in one line under the default agent **(designer's call)**.
- **Unticking an agent** hides it from the New task box and from the default choice. Its existing tasks still show on the board, and still reopen while the program works **(designer's call)**. Unticking the default asks for another default first. The last ticked agent can't be unticked.

## 5. The agent adapter

Today Claude Code's launch is in `tasks/launch.ts`, OpenCode's in `tasks/opencode.ts`, the program checks in `setup/programChecks.ts`, and the environment in `pty/spawnEnv.ts`. `TaskService` picks a launch by the task's agent. The earlier design kept this split until "the manager moves too". It does now, so the code moves into one adapter per agent **(designer's call)**: `src/main/agents/claude.ts` and `src/main/agents/opencode.ts`, behind one interface in `src/main/agents/agent.ts`.

An adapter holds everything Mainframe knows about its agent:

- **Finding and checking:** its places, its version line, its minimum version, and its environment variable.
- **A task:** start and reopen, each giving argv, cwd and env. Also whether Mainframe makes the worktree (OpenCode) or the agent does (`claude -w`).
- **The manager:** its launch, given the MCP server's URL and token, the role prompt, and whether it carries on.
- **The sync:**
  - its run, given the step and the confirmed tools;
  - how it reads the run's output into a `SyncAnswer`;
  - its check of a confirmed tool's name (`mcp__server__tool` for Claude Code, `server_tool` for OpenCode).
- **The words:** its display name, and how the prompts name the repo's instructions file:
  - Claude Code: `CLAUDE.md`, as today;
  - OpenCode: "`AGENTS.md`, or `CLAUDE.md` when there is no `AGENTS.md`", as the OpenCode opening prompt already does.
- **Environment:** the variables `spawnEnv` drops for it.

Rules for the adapter:
- **A Claude Code launch stays exactly as it is today**, byte for byte in its argv. The adapter is a move, not a rewrite.
- **`AgentName` (`'claude' | 'opencode'`) stays the key everywhere.** Records, IPC and the renderer already use it.
- **Nothing outside `src/main/agents/` names a CLI flag, a config key or a file layout of either agent.**

## 6. The manager on OpenCode

The manager runs on the default agent. Everything below comes from the findings and was checked by hand there.

- **The launch:** `opencode --standalone -s <id> [--prompt <carry-on>]`, in the project's main checkout.
  - The environment has the tabs-off `OPENCODE_CLI_CONFIG_CONTENT` that tasks already use, and an `OPENCODE_CONFIG_CONTENT` holding:
    - **The MCP server:** `mcp.servers.mainframe = {type: "remote", url, headers: {Authorization: "Bearer <token>"}, oauth: false}`. `oauth: false` is required: without it OpenCode tries OAuth discovery.
    - **The rules:**
      - `allow` for `mainframe_list_sessions` and `mainframe_sync_todo`;
      - `ask` for `mainframe_start_task`. OpenCode allows every tool by default, while on Claude Code `start_task` goes through the owner's permission mode. Without this rule it ran unasked in the hand checks.
      - The rules go at the top level and again under the agent that runs the manager, because an agent's own rules come last and win.
    - **The role prompt:** `instructions: ["<file>"]`. Mainframe writes the role prompt into the manager's folder in the data folder, because `instructions` takes only file paths.
  - The role prompt names the agent's instructions file through the adapter's words (§5).
- **The chat:** Mainframe makes the id (`ses_` and 28 hex characters, as tasks do) and saves it in `manager.json`. `-s` both starts and continues it, so OpenCode's manager needs no SessionStart hook and no `readResumableSession`. `/new` inside the manager isn't followed, as with OpenCode tasks.
- **Switching the manager's agent** (the default changes in Settings) starts a new chat at the manager's next start.
  - `manager.json` keeps one chat per agent, so switching back carries on the old one **(designer's call)**.
  - A Claude Code record that is already there stays as it is, so a manager chat from before this branch still resumes.
- **The manager's agent setting (§4):**
  - OpenCode's TUI has no `--agent` flag (it has none of `run`'s flags; even `-m` is refused).
  - **The builder must find out** whether config can choose the TUI's starting agent (a `default_agent` key, or similar in `schema/src/config.ts` of OpenCode 2.2.7). If it can, the setting sets it for the manager's launch only. If it can't, the setting is left out. The manager then runs OpenCode's default agent, and the user switches inside the terminal **(owner: switching in the terminal is fine)**.
  - Either way, Mainframe must know which agent the manager runs, to put its rules under that agent. The builder finds how OpenCode reports its default and its agents (`opencode --standalone debug agents` lists them).
- **Tasks the manager starts** run on the default agent. `start_task` gets no agent argument **(designer's call)**. The same goes for tasks started from a Todo card, which the earlier design kept on Claude Code.
- **The model** is the user's own OpenCode default. Mainframe sets none for the manager.

## 7. The Todo sync on OpenCode

The sync runs on the default agent. On Claude Code it stays exactly as it is.

### The run

- **argv:** `opencode run --standalone --format json --agent mainframe-sync --title sync --archived -m <the sync model>`. The prompt goes on stdin. Never `--auto`: it says yes to every "ask".
- **cwd:** an empty folder of Mainframe's, per project, in the data folder. `env.PWD` is set to the same folder, because `opencode run` takes its folder from `PWD` before `cwd`.
- **env:**
  - `OPENCODE_DISABLE_PROJECT_CONFIG=1`, because the sync reads the user's own OpenCode config but not the project's `opencode.json`, plugins or rules **(owner)**;
  - **the project's instructions file, handed over by path:** `instructions: ["<projectDir>/AGENTS.md"]`, or `CLAUDE.md` when there is no `AGENTS.md`, or nothing when there is neither **(owner)**.
    - The sync prompts lean on that file to pick the list, and to mark a card `forOwner` or `urgent`. `forOwner` is what keeps Mainframe from starting an agent on a card meant for the owner. On Claude Code the sync reads `CLAUDE.md` because it runs in the project folder.
    - OpenCode loads `instructions` it is handed even with project config off: `core/src/config/plugin/instruction.ts` treats them as explicit requests, not discovery.
    - This narrows the owner's decision 3 in the findings: "skip the project's config" means its OpenCode setup, not its instructions file.
  - `OPENCODE_DISABLE_CLAUDE_CODE=1`;
  - `OPENCODE_CONFIG_CONTENT` with the step's rules, put at the top level and again under `agents.mainframe-sync` (`mode: "primary"`, `steps: 12`);
  - `agents.title.disabled: true`, so no extra model call writes a title.
- **The rules for each step:**
  - **Discover** (the first sync): `*` ask, `execute` deny, and deny for OpenCode's own tools that write or run things (`shell`, `write`, `edit`, `subagent`, `webfetch`, `opencode_*`).
    - The model sees every tool by name, including the connectors' tools, and every call it tries is refused, because `run` refuses every "ask". Denying `execute` turns off OpenCode's `execute` wrapper (findings: "Code Mode"), so the tools show by name.
    - The prompt asks the model to name the connector and its read-only tools without calling any, as on Claude Code.
  - **Read:** `*` deny, plus an allow for each confirmed tool by its exact name. A denied tool isn't offered to the model at all.
- **The answer:**
  1. The prompt gives the answer's shape (`SYNC_ANSWER`) in words and asks for one JSON object, with no code fence.
  2. Mainframe joins the `text` events of the message whose `step_finish` has `reason: "stop"`, and strips a stray fence.
  3. It parses that and checks it with `SYNC_ANSWER`, ignoring unknown keys.
  4. **It fails** on an `error` event, a non-zero exit with no answer, or a missing or invalid answer, with a message for the panel as today. One retry that quotes the validation error is the builder's call.
  5. **A tool check of Mainframe's own:** a `tool_use` event that names a tool outside the confirmed ones, with status `completed`, fails the sync.
- **After each run**, Mainframe deletes the run's session (`opencode --standalone session delete <id>`; the id is in every event). It ignores a failure there, because `--archived` already keeps the session out of the user's lists.
- **Stopping:** Stop and the time limit send SIGTERM, as today. The hand checks showed the run and its connectors end within seconds.
- **The connectors** come only from the user's OpenCode config. When discover finds none, the panel says to set up the tracker in OpenCode, and says which agent it looked in **(designer's call)**.

### The sync model

- **The first OpenCode sync asks for a model before it runs** **(owner)**. The Todo panel lists the user's models from `opencode --standalone api model.list`, cheapest first, with the cheapest one with a known price picked.
  - Mainframe keeps only each model's id, name, status and price.
  - **That output can hold API keys** (a provider's `settings`). It is never logged, saved or sent to the renderer whole.
- The choice is saved in `settings.json` and can be changed in Settings (§4).
- If the saved model is gone (the user removed the provider), the panel asks again.

### Confirmed tools and the switch between agents

- The confirmed connector and tools are saved with the agent they were found on **(designer's call)**. Claude Code names Trello's tools `mcp__trello__…` and OpenCode names them `trello_…`, so a switch of the default agent starts the sync at discover again. The cards and notes already shown stay.

## 8. A long sync, on both agents

- After 2 minutes, the Todo panel shows **"Still syncing (2 min). Large syncs can use a lot of tokens."**, with **Stop** and **Keep going** **(owner)**.
- Keep going hides the line, and the sync runs to the 5-minute limit, as today.
- Stop stops it, as the panel's Stop does today.
- On Claude Code, the `--max-budget-usd 1` cap stays as well.

## 9. What is saved

- **`settings.json` goes to version 2** **(designer's call)**. It holds:
  - for each agent: whether it is ticked, and the path found last;
  - the default agent;
  - the welcome as seen;
  - OpenCode's manager's agent (when §6 allows it) and the sync model.
  
  Version 1 is read and turned into version 2 as §3 says for an upgrade: `claudeBin` becomes Claude Code's path. A file from a newer Mainframe is refused, as now.
- **`manager.json`** gains the agent of each chat and the OpenCode chat's id. The builder chooses between optional fields and a new version, under the rule that today's file still resumes its Claude chat.
- **The Todo record** saves the agent with its confirmed tools (§7). A record without the agent belongs to Claude Code.
- **The New task box** stops remembering the last agent per project (`board/agentPrefs.ts` and its `localStorage` key go). It starts on the default agent each time **(designer's call)**.

## 10. What Claude Code-only parts become optional

- **Node** is needed only for the hooks Mainframe writes for Claude Code (`index.ts` checks for it at start). When Claude Code isn't ticked, a missing Node doesn't stop Mainframe.
- **The suggestion ring** stays Claude Code's: it reads Claude Code's own screen. That doesn't change.
- **Text:** every "Claude Code" in the UI that is about the user's own sessions becomes the agent's name, or "agent" where both are meant. This covers the setup screen, the New task box and the Todo panel's messages. The README says Claude Code or OpenCode.

## 11. Checks before acceptance

- **Unit tests:**
  - each adapter's argv, cwd and env for a task, the manager and both sync steps, with Claude Code's exactly as today;
  - the OpenCode sync's answer read from recorded events: a good answer, a fenced one, an invalid one, an `error` event, and a tool outside the confirmed ones;
  - `settings.json` version 1 turned into version 2;
  - `manager.json` from before this branch still resuming;
  - the first-start step's choices, and the setup for an OpenCode-only user;
  - the long-sync line at 2 minutes.
- **E2E:** the fake `opencode` already used for tasks also plays the manager and `run`:
  - first start with only OpenCode, choosing it, and opening a project;
  - the manager starting on OpenCode;
  - a sync's discover and read steps;
  - Settings switching the default agent.
- **By the owner, by hand:**
  - first start with OpenCode only (`MAINFRAME_CLAUDE_BIN` pointing nowhere);
  - the manager on OpenCode listing tasks and asking before it starts one;
  - a real Todo sync through a connector set up in OpenCode;
  - switching the default back and forth in Settings.

## 12. Left to the builder

- The adapter's exact interface, and how `TaskService`, `ManagerService` and `TodoService` are given their adapter.
- How the sync's events are read: as they arrive, or once the run ends.
- One retry on an invalid answer, or none.
- The look of the Settings dialog and the first-start step, within the mockups and the app's current style (`src/renderer/src/app.css`).
- How Settings reaches main: its IPC and its events. Every call that touches a project names that project, as the rest of Mainframe's IPC does.
- Whether a Claude Code sync's tool names can be turned into OpenCode's (`mcp__trello__x` to `trello_x`) instead of a new discover. This is allowed only if it is certain, since a wrong tool name fails safe, but only after a wasted run.
