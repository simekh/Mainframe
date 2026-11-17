# Mainframe: Codex tasks (design)

Date: 2026-11-17. Branch `worktree-codex-agent`. Background: `docs/superpowers/findings/2026-11-12-other-agent-clis.md` (why Codex first) and `docs/superpowers/findings/2026-11-17-codex-checks.md` (what Codex 0.169.0 did when tried by hand). Builds on `2026-11-12-mainframe-agent-agnostic-design.md` and `2026-11-12-mainframe-opencode-tasks-design.md`.

## Intent

Mainframe is meant for friends' projects, and friends use different agents. Codex CLI is the most downloaded terminal agent, and it already sends the OSC 7501 reports the board runs on. This work makes Codex a third agent beside Claude Code and OpenCode, so a friend who only has Codex can use Mainframe.

It comes in two branches **(owner)**:
1. **This branch: tasks.** Codex can be ticked, found, picked and made the default; a task runs Codex in its own worktree, and every task action works as it does for OpenCode's tasks.
2. **The next branch: the manager and the Todo sync on Codex** (`-c mcp_servers.…`, `developer_instructions`, `codex exec --output-schema`). It gets its own design.

**Nothing is pushed until both are on `main` (owner).** This branch may merge into the local `main` once accepted. So it adds no temporary limits: Codex can be the default agent from the start, and until the next branch its adapter refuses the manager and the sync with a plain error.

## Goals

- **Setup and Settings know Codex.** It is listed, found, checked for its version, ticked and made the default like the other two. `MAINFRAME_CODEX_BIN` names it, as the other agents' variables do.
- **New task can start a Codex task.** The New task box lists Codex when it works, and the card and the session panel carry its name as they do OpenCode's.
- **A Codex task runs like an OpenCode task:**
  - Mainframe adds the task's worktree in `.mainframe/worktrees/<slug>` on branch `worktree-<slug>`, the folder OpenCode's tasks already use, and runs Codex in it.
  - The board's lanes, Ctrl+Tab and the turn tracker run on Codex's reports with no change.
  - Reopen, the carry-on prompt after Quit, Continue, Put back, Merged's Finish and the diff window work as they do for OpenCode.
- **The opening prompt suits Codex.** It names "this repo's instructions" as OpenCode's does, and carries the note on where the session runs.

## Non-goals

- The manager and the Todo sync on Codex: the next branch.
- **Commands Codex leaves running.** When a Codex terminal closes, its turn stops but a command it started (a dev server, a test run) keeps running. A follow-up first checks whether Claude Code and OpenCode do the same, then fixes it once for every agent if so **(owner)**. This branch changes nothing there.
- Codex installed through npm on Windows. npm makes a `codex.cmd`, a launcher Mainframe never runs. Setup on Windows points to Codex's own installer.
- Codex's own `--worktree` and its "new worktree" choice after `/new`.
- Codex's questions (they exist only in its plan mode). Its reports already say `blocked:kind=question` when it asks one, which Mainframe shows like any other.
- Changing Codex's trust, sandbox or approval settings. They stay the user's.
- Codex's daemon. It is Codex's own business; turns don't run in it.

## Anti-goals

- **Reading Codex's own session store** (`$CODEX_HOME/sessions`, its SQLite files). It is private and changing (`migrate-rollouts`).
- **`--dangerously-bypass-hook-trust`.** It would also run hooks a repo carries, unasked.
- **Trusting a folder for the user** (`-c projects."…".trust_level=…`). Codex asks once per project, and that answer is the user's.
- Any change to what Claude Code's or OpenCode's tasks do.
- Anything that names the owner's projects, paths, branches or tools (the project-agnostic rule in `CLAUDE.md`).

## What Codex gives (from the checks)

- **Reports:** `state=<s>:app=codex`, sent unasked. Start with a prompt: `idle` then `working`. End of turn: `done`. A permission prompt: `blocked:kind=permission`, then `working` once answered. A failed model call: `error`. Nothing while its trust question or sign-in screen is up.
- **Start:** `codex [PROMPT]` in the folder. No flag sets or names the session.
- **Resume:** `codex resume --last [PROMPT]` takes the newest session whose folder is exactly the current one, and sends the prompt as the first message. After `/new` in the TUI, the newest is the new chat.
- **Trust:** asked once per repo. A worktree of a trusted repo is trusted. The first task in a new project shows the question before Codex reports anything.
- **Ending:** a hang-up ends the turn.
- **Its shells' variables:** `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_TOOL_CALL_ID`, `CODEX_CI`, `CODEX_PERMISSION_PROFILE`, `CODEX_VERSION`, `CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS`, `CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_PACKAGE_ROOT`. `CODEX_HOME` is the user's own setting.
- **Where it is:** PATH; `~/.local/bin/codex` (its installer, macOS and Linux); `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` (its installer, Windows); Homebrew's cask puts it on PATH. `codex --version` prints `codex-cli 0.169.0`.
- **Instructions:** reads `AGENTS.md`. The config key `project_doc_fallback_filenames` adds other names, such as `CLAUDE.md`; a `-c` for it replaces the user's list. `codex debug prompt-input` shows, offline, whether a file is loaded.
- **Reports carry no `id`:** Mainframe's parser takes it as `''`, and nothing filters on `app`.

## Approaches: how a task finds its conversation again

Codex can't be handed a session id at launch, so Mainframe can't name the conversation up front as it does for Claude Code and OpenCode.

1. **`codex resume --last` from the task's worktree (chosen).** Every task has its own worktree, and `--last` looks only at sessions started in exactly that folder. It also follows `/new` the way Claude Code's recorded session follows `/clear`. It needs no id, no hook and no reading of Codex's files. It can't work for the manager, which shares the main checkout with the user's own Codex sessions: that is the next branch's problem.
2. **Read the id from Codex's session files**, matching `cwd` to the worktree, then `codex resume <id>`. Rejected: it depends on a private store Codex is moving away from, and a stored id would go back to a chat abandoned with `/new`.
3. **A SessionStart hook writes the id**, as Claude Code's does. Rejected: the hook needs the user's trust in Codex's `/hooks`, or a flag that also runs every hook the repo carries.

## The design

### The adapter

`src/main/agents/codex.ts`, added to `ADAPTERS`, with `'codex'` in `AgentName`, `AGENT_NAMES` ("Codex"), `AGENT_ORDER` (after OpenCode) and `MIN_AGENT_VERSION`. The `Record<AgentName, …>` maps make the typecheck point at most of the places that need it.

| Member | Codex |
|---|---|
| `envVar` | `MAINFRAME_CODEX_BIN` (read in `config.ts` like the others) |
| `find` / `check` | Places: PATH, then `~/.local/bin/codex`, or on Windows `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`. Version from a line that is exactly `codex-cli X.Y.Z`. Minimum `0.169.0`, the version tried by hand |
| `droppedEnv` | The `CODEX_*` keys listed above, not `CODEX_HOME` |
| `instructions` | OpenCode's wording: "this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)" |
| `worktreeNote` | OpenCode's note: started in the task's worktree on its branch; the main checkout is the project folder, for `git -C` |
| `mainframeAddsWorktree` | `true` |
| `worktreesDir` | `.mainframe/worktrees` |
| `needsNode` | `false` |
| `newSessionId` | A new uuid. It is Mainframe's own key for the session and never reaches Codex |
| `taskStart` | `codex <opening prompt>`, run in the worktree. No `addDir`: Codex's sandbox reads outside the workspace |
| `taskReopen` | `codex resume --last [prompt]`, run in the worktree |
| `recordedSession` | `null` |
| `chatKept` | `true` |
| `began` | `task.began === true`, as OpenCode's |
| `forgetChat` | nothing |
| `managerChat` / `managerLaunch` | throw "The manager doesn't run on Codex yet." until the next branch. With Codex as the default, the manager column shows its usual "The manager stopped" line until Restart shows this error; nothing is added for it, as this state never ships **(designer's call)** |
| `sync` | a `SyncAdapter` whose `prepare` throws "The Todo sync doesn't run on Codex yet."; the rest is the smallest that satisfies the type |

Mainframe passes no Codex setting of its own on a task's launch. A `-c` replaces the user's value for that key (checked with `project_doc_fallback_filenames`: a user's `["OTHER.md"]` was dropped for `["CLAUDE.md"]`), and Codex's settings stay the user's.

### A project's CLAUDE.md: the user adds the setting (owner)

Codex reads `AGENTS.md` by itself, but a `CLAUDE.md` only when the user's Codex config lists it in `project_doc_fallback_filenames`. Mainframe doesn't set it for them; it tells them the line to add **(owner)**.

- **When:** the New task box has Codex chosen, the project folder has a `CLAUDE.md` and no `AGENTS.md`, and Codex wouldn't load it.
- **How Mainframe knows Codex wouldn't load it:** it runs `codex debug prompt-input` in the project folder, with no shell. That prints, as JSON, what the model would be sent, offline, in under half a second, and honours `CODEX_HOME` and the user's profiles. A loaded instructions file appears as a user message whose text starts `# AGENTS.md instructions for <folder>` (Codex labels a `CLAUDE.md` loaded through the fallback that way too). None there: Codex wouldn't load it. It runs each time the box turns to Codex, with nothing kept, so the note goes once the user has added the line. If the command fails or prints something unexpected, no note shows: it is a debug command, and a wrong note is worse than none.
- **What it shows:** a note in the New task box under the agent choice, not blocking the start. Sketch:

  ```
  Agent   ( Claude Code )  ( OpenCode )  (• Codex )
  ⓘ Codex won't read this project's CLAUDE.md. Add this line at the top of
    ~/.codex/config.toml, then start the task:
    project_doc_fallback_filenames = ["CLAUDE.md"]                 [Copy]
  ```

  The path is `$CODEX_HOME/config.toml` when `CODEX_HOME` is set, and `%USERPROFILE%\.codex\config.toml` on Windows. "At the top" because the key must come before the file's first `[table]`.
- The opening prompt still names "its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md", so a session without the setting can still read the file itself.

### Tasks

- **"Began" is about the agent, not OpenCode.** `taskService` sets `task.began` at the first in-turn report only for `agentOf(task) === 'opencode'`. It becomes "for an agent that records no session" (`recordedSession` always null, or a flag on the adapter: builder's call), so Codex tasks get it too. Reopen then starts again with the opening prompt while `began` is false, and resumes with `--last` once it is true, as OpenCode's tasks do.
- **The opening prompt's worktree fields** go to every agent whose adapter has `mainframeAddsWorktree`, not to `'opencode'` by name (`taskService` near the `openingPrompt` call, and the `agent` union in `openingPrompt.ts`).
- **A resume that finds no conversation.** If Codex lost the task's chat (its store was cleared, or `CODEX_HOME` changed), `codex resume --last "<prompt>"` starts a new chat in the worktree with that prompt, without the original brief (checked). The task doesn't get stuck, so Mainframe adds nothing for it **(designer's call)**: Mainframe can't see Codex's store, and the case is rare.
- **The trust question on a project's first Codex task.** Codex reports nothing until it is answered, so the card shows what a session with no report shows today, and the terminal shows the question. Nothing is added for it: it comes once per project. Claude Code asks the same of a new folder.

### Renderer

- **Card and session panel:** they show an agent's name only for `'opencode'`. They show it for every agent other than Claude Code, with no change in looks.
- **Setup and Settings:** a Codex row like OpenCode's, with its copy in `setupCopy.ts`: "Find codex…" (`codex.exe` on Windows), an install link to Codex's docs, "I looked on your PATH and in ~/.local/bin…" (the Windows folder on Windows), and an update hint (`codex update`). Settings has no Codex options in this branch: nothing yet needs one.
- UI work uses the `frontend-design` skill as `CLAUDE.md` asks. The Codex row follows the rows already there.

### Tests

- **Unit:** the adapter (argv, version parsing, places, dropped keys, the throwing manager and sync), the CLAUDE.md check (instructions found, not found, the command failing, a project with an `AGENTS.md`), "began" for Codex, the opening prompt's worktree note for Codex, and the renderer's agent lists with three agents.
- **e2e:** `e2e/fake-codex.cjs`, modelled on `fake-opencode.cjs`: it prints `codex-cli 0.169.0` for `--version`, sends `idle`, `working` and `done` reports, and records its argv and folder. `e2e/codex.e2e.ts` covers start in a Mainframe worktree, reopen with `resume --last` and the carry-on prompt, and the setup row.
- **The owner's hand check, without a Codex account:** the real Codex against a fake model, as in the checks. Codex's model provider is set for one launch with `-c` (`model_provider`, `model_providers.<name>.base_url`, `wire_api = "responses"`, `model`). The fake answers `POST /v1/responses` with server-sent events. A throwaway script outside `src/` and `e2e/`, never shipped; the builder chooses its place, and the plan says how to start it.

## Constraints

- **Project-agnostic and multi-project** (both rules in `CLAUDE.md`): nothing names a project, path or branch; everything works with two projects side by side.
- **Newest versions only** (memory): Codex 0.169.0 is the floor, with no workarounds for older ones.
- **Codex isn't tried with a real model.** The owner has no account. The fake-model check and the e2e fake stand in, and the report says so.
- **Windows and Linux** are covered by unit tests and CI. Codex there is untried by hand.

## Left to the builder

- How "an agent that records no session" is expressed on the adapter.
- The smallest `SyncAdapter` stub that satisfies the type.
- The install link and the exact setup wording, within the rows already there.
- Where the hand-check script lives and its name.

## Follow-ups (not this branch)

- The next branch: the manager and the Todo sync on Codex.
- Commands an agent leaves running when its terminal closes: check Claude Code and OpenCode, then fix it once for all.
- Codex through npm on Windows (`codex.cmd`): run the native `codex.exe` from the npm package, if friends ask for it.
- README: Codex in the agent lists, MAINFRAME_CODEX_BIN in the env table, Codex's .mainframe/worktrees, the CLAUDE.md config note, and that npm's codex.cmd isn't used on Windows. Written in the manager-and-sync branch, before any push.
