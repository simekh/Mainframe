# TheSource: an agent manager on top of Claude Code

Design, 2026-11-04. Written after a brainstorm with the owner (solo developer, macOS). Decisions the owner made are stated plainly. Decisions the designer made on the owner's behalf are marked **(designer's call)**; the owner may overturn them. Facts about Claude Code, iTerm2 and other tools were checked against current docs and the owner's machine on 2026-11-04 (sources at the end).

## 1. Why

The owner runs several Claude Code CLI sessions at once, one per ticket, today in separate iTerm2 tabs, and switches between them by hand. The sessions don't know about each other. The owner is the glue: remembering which tab is which, noticing who is waiting for an answer, and holding one session back until another has merged (the last time merging hurt, the owner had to wait for one session to finish before telling the second to merge).

TheSource is a desktop app that makes working with many sessions at once easy: one board that shows which sessions need the owner, which are working and which are ready to merge; tasks started from the owner's to-do list with one click; and merges into the integration branch that happen one at a time without the owner coordinating them.

## 2. The principle: a layer on top of Claude Code

Claude Code stays the core. Every session in the app is a normal interactive `claude` CLI process with the owner's usual user settings, the repo's CLAUDE.md, skills, plugins, hooks and permission mode. The app adds the owner's workflow around those sessions. Wherever Claude Code already has a feature, the app uses it instead of building its own:

| Need | Claude Code feature used |
|---|---|
| Isolated work per task | Claude Code's own worktrees (`claude -w <name>`) |
| Knowing a session's state | Claude Code hooks, and its OSC 7501 status reports to the terminal |
| Coming back to a session | `--session-id` at launch, `--resume <id>` later |
| Project rules (branch flow, review, what may be pushed) | The repo's CLAUDE.md and the repo's own hooks, never app settings |
| Tools for the manager and the workers | An MCP server the app provides |
| Telling a session something | Hooks that return `additionalContext` |

**Anti-goal:** the app never replaces a Claude Code feature with its own version: no chat view of its own, no agent loop of its own, no screen-scraping to guess state, no copy of a project's rules.

The app adds its hooks and MCP server only to the sessions it starts, through launch flags (`--settings`, `--mcp-config`). It never edits the owner's or a repo's settings files.

## 3. Goals, non-goals, anti-goals

**Goals**
- One board per project window showing every task session, sorted so the owner sees first what needs them.
- Start a task from the to-do list (Trello first) in one click; the session reads the card, plans and starts working, and stops only when it needs the owner. The owner's normal rules still apply inside the session (for example, the brainstorming skill asks its questions; the card then shows under "Needs you"). If the owner says "just fix it", that goes into the opening prompt and the session skips the questions.
- Finished, reviewed work merges into the integration branch one session at a time, without the owner coordinating sessions; the owner is told afterwards; the other sessions hear that the branch moved. By default the session still asks the owner before merging (the repo's own merge menu, §8); a session the owner started with "don't ask me questions" merges without asking.
- Sessions survive closing, crashes and app restarts: the owner can reopen any task's session and continue the same chat.
- Several projects (Damela first, then Word², SmasHit, and the owner's Tele2 work) open at the same time, each with its own rules taken from its own repo.
- The to-do source is pluggable: Trello now, Jira or others later.

**Non-goals**
- Seeing every session's terminal at once. One session is shown at a time; the board is the overview. (The owner dropped an earlier grid-of-tabs layout in favour of this.)
- Tabs of sessions inside a window.
- Its own chat UI for agents, or running agents through the Agent SDK instead of the CLI.
- Pull-request workflows, CI watching, cloud sessions, phone apps.
- Releasing (for Damela: pushing `main`). That stays a manual request in a session, governed by the repo's CLAUDE.md.

**Anti-goals (would make it a failure even if it works)**
- **Slower or clumsier than iTerm2 tabs.** The owner said they'd go back to iTerm2 if it is "just quicker and more convenient". Typing, scrolling, copy/paste and keys in the terminal must feel as good as iTerm2, and starting a task must take less effort than doing it by hand.
- Bypassing a repo's review gate or other safety rules (see §8).
- Replacing Claude Code features (see §2).

## 4. Constraints

- macOS only (the owner's machine: macOS 26, Claude Code 2.1.318, Node 24 via nvm, Python 3.11 via pyenv, `gh` and `jq` installed).
- Solo use, personal tool. No accounts, no server.
- Claude Code's terminal status reports (OSC 7501) need Claude Code ≥ 2.1.295; the machine has 2.1.318.
- Damela's rules (from its CLAUDE.md and DEPLOYMENT.md, summarised here only so the builder can test against them; the app must not encode them):
  - `stage` is the integration branch and `origin/HEAD` (verified: `refs/remotes/origin/stage`). Every card gets its own worktree in `.claude/worktrees/<slug>`, branched from `origin/stage`, with `frontend/node_modules` and `web/node_modules` symlinked from the main checkout.
  - When a card is done: `/code-review high` once on the branch, fix the findings, squash-merge into `stage` in the main checkout (which stays clean on `stage`), push `stage`, remove the symlinks, the worktree and the branch.
  - Pushing `main` deploys and starts a paid build; only on the owner's explicit request.
  - The review gate `.claude/hooks/code-review-gate.sh` is a PreToolUse(Bash) hook registered in Damela's untracked `.claude/settings.local.json`. It denies Claude's `git push`, and `git merge` into `stage`/`main`, unless the commits are covered by a reviewed tip in `.git/claude-reviewed`. It only sees commands run through Claude's Bash tool in a session that loaded that settings file.
  - Damela's local settings set `permissions.defaultMode: bypassPermissions`, so permission prompts are rare there; "needs you" is mostly questions and plan approvals.
- Trello board "Damela" (https://trello.com/b/U5Ui7sSX/damela) has lists TODO, In Progress, Dev, Done, Rejected. TODO is ranked; the top card is next. Labels: Blocker, UI, Backend, Web, You, Decision. "You" cards belong to the owner and are skipped.
- Tele2 uses different rules (it may merge to `main`) and Jira, which the first versions don't support.

## 5. How it gets made (designer's calls)

- **Desktop app: Electron + TypeScript + SolidJS + Vite, terminals with xterm.js (6.x) + node-pty.** Chosen because it is the same stack as Parallel Code, whose proven parts we copy (§6), so they drop in. The alternative considered was a native Mac app on Ghostty's engine (libghostty) or SwiftTerm: better terminal feel, but more work, and libghostty has no tagged release yet.
- **The first thing built is a feel test** (§10, step 1), because terminal feel is the main way this fails and the owner skipped trying Parallel Code first. If the feel test fails, stop and rethink with the owner (the native route is the fallback) before building anything else.
- The app's own state (projects, sessions, history, merge queue) is kept locally in the app's data folder. Format is the builder's choice.
- Trello is read and written through Trello's REST API with the owner's API key and token, stored in the macOS Keychain. (The manager session separately has the owner's Trello MCP connector for its own judgement work.)
- Name: TheSource (the repo name) unless the owner picks another.

## 6. What we copy from Parallel Code

Parallel Code (https://github.com/johannesjo/parallel-code, MIT, v5.1.0, HEAD 97c3558 on 2026-11-01) is an Electron app for running coding agents in parallel. We don't fork it: it is ~160k lines with features we don't need, one maintainer changing it ~500 times a month, a single window, and a built-in merge that works against our rules. We copy these parts, keeping its MIT copyright notice:

1. **Terminal handling** (`src/components/TerminalView.tsx`, `src/lib/terminalClipboard.ts`, `src/lib/keybindings/defaults.ts`, `electron/ipc/pty.ts`): Shift+Enter sent as ESC CR; Cmd+←/→/⌫; paste through a main-process clipboard helper (files and images become paths) with bracketed paste; OSC 52 copy for Claude Code's fullscreen mode; flow control (pause the PTY at ~256 KB queued output); WebGL renderer only for terminals on screen, DOM renderer otherwise, Chromium's WebGL context limit raised; a "redraw terminals" command. Look again at its 8 ms input and output batching: it adds delay compared with iTerm2, and the feel test decides whether to keep it.
2. **Status from Claude Code hooks** (`electron/agent-hooks/*`): a per-launch `--settings` file registering SessionStart, UserPromptSubmit, Stop/StopFailure, Pre/PostToolUse, PermissionRequest, Subagent events and Notification (`permission_prompt`, `idle_prompt`, elicitation); each hook posts to a token-protected listener in the app. **Leave out** its fallback of regexes on terminal output and its auto-accepting of the folder-trust dialog (both against §2).
3. **Session ids and resume** (`electron/shared/session-resume.ts`): a fixed `--session-id` at first launch, `--resume <id>` afterwards.
4. ~~Worktree creation~~: replaced by Claude Code's own `-w` (§7.2), per the principle in §2.
5. **Conflict hand-back** (`src/components/MergeConflictBanner.tsx`): reduced to the app telling a worker why its merge turn ended (§8).
6. **Task-source pattern** (`electron/super-productivity/`): main-process client, token store, IPC registration, store module. Template for the Trello source, behind a small task-source interface so Jira can be added later.
7. **The MCP coordinator** (`electron/mcp`): the tools that let one agent create, prompt and merge other tasks. Starting point for the manager's and workers' MCP tools (§7.6, §8), reshaped to our rules (no app-run merges).

Also borrow the look of Parallel Code's board (§7.1), which the owner likes.

## 7. How it works

### 7.1 The window

Agreed with the owner from a mockup based on Parallel Code's board view:

- **Project rail** (far left): every project, each with a count of sessions that need the owner. Clicking a project switches the window to it, or brings forward another window already showing it. **Several windows**: Cmd+N opens another window (one project each); the owner toggles between windows (Cmd+`).
- **Toolbar**: Manager, Start next card, History, project picker, search.
- **Board lanes**, following a task's life:
  1. **TODO**: the to-do source's list, in its order (for Trello: the TODO list's rank). "You" cards shown greyed and never started automatically. Clicking a card opens its details (description, labels, checklists) with a **Start** button.
  2. **Needs you**: sessions waiting for the owner, **Blocker label first, then to-do order** (a fixed rule; the app sorts, not the AI). Each card says why (asking a question, plan to approve, permission prompt, stopped) and has an Answer button that opens it.
  3. **Working**.
  4. **Ready to merge**: waiting for the merge turn, or holding it.
  5. **Merged today**.
- **Right panel**: the selected session. Header with the task's title, project, branch, a link to the card, and Close session; the files the session changed; the **real Claude Code terminal**; and a **message field** below it that sends text into that terminal as if typed (multi-line via bracketed paste, then Enter). With nothing selected, the panel shows the manager session.
- **Ctrl+Tab** jumps to the next session that needs the owner (as in Parallel Code).
- **History**: every session the project has had, including merged and closed ones, with **Reopen**.

How sessions "light up" beyond the board (notifications, sounds, Dock badge) is decided later.

### 7.2 Starting a task

1. The owner clicks **Start** on a card, uses **Start next card**, or asks the manager (from step 3 on).
   - **Start next card** without the manager (step 1): the top TODO card without the "You" label **(designer's call)**. With the manager (step 3): the manager picks, also judging from the card's labels and text (for example a "Decision" card that needs the owner first), and says so if it skips a card.
2. The app runs, in the project's main checkout, in a new PTY:
   `claude -w <slug> -n <project>-<slug> --session-id <uuid> --settings <app hooks file> --mcp-config <app MCP config> "<opening prompt>"`
   - `<slug>`: a short slug of the card title, unique within the project (Damela's own convention for worktree names).
   - Claude Code creates `.claude/worktrees/<slug>` on branch `worktree-<slug>`, branched from the remote default branch (`worktree.baseRef` default `"fresh"`; for Damela `origin/stage`). The app does not create worktrees itself.
   - Repo-specific setup (Damela's `node_modules` symlinks) is done by the session itself, following the repo's CLAUDE.md, as today. The opening prompt tells the session it is already in its card's worktree, so it doesn't call EnterWorktree again.
3. The **opening prompt** contains the card's link, number, title, description, labels and checklists, and says: this card is your brief; read it, plan, start; follow this repo's CLAUDE.md; ask the owner when you need them. It also explains the app's merge-turn tools (§8), which are the app's own protocol, not a project rule.
   - **No-questions mode:** when the owner starts a task with "don't ask me questions" / "just fix it" (a checkbox next to Start, or said to the manager), the prompt says so: skip clarifying questions, and when the work is done and reviewed, merge without asking (skip the merge menu). This is the owner's instruction for that one task, passed through; it is the only case in which a session merges without asking.
4. The app moves the card to the source's "in progress" list (Trello: In Progress) **(designer's call)**.
5. The session appears under Working, and the app records: project, card, slug, session name, session id, worktree path, branch, start time.

The owner can also start a session from a plain description instead of a card ("New task"), for projects without a supported to-do source (Tele2 until Jira exists) **(designer's call)**.

### 7.3 Knowing each session's state

Sources, in order of trust:
1. **Hooks** from the app's `--settings` file (copied from Parallel Code, §6.2).
2. **OSC 7501 status reports** that Claude Code sends to the terminal (working / waiting / done), when the terminal answers its support query. The app must answer that query and parse the reports. **(Builder's call, 2026-11-04 while planning:** done in the main process on the PTY output, not with xterm.js `registerOscHandler` in the window. The main process sees every session's output whether or not its view is mounted, and it answers before xterm's reply to the `CSI c` that Claude Code sends right after the query; a reply arriving after that one means "unsupported". The board reads status there too.)
3. Whether the `claude` process is alive.

`claude agents --json` also lists every live session with `status` busy/idle/waiting; useful for debugging and as a cross-check, not required.

States and lanes:
- **Working**: a prompt was submitted or tools are running.
- **Needs you**: a permission prompt or question is open (`permission_prompt`, `elicitation_*`, `PermissionRequest`), or the turn ended (Stop, or OSC 7501 "waiting/done") and the session has not asked for the merge turn. A turn that ended with a plain-text question counts as needing the owner. This includes a finished, reviewed session asking how to merge (the repo's merge menu); the card should say so ("ready: asks to merge"), so the owner can tell it apart from a question about the work.
- **Ready to merge**: the session asked for the merge turn (§8) and is waiting for it or holding it.
- **Merged**: the session reported a successful merge (§8).
- **Closed**: the process is gone (closed by the owner, crashed, app quit) and the task isn't merged. Shown with **Reopen**.

In step 1 (before the merge turn exists) a finished session sits under Needs you until the owner closes it.

### 7.4 Reopening

**Reopen** runs `claude --resume <session id>` for that task, with the same app hooks and MCP config, in the same project/worktree context the session was started in, so the same chat continues. When the app quits, it ends its sessions; when it starts again, it reopens every session that was running (Parallel Code does the same).

### 7.5 Trello

- The TODO lane reads the board's TODO list in rank order, with labels, description and checklists. Card numbers (`#124`) are Trello's short ids.
- The app moves a card to In Progress when its session starts, and to Dev when its branch is merged (from step 2) **(designer's call; the owner did not object)**.
- Per project, the app stores which board and which lists mean "to do", "in progress" and "merged". This is to-do-source setup, not workflow rules.
- Behind a task-source interface (list tasks, get details, move task) so Jira can be added later.

### 7.6 The manager

The manager is a normal interactive Claude Code session, pinned at the top of the board and shown in the right panel when nothing else is selected. The split agreed with the owner:

- **The app does everything mechanical, so it's reliable:** sorting, status, starting sessions, the merge turn, moving cards, history.
- **The manager does what needs judgement or words:** "start the next card" (choosing it, skipping "You" cards, judging from the text), "what is #124 doing?", "what merged today?", passing a message on to one session or to all, writing a merge summary when a worker didn't.

It runs in the project's main checkout (so it reads the repo's CLAUDE.md), with an appended system prompt describing its role, and the app's MCP tools (from Parallel Code's coordinator, §6.7): list sessions and their state, start a card, send a message to a session (typed into that session's terminal), read a session's recent output or summary, list merges. It doesn't change files; the merge-turn hook (§8) also applies to it.

### 7.7 Closing, discarding, and sessions outside the app (designer's calls)

- **Close session** only pauses: it ends the `claude` process and keeps the worktree, the branch, any uncommitted changes and the card where it is. The task shows as Closed with Reopen. When Claude Code asks on exit whether to keep a named session's worktree, the app keeps it (or launches/exits in a way that avoids the question). Close never deletes work.
- **Discard** is a separate action for giving up on a task. It asks first, listing what would be lost (uncommitted changes, commits not on any remote). On confirm it removes the worktree and the branch, and moves the card back to TODO or to Rejected (the owner picks in the same dialog). The session stays in History so its transcript can still be read.
- **Sessions the app didn't start** (iTerm2 tabs, the Claude app, cloud sessions) can't be given merge turns. The app shows Claude sessions running in the project's repo that it didn't start (from `claude agents --json`, matched on `cwd`) on the board, marked "outside", with their busy/idle/waiting state, read-only. There is no import: cards in progress in iTerm2 at switch-over finish there. The repo's own CLAUDE.md rule (main checkout not clean or not on its branch → stop and ask) stays the backstop when an outside session is merging.

## 8. Merging: the worker merges, the app hands out turns

Decided with the owner: rules live in the repo's CLAUDE.md, not in the app. So the **worker merges its own branch, following the repo's CLAUDE.md**, exactly as sessions do today (for Damela: `/code-review high` once, fix, then the `superpowers:finishing-a-development-branch` merge menu, which asks the owner; on "merge locally": squash-merge into `stage` in the main checkout, push `stage`, clean up). Because the merge runs through Claude's Bash tool in a session that loaded the repo's settings, the repo's own review gate keeps working. The app adds only what CLAUDE.md can't: **a turn to merge**, so merges happen one at a time.

**The owner's OK (decided 2026-11-04):** by default every session asks the owner before merging, through the repo's own merge menu; while it waits, the card is under Needs you (§7.3). Only a session started in no-questions mode (§7.2) merges without asking. No repo's CLAUDE.md needs changing for this. (This replaces the owner's earlier "merge on its own and tell me after", given before it was clear that Damela's flow asks through the menu.)

1. When its work is done and reviewed and the owner has said to merge (or the session runs in no-questions mode), the worker calls the MCP tool `request_merge_turn` (with a short summary of what the branch delivers). The card moves to Ready to merge.
2. The app grants the turn to one session at a time, first come first served **(designer's call)**. The tool returns when the turn is granted (or reports the session's place in the queue and the app delivers the grant through a hook; the builder picks the mechanism that works with Claude Code's MCP timeouts).
3. Holding the turn, the worker merges and pushes as its CLAUDE.md says, then calls `release_merge_turn` with the result: merged (with the new integration-branch commit), or not merged and why (conflict, review gate denied, main checkout not clean, other).
4. On "merged": the card moves to Merged today and the source's "merged" list (Trello: Dev); the owner is told afterwards (in the app; how it lights up is decided later).
5. On a conflict: the worker resolves it itself in its worktree (it knows the card), runs whatever review its CLAUDE.md requires for the new work, and asks for a new turn. The app shows why the turn ended.

**The turn is enforced, not just polite (designer's call):** the app's hooks file includes a PreToolUse(Bash) hook for every session the app starts. It denies, unless that session holds the turn:
- any git command that moves refs or changes files in the project's **main checkout** (commit, merge, rebase, reset, checkout/switch, pull, cherry-pick, revert, stash), and
- any `git push` whose destination is the integration branch.

The deny message names the `request_merge_turn` tool, so a session that forgot the protocol learns it at the moment it matters. The **integration branch** is whatever branch the main checkout has checked out (Damela: `stage`), so it needs no configuration. The hook only has to stop honest mistakes by the same model, not determined evasion; Damela's gate script shows how hard exact command parsing is, so keep this one simple and deny when unsure.

**A turn is never stuck:** if the holder's process ends while holding the turn, the app takes the turn back, checks whether the main checkout is clean and on its branch, and if not puts a "merge interrupted" item under Needs you instead of granting the next turn.

**Telling the others the branch moved:** the app watches the integration branch (local and `origin/`). When it moves, every other running session of that project gets a one-line notice at its next step through the app's hooks (`additionalContext` on PostToolUse/UserPromptSubmit), for example "stage moved to abc1234 (#124 merged). Rebase before you ask for the merge turn." Idle sessions get it when they next start a turn; they don't need waking. `request_merge_turn` also returns the current integration commit.

**What stays a CLAUDE.md rule, as today:** never pushing Damela's `main`; squash or not; which review to run. Other projects (Tele2, which may merge to `main`) follow their own CLAUDE.md the same way.

## 9. Projects

A project is a local repo (its main checkout path) plus optional to-do-source settings (§7.5). Add one from the rail ("+ Add project"). Everything else comes from the repo itself. The data model is per project from step 1, even though step 1 shows only Damela, so step 4 isn't a rewrite **(designer's call)**.

## 10. Build order

Each step is usable on its own. Damela is the test project throughout.

1. **Start and see** (Damela only)
   - **Feel test first:** one Claude Code session in the app's terminal next to iTerm2. The owner compares typing, Shift+Enter, Option keys, copy/paste (including fullscreen mode), scrolling, and speed with 6–8 sessions running. The owner decides pass or fail. On fail, stop and rethink with the owner.
   - TODO lane from Trello with card details and Start; Start next card (top non-"You" card); sessions launched as in §7.2; card moved to In Progress.
   - Needs you and Working lanes from §7.3; right panel with terminal, changed files and message field; Ctrl+Tab.
   - Closed sessions shown with Reopen; sessions reopened after an app restart.
   - Merging works as today (the worker follows CLAUDE.md, no turn yet).
2. **Merge turn**: §8 in full; Ready to merge and Merged today lanes; card moved to Dev; branch-moved notices.
3. **Manager**: §7.6; Start next card moves to the manager's judgement.
4. **All projects**: project rail with counts, several windows, Word², SmasHit and Tele2; History with Reopen; New task from a plain description.

Later: Jira source; notifications and how sessions light up.

## 11. Things to verify early (step 1), with fallbacks

1. **Does a session launched with `claude -w <slug>` from the main checkout load the repo's `.claude/settings.local.json`** (and so Damela's review gate)? That file is untracked, so it doesn't exist inside the worktree. Test: launch as in §7.2, then try a `git push` the gate should deny. Fallback: launch the worker in the main checkout without `-w` and let it create its worktree with EnterWorktree as Damela's CLAUDE.md already says; the app then learns the worktree path from the hooks' `cwd`.
2. **Hooks passed with `--settings`** run alongside the user's and project's own hooks. Parallel Code relies on this; confirm it, and that the owner's existing user hooks (iTerm2's `cc-status`, the GSD hooks) don't misbehave outside iTerm2.
3. **OSC 7501**: the exact query/answer and report format (from Claude Code's docs and the protocol spec), and that Claude Code reports in the app's terminal.
4. **Resume** from the app: which folder `claude --resume <id>` must run in for a `-w` session to find its transcript, including after the worktree has been removed by a merge.
5. **Cleanup after merge**: Damela's CLAUDE.md has the worker remove its own worktree and branch after the squash merge, but a `-w` session runs inside that worktree. Find out how this behaves (Claude Code prompts about keeping or removing a named session's worktree on exit) and make sure a merged task ends with its worktree and branch gone and its transcript still reopenable from History. Close session never removes anything (§7.7).
6. **MCP tool calls that wait** (for the merge turn): Claude Code's MCP timeouts, and whether a hook-delivered grant works better.
7. **Merging from inside a worktree.** Claude Code blocks a worktree session's Bash commands whose working directory is the main checkout, and git commands pointed at it (`git -C`, `--git-dir`, `GIT_DIR`, a `cd` first); part of that check can't be turned off (worktrees doc, "How Claude Code enforces isolation"). The merge in §8 runs in the main checkout. Find out how a `-w` session can do it: for example leave the worktree with `ExitWorktree` (keeping it), merge, then clean up, and whether `ExitWorktree` is offered to a session started with `-w` and not only to one that called `EnterWorktree`. Fallback: as in item 1, launch the worker in the main checkout and let it enter its worktree itself. (Added 2026-11-04 while planning.)

## 12. Left to the builder

Folder layout; state storage format; the exact hook scripts and listener; how the MCP server is exposed to sessions (local HTTP with a token, or a stdio shim); slug rules; how the message field handles very long text; window/rail styling details within the Parallel Code look; tests and their tooling; how much of Parallel Code's code is copied verbatim versus rewritten, as long as the behaviour in §6 is kept and its MIT notice is included.

## 13. Sources (checked 2026-11-04)

- Claude Code docs: cross-session messaging (https://code.claude.com/docs/en/cross-session-messaging.md), agent view (https://code.claude.com/docs/en/agent-view.md), worktrees (https://code.claude.com/docs/en/worktrees.md), hooks (https://code.claude.com/docs/en/hooks.md), CLI reference (https://code.claude.com/docs/en/cli-reference.md), terminal configuration incl. OSC 7501 and Shift+Enter (https://code.claude.com/docs/en/terminal-config).
- Notable facts: cross-session messages can only be sent from inside a session (no documented external format); Notification matchers include `permission_prompt`, `idle_prompt`, `elicitation_*`; `additionalContext` is accepted by SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop and others; `worktree.baseRef` is `"fresh"` (remote default branch) or `"head"`, not a branch name; agent teams are experimental and unsuited to long-running tickets; `claude agents --json` lists interactive sessions (verified on the owner's machine).
- Parallel Code: https://github.com/johannesjo/parallel-code (MIT), release v5.1.0 (2026-10-29); code paths in §6 are from commit 97c3558.
- Terminal components: xterm.js (https://github.com/xtermjs/xterm.js), node-pty (https://github.com/microsoft/node-pty); native alternatives considered: libghostty (https://ghostty.org), SwiftTerm (https://github.com/migueldeicaza/SwiftTerm).
- Damela: `CLAUDE.md`, `DEPLOYMENT.md` → "Branches and releases", `.claude/hooks/code-review-gate.sh`, `.claude/settings.local.json`.
