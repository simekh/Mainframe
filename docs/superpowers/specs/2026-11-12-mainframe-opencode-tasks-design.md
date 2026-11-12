# Design: OpenCode tasks in Mainframe

2026-11-12, worktree `multi-agent-research`. Follows `docs/superpowers/findings/2026-11-12-other-agent-clis.md`. The owner chose OpenCode first, at its latest version (2.2.7), and asked to skip the questions. Every choice marked *(my call)* is open to change.

## What it is

A task can run on OpenCode instead of Claude Code. You pick the agent in the New task box. The task gets its own worktree and branch, as now, and its card moves through the lanes from OpenCode's own status reports. Close, reopen, Quit and the carry-on prompt work the same way they do for a Claude task.

## Not in this version *(my call)*

- **The manager and the Todo sync stay on Claude Code.** The manager needs an extra system prompt and Mainframe's MCP server. The sync needs a JSON Schema answer. OpenCode has the MCP server and an agent prompt (both through `OPENCODE_CONFIG_CONTENT`), but no schema. Each is its own step later.
- **Claude Code is still required at setup**, because the manager and the sync use it. A setup that works with OpenCode alone comes with the step above.
- **No per-project default agent.** The New task box remembers the last agent picked in each project.
- **`/new` inside an OpenCode task is not followed.** Reopen resumes the session Mainframe started. (Claude's `/clear` is followed through its SessionStart hook. OpenCode has no hook that Mainframe can pass for one launch.)

## What OpenCode 2.2.7 does, checked in its source and in a terminal

| Need | How |
|---|---|
| Choose the session's id at launch | `-s <id>` "continue, or create if it does not exist". An id must start with `ses`. |
| Opening prompt, sent as the first turn | `--prompt <text>`. The TUI submits it as soon as it opens (`routes/home.tsx`). |
| Resume with a prompt | `-s <id> --prompt <text>` opens the session and submits the prompt (`routes/session/index.tsx`). |
| A session that ends with its terminal | `--standalone` runs a private server that stops when the TUI's stdin closes, even on a kill. Without it, the TUI connects to a shared background service, where a turn would keep running after Mainframe closed the task. |
| Status | OSC 7501, after it queries for support: one summary record with no id (`state=idle:app=opencode`), plus one record per pending session in its tabs. States are `working`, `blocked` (`permission`, `question`) and `idle`. It sends no `done` or `error`. On exit it sends `state=clear`. Seen in a pty on this Mac. |
| Keep the status to this task's session | Tabs are shared between OpenCode windows, so another window's sessions could appear in this task's tabs and its reports. `OPENCODE_CLI_CONFIG_CONTENT='{"tabs":{"mode":"off"}}'` turns tabs off for this launch only. It is merged over the user's own `cli.json`. |
| Version | `opencode --version` prints `opencode v2.2.7`. Status reports started in 2.1. |
| Instructions | It reads `AGENTS.md`. Claude Code reads `AGENTS.md` too when a repo has no `CLAUDE.md`. |

## How it works

### The agent on a task

- `TaskRecord` gets `agent?: 'claude' | 'opencode'`. A record without it is a Claude task, so `state.json` stays at version 1 and older records need no migration.
- `claudeSessionId` keeps its name in `state.json` and holds the OpenCode session id for an OpenCode task. *(my call: renaming the field means a new `state.json` version for no change in behaviour.)*
- The manager's `list_tasks` report adds `agent`, so the manager knows what kind of id it is reading.

### OpenCode beside Claude, not behind an interface *(my call)*

OpenCode's launch lives in `src/main/tasks/opencode.ts`, beside Claude's in `launch.ts`. `TaskService` picks one by the task's agent. With two agents an interface would add code and no safety. It becomes worth having with a third agent, or when the manager moves too. A Claude task launches exactly as it does now.

`launchSpec` returns each session's own `cwd` and extra `env`. Today every session runs in the project folder. The session host lays a session's `env` over its shared one.

### OpenCode's launch

- **Worktree.** Mainframe makes it, in the same place and with the same branch names as Claude: `.claude/worktrees/<slug>` on `worktree-<slug>`. It runs `git worktree add -b worktree-<slug> <path> origin/HEAD`, or `HEAD` when the repo has no `origin/HEAD`, which matches the base the start check warns about. The rest of Mainframe (changed files, the diff window, slug checks) then needs no change.
- **Start:** `opencode --standalone -s <id> --prompt <opening prompt>`, run in the worktree, with tabs off. The id is `ses_` plus 28 hex characters, which keeps it within the 32 bytes of an OSC 7501 record id.
- **Reopen:** `opencode --standalone -s <id> [--prompt <carry-on>]`, run in the worktree. When the worktree folder is gone but its branch is still there, Mainframe adds the worktree back first. When both are gone, the session runs in the project folder, as a Claude reopen does.
- **Windows.** `--prompt` takes the whole opening prompt, so the long-description file and `fitsWindowsCommandLine` apply as they do for Claude. The brief folder is passed to OpenCode with no `--add-dir` flag: V2 allows reads outside the project by default.

### Status

- `ProgramStatusRecords.current()` returns the summary record (id `''`) when there is one, and otherwise the record updated last, as now. Claude sends only the summary record, so nothing changes for Claude.
- OpenCode's idle after a turn shows as "Waiting for you" instead of "Finished its turn". Both are in the Needs you lane. *(my call: not worth a separate label.)*
- `TurnTracker` and the carry-on prompt need no change. A turn is `working` or `blocked` for both agents.

### Prompts

The opening prompt gets the agent:
- **Claude:** the same text as today.
- **OpenCode:** it says "this repo's instructions (`AGENTS.md`, or `CLAUDE.md` when there is no `AGENTS.md`)". Its worktree note says it was started in the task's own worktree on its branch, and that the main checkout is at `<projectDir>`, to be used with `git -C` for a merge. It names no `EnterWorktree` or `ExitWorktree`.

### Finding OpenCode

- At start, Mainframe looks for `opencode` on PATH and in `~/.opencode/bin` (`opencode.exe` on Windows), where OpenCode's installer puts it. It needs `--version` to print `opencode vX.Y.Z` with a version of at least 2.1.0. `MAINFRAME_OPENCODE_BIN` names it outright, like `MAINFRAME_CLAUDE_BIN`.
- It is optional. When it is missing, nothing changes, so a Claude-only user sees nothing new. When it is there but too old or broken, the New task box says so, for example "OpenCode 1.18.35 is installed. Mainframe needs 2.1 or later."
- Nothing is saved about it. The setup has no "Find opencode…" button, so a found path would be found again at the next start anyway. Looking takes one `--version` run at start.

### Environment

`spawnEnv` also drops `OPENCODE_TERMINAL` and `OPENCODE_PTY_HANDOFF`, which OpenCode sets in the shells it runs. A Mainframe started from one of them doesn't hand them on.

### Renderer

- **New task box:** an agent choice with Claude Code and OpenCode, shown only when OpenCode was found. It remembers the last pick per project. Its line "Starts Claude Code in a new worktree" names the agent picked.
- **Card and pane header:** a small "OpenCode" mark on OpenCode tasks. Claude tasks show nothing new.
- **Suggestion ring:** no change. It matches Claude Code's own suggestion line and its `0: Dismiss` row together, which OpenCode's screen never shows.
- **Tasks started from a Todo card or by the manager** run on Claude Code in this version.

## Checks before acceptance

- **Unit tests:**
  - each adapter's argv, cwd and env
  - worktree creation, and putting the worktree back on reopen
  - the summary record winning in `current()`
  - old records loading as Claude tasks
  - the opening prompt for each agent
  - finding and version-checking `opencode`
- **E2E:** a fake `opencode` script, like the fake `claude`, that records its argv, cwd and env and sends OpenCode's reports. It checks start, the lanes, close, reopen with the carry-on prompt, and Quit then restore.
- **By hand, by the owner:** start a real OpenCode task, watch it work, answer a permission, close and reopen it, and Quit with it mid-turn.
