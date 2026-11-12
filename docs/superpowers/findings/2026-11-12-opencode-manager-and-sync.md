# Findings: the manager and the Todo sync on OpenCode

Research on 2026-11-12, worktree `multi-agent-research`. It follows `2026-11-12-other-agent-clis.md` and the OpenCode tasks design, which kept the manager and the sync on Claude Code. Everything here was read in OpenCode 2.2.7's source (tag `v2.2.7`). Points marked *(ran)* were also checked with the installed `opencode v2.2.7`. The checks with a model are under "Checked by hand". Nothing has been tried in Mainframe itself yet.

## In short

- **The manager can run on OpenCode, with almost no gaps.** One `OPENCODE_CONFIG_CONTENT` gives it Mainframe's MCP server with its token, the allow rules and the role prompt. The role prompt must be a file. `-s <id>` already creates or continues the chat, so the manager needs no SessionStart hook and no look at transcript files.
- **The sync can run on OpenCode, but it has no structured answer and no spending cap.**
  - Mainframe puts the schema in the prompt, then reads the JSON out of the run's events and checks it with the `SYNC_ANSWER` schema it already has.
  - The read-only guard is permission rules. A denied tool is not even offered to the model.
  - **Cost:** Mainframe can list the user's models with their prices and let them pick a cheap one, as the owner suggested. It can also add up each step's cost and stop the run past a limit of its own.
- **`--standalone` is required on every launch, not optional.** Without it OpenCode connects to its background service, if one is running, and that service never sees Mainframe's per-launch environment. The sync's read-only rules would then be silently lost, and the owner's own rules (shell, edit: allow) would apply. One was running on this Mac during the research *(ran)*.
- **OpenCode never reads `CLAUDE.md`.** It reads `AGENTS.md` only. Its only Claude Code import is skills from `.claude/skills`. Every prompt Mainframe gives OpenCode must name the instructions file itself.

## How OpenCode takes config for one launch

- `OPENCODE_CONFIG_CONTENT` is a JSON config document read by the server (`core/src/config.ts:291-303`). It ranks above the user's global config, the project's config and `OPENCODE_CONFIG`. Only managed (MDM or system) settings rank above it (`config.ts:367-377`) *(ran: it loads last)*.
- `--standalone` starts a private server as a child with the environment passed on (`cli/src/services/standalone.ts:17-33`). That server stops when its stdin closes, so a killed TUI or run takes it down.
- How layers merge:
  - `permissions` arrays are joined in load order, and the last rule that matches wins (`core/src/permission.ts:94-104`, `findLast`). A rule is `{action, resource, effect}` with `effect` `allow`, `deny` or `ask`. When no rule matches, the answer is `ask`.
  - An agent's own `agents.<id>.permissions` are added after all the top-level ones (`core/src/config/plugin/agent.ts:64-73, 102-104`). So a user's `agents.build.permissions` beats Mainframe's top-level rules.
  - `mcp.servers` entries replace each other by name. `agents` merge by id.
- Other switches: `OPENCODE_DISABLE_PROJECT_CONFIG=1` skips the project's config and its `AGENTS.md`. `OPENCODE_DISABLE_CLAUDE_CODE=1` skips `.claude` skills. `OPENCODE_CONFIG_DIR` replaces the global config folder (`cli/src/server-process.ts:119-143`).
- An MCP tool is named `<server>_<tool>`, with every character outside `[A-Za-z0-9_-]` turned into `_` (`core/src/tool/runtime.ts:288-293`). That name is used both for the model and for permission rules: `mainframe_list_sessions`, `trello_trelloReadCard`.

## The manager

| What Claude Code gets | OpenCode |
|---|---|
| `--mcp-config` with the bearer token | `mcp.servers.mainframe = {type: "remote", url, headers: {Authorization: "Bearer …"}, oauth: false}`. `oauth: false` matters: without it OpenCode treats the server as an OAuth one and tries OAuth discovery on a 401 (`core/src/mcp/index.ts:241`). |
| Tool timeout of 6 minutes | Each call's default timeout is already 12 hours (`core/src/mcp/client.ts:37-40`). `timeout.execution` sets it in ms. Connecting and listing tools get 30 s each. |
| `--settings` allow rules | `permissions: [{action: "mainframe_list_sessions", resource: "*", effect: "allow"}, …]` |
| `--append-system-prompt` | `instructions: ["<file>"]`, which is added as its own system part beside the default prompt (`core/src/session/model-request.ts:121-124`). It takes file paths, globs or http(s) URLs only, never text, so Mainframe writes the role prompt into the manager's folder. An agent's `system` field would replace OpenCode's prompt, so it is not used. |
| `-n` and `--session-id`, `--resume` | `-s <id>` creates the session with exactly that id, or continues it (`cli/src/commands/handlers/default.ts:53-61`). With `--prompt` the text is sent as a new turn (`tui/src/routes/session/index.tsx:624-631`). |
| SessionStart hook and `readResumableSession` | Not needed: Mainframe chooses the id and `-s` handles a chat that was never saved. `/new` inside the manager isn't followed, as for OpenCode tasks. |

- No first-use approval for an MCP server, and nothing blocks 127.0.0.1 (`core/src/mcp/client.ts:603` treats loopback servers as normal).
- If an existing id was made in another folder, `-s` reopens it in that folder, not in the folder it was launched from. For the manager this doesn't matter: its id is its own.
- `opencode debug config` shows the `Authorization` value as `***`, so it can't be used to check that the token arrived.

- **OpenCode allows everything by default.** Its built-in rule is `*` allow (`schema/src/agent.ts:46-51`), so a tool no rule names runs without asking. On Claude Code, `start_task` goes through the owner's permission mode. To keep that, the manager also needs `{action: "mainframe_start_task", resource: "*", effect: "ask"}`. *(ran: without it `start_task` ran unasked; with it, it stopped at "Permission required".)*
- **The TUI has no `-m` flag.** A model for one launch goes in the config's `model` key.

### Still to check for the manager

1. **A user's own agent rules.** The manager runs the user's default agent (the owner's decision). A user's `agents.<that agent>.permissions` would come after Mainframe's top-level rules and beat them. Putting Mainframe's rules under that agent as well fixes it, which needs the agent's id. Find how the TUI picks its default agent (a `default_agent` key?). Untested: the owner's config has no agent rules.

## Checked by hand

All checks ran on 2026-11-12 with `opencode v2.2.7`, `litellm/claude-haiku-5-5` and a fake MCP server, with every piece of config given per launch. The fake server had a read tool, a write tool and a slow tool. The owner's own config was not changed, and every test session was deleted afterwards.

- **Sync rules** (`*` deny plus an allow for the read tool, in both places):
  - Haiku called only the read tool and never saw the write tool. Asked to delete a card, it answered that it had no tool for that.
  - It answered clean JSON, with no fence. It added one key it wasn't asked for, which a schema check that ignores unknown keys accepts.
  - OpenCode's `skill` tool is still offered under `*` deny, because a built-in rule about one skill comes after Mainframe's. Calling any other skill is still denied.
  - The run cost $0.0006 by its own `step_finish` count.
  - The connector closed as the run ended.
- **Stopping a run:** a SIGTERM while a tool call was waiting ended the run (exit 143) and the connector closed within seconds. Nothing was left running.
- **A failed run:** with an expired provider key, the run printed one `error` event (`provider.auth`, with the provider's message) and exited 1.
- **Finding the connector, two ways that both work:**
  - **With the server's name:** `*` deny plus `{action: "tracker_*", effect: "ask"}`. The model saw the connector's three tools, and its call was refused with "This non-interactive run cannot ask the user for permission".
  - **With no name:** `*` ask plus `{action: "execute", effect: "deny"}`, which turns the `execute` wrapper off. The model saw every tool by name, the connector's and OpenCode's built-in ones, and every call was refused.
  - OpenCode's own tools are either unprefixed (`read`, `shell`) or `opencode_…`. The connectors' tools are `<server>_…`.
  - If some built-in tool runs without asking for permission, the no-name way would let it run. Denying the built-in tools that write by name as well (`shell`, `write`, `edit`, `subagent`, `webfetch`, `opencode_*`) closes that.
- **Manager:**
  - The TUI connected to a bearer-token server on 127.0.0.1 with `oauth: false` and no OAuth attempt.
  - The role prompt from an `instructions` file reached the model: it passed the code word that only that file held.
  - The allowed tool ran without asking.
  - With the `ask` rule, `start_task` showed "Permission required", and the terminal reported `state=blocked:kind=permission`, which is Mainframe's Needs you lane.
  - **Code Mode** makes no difference to these rules. With it on, the calls go through `execute` (shown as `mainframe.list_sessions`). With `codemode: false` on the server, the tools are offered by name. Each rule held both ways.
  - The OSC 7501 record id is the session id Mainframe chose.

## The Todo sync

### The run

```
opencode run --standalone --format json --agent mainframe-sync --title sync --archived -m <provider/model>
```

- The prompt goes on stdin (with no message argument, `run` reads stdin to the end, `cli/src/run/run.ts:67-73`).
- `cwd` is an empty folder of Mainframe's.
- `env` also needs `PWD` set to that same folder, because `run` takes its folder from `process.env.PWD` before `cwd` (`run.ts:62`). Mainframe's own PWD would otherwise decide which `AGENTS.md` and project config are read.
- Plus `OPENCODE_DISABLE_PROJECT_CONFIG=1`, `OPENCODE_DISABLE_CLAUDE_CODE=1`, and `OPENCODE_CONFIG_CONTENT`:

```json
{
  "permissions": [
    {"action": "*", "resource": "*", "effect": "deny"},
    {"action": "trello_trelloReadCard", "resource": "*", "effect": "allow"}
  ],
  "agents": {
    "mainframe-sync": {
      "mode": "primary",
      "steps": 12,
      "permissions": [
        {"action": "*", "resource": "*", "effect": "deny"},
        {"action": "trello_trelloReadCard", "resource": "*", "effect": "allow"}
      ]
    },
    "title": {"disabled": true}
  }
}
```

- **The rules sit in both places** because an agent's own rules come last (see above). *(ran: `debug agents` shows Mainframe's rules after the user's.)*
- **A denied tool is not offered at all.** A tool whose last matching rule is a deny on every resource is left out of the model's tool list (`core/src/tool.ts:258-261, 386`). A `*` deny also turns Code Mode off, so the allowed MCP tools are offered one by one.
- **Nothing hangs on a question.** In `run`, every permission that comes to `ask` is rejected at once, and the model is told so (`cli/src/run/noninteractive.ts:97-112`). Questions and forms are cancelled the same way. **Never pass `--auto`:** it says yes to every `ask`. Denies still hold under it.
- **`--title`** skips the extra model call that names the session (`core/src/session/runner/llm.ts:200-204`), and the disabled `title` agent makes sure. `--archived` keeps the session out of the user's lists.
- Every run is saved as a session. Mainframe deletes it afterwards with `opencode --standalone session delete <id>`; the id is in every event.

### Its answer

- **OpenCode 2.x has no JSON Schema answer** anywhere:
  - not in `run`'s flags;
  - not in the agent config;
  - not in the server's prompt API (`client/src/promise/generated/types.ts:3389-3412`).
  - The `structured` field in `schema/src/v1/session.ts` is V1 only and not wired in.
- With `--format json`, stdout is one event per line. The types are `text` (its `text` is the part added since the last event), `tool_use`, `step_start`, `step_finish` (with `reason`, `cost` in USD, and `tokens`), `retry` and `error` (`noninteractive.ts:363-367, 503, 630-636`).
- The answer is the text of the last message, whose `step_finish` has `reason: "stop"`. Mainframe then:
  1. joins that text;
  2. strips a stray code fence;
  3. parses it;
  4. checks it with `SYNC_ANSWER`.
- **A failed run** gives an `error` event and exit code 1. A denied tool call does not change the exit code.
- **A check of its own:** reject the answer if any `tool_use` event names a tool outside the confirmed ones with status `completed`.
- With no schema to hold it, a small model may add words or a fence around the JSON. One retry that quotes the validation error is cheap.

### Cost

- There is no `--max-budget-usd` and no "haiku" name. Without `-m`, the run uses the user's default model. On this Mac that is `litellm/gpt-6-luna` *(ran)*.
- 2.x has no `small_model` setting. The V1 key only sets the model that writes session titles.
- **The models and their prices:**
  - `opencode --standalone api model.list` prints every model as JSON, with `cost` as tiers `{input, output, cache}` in USD per million tokens *(ran)*.
  - **That output also holds each provider's `settings`, which may contain API keys.** Mainframe must keep only the id, name, status and cost, and never log the output.
  - An empty `cost` means unknown, not free.
  - `opencode models` prints names only.
  - On this Mac, for example:

    | Model | Input ($/M tokens) | Output ($/M tokens) |
    |---|---|---|
    | `litellm/claude-haiku-5-5` | 0.11 | 0.55 |
    | `litellm/gpt-6-luna` | 0.12 | 0.6 |
    | `litellm/gpt-6-sol` | 2.4 | 12 |
- **The caps that exist:** `agents.<id>.steps` makes the step after the limit answer in text only (`core/src/session/runner/max-steps.ts`), and Mainframe's own 5-minute kill. OpenCode retries an unreachable provider for up to an hour (`core/src/model-retry.ts:56-70`), so the kill is the only clock.
- **A cap of Mainframe's own:** add up `step_finish.cost` as the events arrive, and stop the run once it passes a limit. The same sum can show the user what a sync cost.

### Finding the connector (the first sync)

- Claude Code's discover run asks the model to name its connector tools without calling any. On OpenCode a `*` deny hides every tool, so the model would see none.
- **Two ways to try:**
  - **Ask the server, not a model.** Its API lists MCP servers and maybe their tools. The user picks the connector, and a run or a name rule picks the read tools.
  - **Rules that show the tools but block every call.** Deny the built-in tools by name, and make everything else `ask`, which `run` always rejects. The connectors' tools are then offered but can't run. Code Mode would then be on, so the tools may show only behind `execute`.
- **Unchecked:** `opencode mcp list` didn't show servers given through `OPENCODE_CONFIG_CONTENT`, though `debug config` showed them loaded. It may list before the MCP servers have started. This Mac has no MCP servers set up in OpenCode, so no real connector was seen.
- The user's connectors come only from OpenCode's own `mcp` config. Nothing is imported from Claude Code. A friend who uses both has to set up Trello in OpenCode too.

## Setup with OpenCode alone

- **Setup requires a working `claude`.** `setupFlow.ts` blocks without one, `settings.ts` saves only `claudeBin`, and the file picker is titled "Find Claude Code".
- **Node** is required only because the hooks Mainframe writes for Claude Code run it (`index.ts:138`). A user with only OpenCode doesn't need it.
- **The sync's tool check** is `isMcpToolName` (`mcp__server__tool`). OpenCode needs a check of its own (`server_tool`).
- **The role prompt and the sync prompts** say "this repo's CLAUDE.md" (`rolePrompt.ts`, `syncRun.ts`). OpenCode needs the wording the OpenCode opening prompt already uses: "`AGENTS.md`, or `CLAUDE.md` when there is no `AGENTS.md`".
- **The manager's tool descriptions** already name both agents.

## Decisions

The owner answered on 2026-11-12.

1. **The sync's model: the user picks it.** The first time a sync runs on OpenCode, Mainframe lists the user's models from `api model.list`, cheapest first, with the cheapest whose price is known picked. It saves the choice, and the Settings screen can change it.
2. **No spending cap.** If a sync runs for a long time, Mainframe asks the user whether to go on. It warns that very large or long syncs can use a lot of tokens. The 5-minute time limit and the step limit stay as backstops.
3. **The sync reads the user's own OpenCode config and skips the project's.** The user's own config holds their models, API keys and connectors, which the sync needs. The project's config (an `opencode.json` and `AGENTS.md` in the repo) adds nothing it needs, so it runs with `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
4. **The manager runs on the user's default agent.** Mainframe adds its rules to that agent. Settings can name another agent, and the user can switch agents in the manager's terminal for a while. "Still to check" item 1 still applies: the allow rules must also sit under that agent's own rules.

## Still untried

- A real connector (Trello, say) set up in OpenCode: this Mac has none.
- `sync_todo` waiting out a long sync from inside the manager. The default per-call timeout is 12 hours, so it should hold.
- A user whose default agent has rules of its own (see "Still to check" above).
