# Findings: running other agent CLIs in Mainframe

Research on 2026-11-12, worktree `multi-agent-research`, from each CLI's current docs, changelog and source. A fact marked *(third party)* comes only from someone other than the CLI's maker. Nothing here has been tried in Mainframe yet.

## In short

- **The hardest part is mostly solved already.** The board, Ctrl+Tab to the next session that needs you, and the carry-on prompt after Quit all run on OSC 7501 status reports. Since October 2026 other agents send them too. Mainframe's scanner reads them as they are:
  - **Codex CLI** sends them, checked in its source. It sends them whenever its output is a terminal, with no query needed.
  - **OpenCode 2.1+** sends them, checked in its source.
  - **GitHub Copilot CLI** sends them, per its changelog.
  - Qwen Code, goose, Crush, Factory Droid and Pi are reported to *(third party)*.
  - Antigravity CLI, Amp and Kiro are "reported, not yet confirmed" *(third party)*.
- **Not sending them:** Gemini CLI (its issue is open at p3), Cursor CLI ("no ETA") and Aider.
- **What's left** is everything Mainframe does through flags only Claude Code has:
  - a session id chosen at launch
  - resume with a prompt
  - `-w` worktrees
  - `--settings` hooks
  - the manager's `--mcp-config` and `--append-system-prompt`
  - the sync's `-p --json-schema`
- **Recommendation:**
  - Add one adapter per agent, and support only agents that send OSC 7501.
  - Start with Codex alone.
  - For agents other than Claude, Mainframe makes the worktree itself.
  - The decisions for the owner are at the end.

## Which agents are common

Stars and weekly downloads come from the GitHub, npm and PyPI APIs on 2026-11-12. npm doesn't count native installers, so Claude Code's real number is higher.

| Agent | Stars | Downloads a week | Sends OSC 7501 |
|---|---|---|---|
| Codex CLI (OpenAI, "ChatGPT") | 135k | 26.0M | yes, checked in its source |
| Claude Code | 155k | 16.4M | yes, since 2.1.295 |
| OpenCode | 226k | 3.4M | 2.1+ only, checked in its source. 1.x sends none (this Mac has 1.18.35) |
| GitHub Copilot CLI | (closed source) | 1.9M | yes, per its changelog |
| Gemini CLI | 109k | 0.42M | no. Since 2026-06-18, free-tier and Google One users get Antigravity CLI (`agy`) instead, per the banner on Google's docs |
| Pi | 122k | 0.42M | yes *(third party)* |
| Cursor CLI | (closed source, no npm package) | unknown | no |
| Qwen Code, goose, Crush, Cline, Kilo, Amp, Factory Droid | 0.3k–72k | 10k–174k | most yes *(third party)* |
| Aider | 50k | 98k (PyPI) | no. It has no session ids or hooks, and no commits since 2026-05-22 |

In the Stack Overflow 2026 survey, 66% of developers using AI tools use Claude Code and 59% use GitHub Copilot. It names no other terminal agent.

## What Mainframe takes from Claude Code today

| What | Where | How |
|---|---|---|
| Finding the program | `setup/programChecks.ts` | `claude` on PATH or `~/.local/bin`. `--version` must print `X.Y.Z (Claude Code)`, version 2.1.295 or later |
| The task's worktree | `tasks/launch.ts`, `taskService.ts` | `claude -w <slug>` makes `.claude/worktrees/<slug>` on `worktree-<slug>`. Reopen passes `--worktree <slug>` |
| Start | `startArgv` | `-n <name> --session-id <uuid> [--add-dir] --settings <file> <opening prompt>` |
| The session's id | `hookSettings`, `readRecordedSession` | A SessionStart hook saves its payload. The id changes on `/clear` and compaction |
| Reopen | `reopenArgv`, `carryOn.ts` | `--resume <id> [carry-on prompt]` |
| Status | `status/osc7501.ts`, `programStatus.ts`, `sessionHost.ts` | Mainframe answers the query. The reports drive the lanes and the turn tracker |
| Manager | `managerArgv`, `mcp/mcpServer.ts` | `--mcp-config` (HTTP with a bearer token), `--append-system-prompt`, allow rules |
| Todo sync | `todo/syncRun.ts` | `-p --model haiku --tools '' --permission-mode dontAsk --json-schema --max-budget-usd 1`, plus a PreToolUse guard |
| Prompts | `openingPrompt.ts`, `rolePrompt.ts`, `syncRun.ts` | Name `CLAUDE.md`, `EnterWorktree` and `ExitWorktree`, and say "Claude Code refuses git commands aimed at the main checkout" |
| Renderer | `terminal/suggestion.ts`, setup text, `NewTaskDialog` | Reads Claude Code's suggestion off the screen. The text says "Claude Code" |
| Records | `taskStore.ts` | `claudeSessionId` on each task |
| Environment | `pty/spawnEnv.ts` | Drops `CLAUDECODE`, `CLAUDE_CODE_*` and similar |

## How each agent fits

"Not documented" means the current docs don't say. It may still work, so it needs a try.

| | Codex CLI | OpenCode | Copilot CLI | Gemini CLI | Cursor CLI |
|---|---|---|---|---|---|
| Status | OSC 7501: working, idle, done, error, blocked (permission or question) | OSC 7501 in 2.1+: working, waiting, idle. No done or error. One summary record plus one per child session | OSC 7501 ("reports program status to supporting terminals") | None. Only the window-title icons, notifications, and hooks (BeforeAgent, AfterAgent, Notification `ToolPermission`) | None. Only notifications |
| Opening prompt | `codex [PROMPT]` | V1 `--prompt`. V2: not documented | `-i PROMPT` | `-i PROMPT` | `agent [prompt]` |
| Choose the id at launch | no | no | `--session-id` is in the changelog, meaning not documented | no | `create-chat` returns a new id |
| Learn the id | SessionStart hook `session_id` (hooks need `features.hooks` and the owner's trust) | Server API and events | Hook payload `sessionId` | Hook `session_id` | Hook `conversation_id` (whether CLI hooks fire is unclear) |
| Resume by id | `codex resume <id>`. With a prompt: not documented | V1 `-s <id> --prompt` | `--resume=<id>` | `--resume <uuid>`. With a prompt: not documented | `--resume <chatId>` |
| Its own worktree flag | `--worktree` (folder not documented) | no | `-w` | `-w`, experimental, in `.gemini/worktrees/` | `-w` |
| Config for one launch | `-c key=value`, `-p <profile>` | V1 `OPENCODE_CONFIG_CONTENT`. V2: not documented | `--additional-mcp-config`, `COPILOT_HOME` (which moves the login too) | `GEMINI_CLI_SYSTEM_SETTINGS_PATH` | `CURSOR_CONFIG_DIR` |
| MCP over HTTP with a token | `mcp_servers.<n>.url` with `bearer_token_env_var` or `http_headers` | `mcp.servers.<n>` remote with `headers` | `--additional-mcp-config=<json>` | `mcpServers.<n>.httpUrl` with `headers` | not by flag |
| Extra system prompt | `developer_instructions` | A custom agent's prompt. V2 has no `--agent` flag | not documented | Replace only (`GEMINI_SYSTEM_MD`) | not documented |
| Headless with a JSON Schema | `exec --json --output-schema <file> --ephemeral -a never -s read-only` | `run --format json`, no schema | `-p --output-format json`, no schema | `-p -o json`, no schema | `-p --output-format json`, no schema |
| Instructions file | `AGENTS.md`. `CLAUDE.md` through `project_doc_fallback_filenames` | `AGENTS.md`. V2 doesn't read `CLAUDE.md` | `AGENTS.md` | `GEMINI.md`, or the names in `context.fileName` | `AGENTS.md`, `.cursor/rules` |
| Windows | Native binary | Zip or desktop installer | Native (winget) | npm only, a `.cmd` launcher Mainframe never runs | Native (PowerShell installer) |
| License | Apache-2.0 | MIT | Proprietary | Apache-2.0 | Proprietary |

Claude Code reads `AGENTS.md` when a project has no `CLAUDE.md`, per its changelog. A friend's project that serves several agents most likely has an `AGENTS.md`.

## What would change in Mainframe

1. **An adapter per agent.** Each adapter holds:
   - how to find the program and check its version
   - how to start, reopen and learn the id
   - which variables to drop
   - how to pass config for one launch

   Claude Code becomes the first adapter, with no change in what it does. Today these live in `launch.ts`, `programChecks.ts` and `spawnEnv.ts`.
2. **Worktrees.** For the other agents, Mainframe runs `git worktree add` itself and starts the agent in that folder. Codex, Copilot and Cursor each have their own `--worktree`, with their own folder and branch names, and Mainframe should not depend on four layouts. Claude keeps `claude -w`: its `ExitWorktree` handling, and the warning in the opening prompt about git in the main checkout, depend on it.
3. **The session's id.** Two ways to get it:
   - The agent's own SessionStart hook writes the same `session-start.json`. This works for Codex, Copilot and Gemini.
   - Because each task has a worktree of its own, "the latest session in this folder" is the task's session, so resuming the latest is enough. This doesn't work for the manager, which shares the main checkout with the owner's own sessions. Check for each agent that "latest" is limited to the folder.
4. **The carry-on prompt.** Where an agent can't take a prompt with its resume, Mainframe types the prompt into the terminal at the agent's first `idle` report. That works for any agent that sends OSC 7501.
5. **Status.** Nothing changes for agents that send OSC 7501, with one fix: `ProgramStatusRecords.current()` takes whichever record was updated last, whatever its id. OpenCode sends a summary record plus one per child session, so a child's state could win over the summary. It should take the summary record (id `''`) when there is one.
6. **Manager.**
   - Codex can do all of it: `-c` for the MCP server and its token, plus `developer_instructions`.
   - Copilot can take the MCP server but has no extra system prompt, so the role would go in the first message, which is weaker.
   - Gemini CLI can only replace the system prompt.
7. **Todo sync.**
   - Only Codex has the same structured answer, through `exec --output-schema`. For the others, Mainframe asks for JSON in the prompt and checks it with the `SYNC_ANSWER` schema it already has.
   - The read-only guard has a counterpart in each agent:
     - Codex: a read-only sandbox plus `enabled_tools`
     - Copilot: `--available-tools`
     - Gemini: the policy engine
     - OpenCode: permission rules

     The sync runs unattended, so each one must be tested to show it really blocks a write.
8. **Prompts.** The opening prompt and the role prompt need a worktree note for each agent. They also need to say "this repo's instructions (`CLAUDE.md` or `AGENTS.md`)" rather than "this repo's CLAUDE.md". `EnterWorktree` and `ExitWorktree` exist only in Claude Code.
9. **Renderer.**
   - The suggestion ring reads Claude Code's own screen, so it stays off for other agents.
   - The setup screen checks every agent it can use, not just `claude`.
   - "Claude Code" in the text becomes the agent's name.
10. **Records.** `claudeSessionId` becomes the agent plus its session id, which means a new version of `state.json`.
11. **Windows.** Gemini CLI comes only from npm. Its `gemini.cmd` is a launcher of the kind Mainframe never runs, so Mainframe would have to run node with the package's script.

## Not recommended: the Agent Client Protocol (ACP)

Zed's ACP is supported by most agents, either natively or through an adapter: Gemini, OpenCode, Copilot, Cursor, goose, and Codex and Claude through adapters. It doesn't fit Mainframe:
- **It replaces the agent's own terminal UI.** The client draws the chat from JSON-RPC messages, while Mainframe is built on the agents' real terminal sessions.
- **It has no idle or working field.** A client works the state out from an open prompt or a pending permission request.

It is worth another look only if Mainframe ever draws its own chat.

## Decisions for the owner

1. **Which agents, and in what order.** Recommended: Codex first and alone. It has the most downloads, it sends every OSC 7501 state Mainframe uses, and it has config for one launch, MCP over HTTP with a token, an extra system prompt and a JSON Schema headless run. Copilot CLI is next, then OpenCode 2.x once its V2 flags settle.
2. **Where the choice is made.** Recommended: each project has a default agent, and the New task box can pick another for one task.
3. **Agents without OSC 7501** (Gemini CLI, Cursor CLI). Recommended: leave them out for now rather than build a second status route from hooks. Their issues are open, and Gemini's free users have moved to Antigravity CLI, which is reported to send OSC 7501.
4. **Where other agents' worktrees go.** Keep `.claude/worktrees/` for every agent, or use a folder of Mainframe's own?
5. **Manager and sync.** Should they follow the project's agent, or stay Claude Code-only at first?

## To try by hand before a plan

- **Codex:**
  - Does `codex resume <id> "prompt"` send the prompt?
  - Is `codex resume --last` limited to the current folder?
  - Which release first sends `done` and `error`? *(third party: 0.164.0)*
  - Can a hook given for one launch run without the owner trusting it in `/hooks`?
- **Copilot:**
  - What does `--session-id` do?
  - Which states does it send?
  - Does it wait for Mainframe's answer to the query?
- **OpenCode V2:**
  - How do you start the TUI with a prompt?
  - How do you pass config for one launch?
  - Is the summary record's id empty?
- **Every agent:** start it in Mainframe's terminal with `MAINFRAME_LOG_OSC=1` and write down the reports it sends while it works, while it waits on a permission and on a question, and once it is done.

## Sources

- OSC 7501 spec: <https://superlogical.com/rex/docs/build/program-status>. Proposal: <https://mitchellh.com/writing/program-status-osc7501>
- Who sends OSC 7501, last checked by Zellij on 2026-11-09: <https://zellij.dev/documentation/inbox-integrations.html>
- Codex sender: `codex-rs/tui/src/terminal_program_status.rs` in <https://github.com/openai/codex>
- OpenCode sender: `packages/tui/src/context/program-status.ts` in <https://github.com/anomalyco/opencode>
- Copilot CLI changelog: <https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md>
- Claude Code changelog (OSC 7501, AGENTS.md): <https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>
- Codex docs: <https://learn.chatgpt.com/docs/developer-commands?surface=cli>, <https://learn.chatgpt.com/docs/config-file/config-reference>, <https://learn.chatgpt.com/docs/hooks.md>, <https://learn.chatgpt.com/docs/non-interactive-mode.md>
- Gemini CLI docs: <https://geminicli.com/docs/cli/cli-reference/>, <https://geminicli.com/docs/hooks/reference/>, <https://geminicli.com/docs/get-started/authentication/>. Its OSC 7501 issue: <https://github.com/google-gemini/gemini-cli/issues/29710>
- OpenCode docs: V2 at <https://opencode.ai/docs/>, V1 at <https://opencode.ai/docs/en/cli>
- Copilot CLI docs: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference>
- Cursor CLI docs: <https://cursor.com/docs/cli/reference/parameters>. Its OSC 7501 request: <https://forum.cursor.com/t/emit-osc-7501-program-status-in-cursor-agent-idle-working-blocked-done/177003>
- ACP: <https://agentclientprotocol.com/protocol/overview>
- Stack Overflow 2026 survey: <https://stackoverflow.blog/2026/10/06/the-results-of-the-2026-developer-survey-are-here/>
