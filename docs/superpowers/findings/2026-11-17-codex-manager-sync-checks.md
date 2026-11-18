# Findings: Codex's manager and sync flags, tried by hand

Checks on 2026-11-17, worktree `codex-manager-sync`, with Codex CLI 0.169.0. They answer what `2026-11-17-codex-checks.md` left for the second branch: the manager's `-c mcp_servers…` and `developer_instructions`, and the sync's `exec --output-schema`.

## How it was run

As in the first checks: no account, so the real `codex` ran against a fake Responses API, with a throwaway `CODEX_HOME` whose `config.toml` sets `model_provider = "fake"` and a `base_url` on localhost. Beside it ran a logging MCP server over Streamable HTTP (answers `initialize`, `tools/list` with one tool, `tools/call`), and later a stdio MCP server whose one tool fetches `https://example.com`. The fake model calls that tool when it is offered and no tool output is in the input yet, then answers a fixed text. `codex exec` ran with `--json --ephemeral`; the TUI ran in a pseudo-terminal (node-pty) that logged OSC 7501 reports and answered the terminal's queries. The folders were plain folders (exec with its flag to run outside a git repository), the TUI's folder trusted in the throwaway config.

The config's `model = "fake-model"` gives Codex's classic tools. Leaving the `model` key out makes Codex use its default model's catalog (a code-mode model, gpt-6.1-sol in 0.169), so the tools that model is offered can be seen in the fake API's requests without an account. The switches' check on that model was added on 2026-11-18, after the final review.

## MCP over HTTP with a token

```
-c 'mcp_servers.mainframe.url="http://127.0.0.1:<port>/mcp"'
-c 'mcp_servers.mainframe.bearer_token_env_var="MF_TOKEN"'
```

Every request carried `Authorization: Bearer <MF_TOKEN's value>` and `user-agent: codex-mcp-client/0.169.0`. The model was offered the tool in a namespace: `{"type":"namespace","name":"mcp__mainframe", tools: [ping]}`.

## Approval of MCP tools

`mcp_servers.<s>.default_tools_approval_mode` and `mcp_servers.<s>.tools.<t>.approval_mode` take `auto | prompt | writes | approve`. In `codex exec` (approval policy never):

| Mode | Tool without annotations | Tool with `readOnlyHint: true` |
|---|---|---|
| not set (`auto`) | fails: "MCP tool call requires approval, but approval policy is never" | runs |
| `prompt` | fails, same message | fails, same message |
| `approve` | runs | runs |

So only `prompt` keeps a headless run from calling a tool, whatever the server says about it.

- A per-tool `approval_mode = "approve"` beats the server's `default_tools_approval_mode="prompt"`, also when the per-tool key is in `config.toml` and the default comes from `-c`.
- `-c 'mcp_servers.<s>.tools={}'` clears a per-tool key set by an earlier `-c`, but not one in `config.toml`: tables merge across config layers. Lists (`enabled_tools`) and single values (`enabled=false`) are replaced.
- `codex mcp list --json` and `codex mcp get --json` don't show approval modes; `codex debug prompt-input` doesn't list tools.
- Under `--dangerously-bypass-approvals-and-sandbox`, a `prompt` tool ran without asking. `writes` let a `readOnlyHint` tool run under policy never.

## The session id reaches the MCP server

Every `tools/call` carried it, in `codex exec` and in the TUI:

```
"params": {"_meta": {"callId": "...", "x-codex-turn-metadata": {"session_id": "<id>", "thread_id": "<id>", ...},
  "threadId": "<id>", "sessionId": "<id>", "windowId": "<id>:0", ...}, "name": "ping", "arguments": {}}
```

`initialize`, `notifications/initialized` and `tools/list` carried no id. None of this is in Codex's docs. In the TUI, `codex resume <that id>` opened the chat with its history (the model's input held the first chat's message).

## The TUI's reports, resume and instructions

- Start with no prompt: `idle` at 0.8 s (then a brief `working`/`idle` while it loads). Typing a message: `working`, then `done`.
- `codex resume <id>` with no prompt: `idle` at 0.13 s.
- `codex resume <id>` with an id Codex doesn't have: the screen shows "ERROR: No saved session found with ID <id>. Run `codex resume` without an ID to choose from existing sessions." and Codex exits with code 1 after 3.7 s, with no report. (`codex exec resume <id>` says "thread/resume failed: no rollout found for thread id <id>".)
- `-c developer_instructions="…"` reached the model on a new chat. On `resume` with a different value, the model still had the first value and not the new one: a chat keeps the instructions it began with.

## `codex exec` for the sync

- `--output-schema <file>` is sent as `"text": {"format": {"type": "json_schema", "strict": true, "schema": …}}`. OpenAI's strict mode needs every property listed in `required`, `additionalProperties: false` on every object, and an optional field written as a union with `null` (OpenAI's Structured Outputs guide, "Supported schemas"). `SYNC_ANSWER_JSON` has optional properties, so the real API would refuse it as it is; the fake model doesn't check.
- `--json` events seen: `thread.started` {thread_id}, `turn.started`, `item.started` / `item.completed` with items `agent_message` {text}, `mcp_tool_call` {server, tool, arguments, result, error, status: in_progress | completed | failed}, and `error` {message}, `turn.completed` {usage}. The `error` item came with an unknown model ("Model metadata for `fake-model` not found…"): a warning; the turn completed.
- The prompt is read from stdin when none is given.
- `-c features.shell_tool=false -c 'web_search="disabled"' -c agents.enabled=false -c features.apps=false -c features.goals=false` (all accepted by `--strict-config`):
  - On `fake-model` (classic tools), with no MCP server configured, the model was offered only `request_user_input` and `view_image`. With servers configured it is also offered `list_mcp_resources`, `list_mcp_resource_templates` and `read_mcp_resource`.
  - On the default model (code mode), it was offered Codex's JavaScript `exec` tool (plus `wait`, `clock.sleep` and `request_user_input`), and through `exec` it can reach `apply_patch`, `view_image`, the MCP resource reads and the MCP tools. The `exec` JavaScript has no `fetch` and refuses `import('node:fs')`. `apply_patch` through it was refused: "patch rejected: writing is blocked by read-only sandbox". The MCP approval guard held for nested calls; they appear in `--json` as `mcp_tool_call` items and carry `_meta.sessionId`.
  - `features.multi_agent=false`, used first, is deprecated: on the default model it left a `collaboration` namespace (`spawn_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents`, `wait_agent`), and `spawn_agent` really spawned a subagent. `agents.enabled=false` removes that namespace, and the `multi_agent_v1` namespace of older models.
- A stdio MCP server started with no `CODEX_SANDBOX` in its environment and its tool fetched `https://example.com` (status 200) under `-s read-only`, both in a trusted folder (a server from the folder's `.codex/config.toml`) and in an untrusted one (a server from `-c`).

## Server names

- A server named `my-trk` was offered to the model as namespace `mcp__my_trk`; the JSON events named it `my-trk`.
- A tool named `get-card` is shown to the model as `mcp__trk__get_card`; the JSON events name it `get-card`, and `enabled_tools` and `tools.<t>` take `get-card` (the final review's probe, 2026-11-18).
- `-c 'mcp_servers."a.b".command="node"'` failed: "Error loading config.toml: invalid transport … in `mcp_servers."a`". The `-c` path is split at every dot, quotes or not.

## `codex mcp list --json`

Prints an array of `{name, enabled, disabled_reason, transport: {type: streamable_http | stdio, …}, startup_timeout_sec, tool_timeout_sec, auth_status}`. It honours `CODEX_HOME` and `-c`, and run in a trusted project's folder (as its working folder; `-C` isn't enough) it includes that project's `.codex/config.toml` servers.

## Not checked

- A real model, so whether a real model calls `list_sessions` first when told to, and the strict schema against the real API.
- A subagent's tool call (which id it carries).
- Profiles and plugins as sources of MCP servers.
- Windows and Linux.
