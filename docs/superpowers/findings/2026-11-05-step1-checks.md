# Step 1 early checks (spec §11.1–§11.7)

Run 2026-11-05 with Claude Code 2.1.318, in Mainframe's terminal. §11.1–§11.3 and §11.5 form 1 were run by the owner at the keyboard. The rest were run by the agent, through a Playwright script that types into the built app. Each app session was a login shell (`MAINFRAME_SESSION_ARGV='["/bin/zsh","-l"]'`) with OSC 7501 traffic logged (`MAINFRAME_LOG_OSC=1`). `<probe>` is a throwaway directory outside any repository holding a bare `origin.git` (default branch `stage`) and its clone `repo`.

## §11.1 Does a `-w` session load Damela's `.claude/settings.local.json` (the review gate)?

**Ran:** in Damela, `claude -w mainframe-probe-gate -n mainframe-probe-gate --debug-file <probe>/v1-debug.log`; `/hooks`; "Run git status and show the output."; `/exit`, remove.

**Observed:**

- `/hooks` → PreToolUse lists `[Local] g=/Users/simonekholm/Developer/Simmesolo/Damela/... Bash · command`: the review gate, sourced from local settings. The `/hooks` menu is read-only in this version ("This menu is read-only. To add or change a hook, edit settings.json or ask Claude.") and lists 24 hooks on 11 events.
- Debug log: `Skipping settings.local.json copy into /Users/simonekholm/Developer/Simmesolo/Damela/.claude/worktrees/mainframe-probe-gate: it resolves localSettings to the canonical repo root, so a copy would become a stale, revocation-resurrecting legacy overlay`.
- Debug log, when Claude ran `git status`: `Hooks: PreToolUse:Bash [g=/Users/simonekholm/Developer/Simmesolo/Damela/.claude/hooks/code-review-gate.sh; ...]`. The gate ran and let `git status` through. Claude ran it without a permission prompt (a read-only command).
- Debug log, at startup: `settings defaultMode "bypassPermissions" ignored — only policy/user/flag settings may grant bypass mode (projectSettings and localSettings are repo-controllable)`.
- `/exit` asked keep or remove; after remove, `git -C <damela> worktree list` and `git -C <damela> branch --list 'worktree-mainframe-probe*'` no longer list the probe.

**Answer:** yes. A `-w` session reads the main checkout's `settings.local.json` in place (not a copy), so Damela's review gate applies inside the worktree and runs on every Bash call.

**For plan 2:** the `-w` launch form keeps the review gate; nothing to copy or inject. But `bypassPermissions` in Damela's local settings is ignored: sessions there run in the owner's user-level mode, `auto` (`~/.claude/settings.json`), which approves many actions itself and asks for some (a file write in `<probe>/repo` went through; `git -C <damela> …` commands asked). If plan 2 wants bypass, it has to come from the launch (`--permission-mode bypassPermissions`) or the owner's user settings.

## §11.2 Do `--settings` hooks run alongside user and project hooks, and do the owner's hooks behave outside iTerm2?

**Ran:** `<probe>/v2-settings.json` with a hook on `SessionStart`, `UserPromptSubmit`, `PreToolUse` (matcher `Bash`) and `Stop`, each running `jq -c '{e: .hook_event_name, cwd: .cwd}' >> <probe>/v2-hooks.log`. In Damela's main checkout: `claude --settings <probe>/v2-settings.json --debug-file <probe>/v2-debug.log`; `/hooks`; "Run git status and show the output."; `/exit`.

**Observed:**

- `<probe>/v2-hooks.log`, one line per event, all with `"cwd":"/Users/simonekholm/Developer/Simmesolo/Damela"`: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`.
- The debug log runs each event's hooks side by side, for example `PreToolUse:Bash`: `cc-status`, the `--settings` jq hook, `gsd-validate-commit.sh`, the Local review gate, `sf-data-guard.js`.
- `/hooks` does **not** list the `--settings` hooks: it shows the same "24 hooks on 11 events" (User, Local, Plugin) as without the flag.
- `grep -iE "hook.*(error|fail)" <probe>/v2-debug.log`: no matches. Every `cc-status` run finished with status 0 (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, Notification, PostToolUse, Stop, SessionEnd). Nothing stray appeared in the terminal.
- Claude ran `git -C /Users/simonekholm/Developer/Simmesolo/Damela status`, which is not auto-allowed, so with bypass ignored (§11.1) it showed a permission prompt (`permissionDecisionMs=19154`). Its suggested rule had `"destination": "localSettings"`: "don't ask again" would have written Damela's `settings.local.json`. The owner approved once; the file is unchanged.

**Answer:** yes. Hooks from `--settings` run together with user, local and plugin hooks, in the session's cwd. The owner's iTerm2 hooks run cleanly inside Mainframe. But `/hooks` doesn't show `--settings` hooks, so the owner can't see Mainframe's hooks there.

**For plan 2:** Mainframe can add its own hooks per session with `--settings` without touching any settings file. Its hooks are invisible in `/hooks`, so the app should say somewhere which hooks it adds. Expect permission prompts in Damela (`blocked · permission`): approvals with "don't ask again" land in Damela's `settings.local.json`, which is Claude's doing, not the app's.

## §11.3 OSC 7501 in the app's terminal

**Ran:** `claude` in `<probe>/repo` (trusted, and Mainframe itself is not; see the ledger ruling), plus the §11.1 and §11.2 sessions in Damela, all logged by the app (`[osc7501] <session> <payload>`). Prompts: "Run git log --oneline and tell me what you see.", "Create a file called note.txt containing hello.", "Ask me a multiple-choice question with your AskUserQuestion tool.", "Count slowly from 1 to 300, one number per line." with Esc while it counted, `/exit`. The owner watched the session row.

**Observed** (every report carries `app=claude-code`; no report carried an `id`; `msg` is base64, decoded here):

| Moment | OSC 7501 from Claude Code | Session row |
|---|---|---|
| Startup | a query (`ESC]7501;?ST`, answered by the app), then `state=idle` | `idle` |
| Prompt submitted | `state=working` | `working` |
| Tool running | `state=working:msg=…`, the tool's description: "Showing one-line commit history for the repo", "Writing note.txt" | `working` |
| Permission prompt (Damela, auto mode asked) | `state=blocked:kind=permission:msg=…` "approve Bash: git -C /Users/simonekholm/Developer/Simmesolo/Damela status"; for a write, "approve Write: <path>" | `blocked · permission` |
| Prompt approved | `state=working` | `working` |
| AskUserQuestion | `state=blocked:kind=question:msg=…` "answer: What should I do next with note.txt, which now contains 'hello'? (Leave it as is · Commit it · Add more text · Delete it)" | `blocked · question` |
| Question answered | `state=working`, then `state=done` | `done · question` (bug, fixed in the app: the row kept the old kind; now `done`) |
| Reply finished | `state=done` | `done` |
| Esc while working | `state=idle`, with "Interrupted · What should Claude do instead?" on screen (§11.6 run; in the counting test the reply had already finished, so it showed `done`) | `idle` |
| `/exit` | `state=working`, `state=idle`, then `state=clear` three times | — |

In `auto` mode no permission prompt appeared for the file write in `<probe>/repo`, so no `blocked` came; prompts appeared for `git -C <damela> …` commands and for a write into a Damela worktree.

**Answer:** Claude Code 2.1.318 speaks OSC 7501 in Mainframe's terminal from the first second: it queries support, then reports `idle`, `working` (with the current tool's description), `blocked` with `kind=permission` or `kind=question` (with the exact question or command), and `done`, and clears on exit. It sends one record per session, without an `id`.

**For plan 2 (lane mapping, spec §7.3):** `blocked` → Needs you, with `msg` as the card's line ("approve Bash: …", "answer: …"); `working` → Working, with `msg` as the activity; `done` and `idle` → waiting for the owner's next prompt (`done` after a reply, `idle` before the first); `clear` → the session ended. Esc shows as `idle`, the same as a fresh session. A row must replace its whole status on every report.

## §11.4 Where must `claude --resume <id>` run for a `-w` session?

**Ran** (driven by the agent through Mainframe): from `<probe>/repo`, `claude -w probe-resume -n probe-resume --session-id <uuid C>`, "Say OK.", `/exit` → Keep. Then each resume followed by "Run pwd and show the output.".

**Observed:**

- `/exit` inside the worktree showed: "Exiting worktree session / This session was named "probe-resume". Keep the worktree to resume it later, or remove it to clean up. / 1. Keep worktree  Stays at <probe>/repo/.claude/worktrees/probe-resume / 2. Remove worktree  Clean up the worktree directory." After Keep it printed "Resume this session with: claude --worktree "probe-resume" --resume <uuid C>".
- The worktree started at `fbe4c68` (`origin/stage`), not at local `stage` (`3639575`). The later `-w` worktree in row (d) did the same. So did §11.5 form 2's EnterWorktree: its commit `b7f7c2b` has parent `fbe4c68`, while local `stage` was then at `4aedd91`. (Form 1 shows nothing here, because local `stage` and `origin/stage` were both `fbe4c68` when it started.) New worktrees start from the remote default branch.

| Resume | Conversation | Continues in |
|---|---|---|
| (a) `claude --resume <uuid C>` from `<probe>/repo`, worktree kept | loaded | `<probe>/repo`, the main checkout (Claude: "The working directory has changed. It is now the probe/repo path, not the earlier .claude/worktrees/probe-resume worktree.") |
| (a′) `claude --worktree probe-resume --resume <uuid C>` from `<probe>/repo` | loaded | the worktree (`pwd` → `…/.claude/worktrees/probe-resume`) |
| (b) from `~` | — | Claude first asked to trust `/Users/simonekholm` ("Accessing workspace: /Users/simonekholm … Is this a project you created or one you trust?"); declined, since that is the owner's call |
| (b′) `claude --resume <uuid C>` from `~/Developer` (trusted) | loaded | `~/Developer` ("which is not a git repository") |
| (c) after `git worktree remove --force …/probe-resume`, `claude --resume <uuid C>` from `<probe>/repo` | loaded | `<probe>/repo`; no "worktree … no longer exists" notice was visible (the TUI redraws at start). The branch `worktree-probe-resume` survived the forced remove. |
| (c′) then `claude --worktree probe-resume --resume <uuid C>` | loaded | a re-created worktree on the surviving branch, at `fbe4c68`, locked again |
| (d) a new session, `claude -w probe-kill -n probe-kill --session-id <uuid D>`, "Say OK.", then Mainframe quit with the session running (as Cmd+Q does; no `/exit`). Then `claude --resume <uuid D>` from `<probe>/repo` | loaded | the worktree (`pwd` → `…/.claude/worktrees/probe-kill`). The quit left the worktree and its branch in place, still marked `locked`. `/exit` → Remove in the resumed session then removed both. |

Exiting (c′) with "Remove worktree" printed "Removing worktree… / Worktree removed." and deleted the branch too.

**Answer:** `--resume <id>` finds the conversation from any trusted directory. Where it continues depends on how the session ended:

- **After `/exit` → Keep:** plain `--resume` continues in the directory it was launched from, not in the worktree. To continue inside the worktree, resume from the main checkout with `--worktree <name> --resume <id>`. That also re-creates the worktree from its branch if the directory was removed.
- **A session killed inside its worktree** (row d): plain `--resume` from the main checkout goes back to the worktree.

This matches the worktrees doc: "When you resume a session that ended inside a worktree without exiting it, Claude Code returns the session to that worktree." `/exit` → Keep counts as exiting.

**For plan 2:**

- **Reopen from the main checkout** with `claude --worktree <name> --resume <id>`, the form Claude itself prints after Keep.
- **After an app quit,** plain `claude --resume <id>` also returns to the worktree (row d). `--worktree <name> --resume <id>` after a quit wasn't tried.
- **Plain `--resume` after `/exit` → Keep** would put the session in the main checkout, where its edits would land on `stage`.
- **Branches:** removing a worktree with `/exit` → Remove also deletes its branch. `git worktree remove` alone leaves the branch.
- **Locks:** a quit leaves the worktree locked. Claude Code's own resume and removal handled the lock.

## §11.5 and §11.7 Can a `-w` session merge into the main checkout, and what happens to its worktree and transcript?

### Form 1: `claude -w probe-merge -n probe-merge --session-id <uuid A>` from `<probe>/repo`

Quotes are from the session transcript (`~/.claude/projects/<probe-repo>/<uuid A>.jsonl`).

1. "Create probe.txt … commit -m probe on this branch": committed in the worktree, `[worktree-probe-merge 5e01dd3] probe`.
2. "Run exactly: `git -C <probe>/repo status`": **refused** by the harness, as a tool error: "This session is isolated in the worktree <probe>/repo/.claude/worktrees/probe-merge, but this command redirects git to the shared checkout via -C. Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Run the equivalent from <probe>/repo/.claude/worktrees/probe-merge without the redirect." Claude then ran plain `git status` in the worktree instead.
3. "Do you have an ExitWorktree tool?": yes (loaded via ToolSearch). `ExitWorktree {"action": "keep"}` returned: "Exited worktree. Your work is preserved at “<probe>/repo/.claude/worktrees/probe-merge” on branch “worktree-probe-merge”. Session is now back in “<probe>/repo”." The transcript records `worktree-state: null` and the cwd of later messages is `<probe>/repo`.
4. The four commands, run by Claude from `<probe>/repo` without any refusal: `git merge --squash worktree-probe-merge` ("Squash commit -- not updating HEAD"), `git commit -m 'probe squash'` (`[stage 4aedd91] probe squash`), `git worktree remove …/probe-merge` (no output), `git branch -D worktree-probe-merge` ("Deleted branch worktree-probe-merge (was 5e01dd3).").
5. `/exit` (run by the owner; what it printed was not recorded). The session had already left the worktree in step 3.
6. `claude --resume <uuid A>` from `<probe>/repo` (re-run later by the agent through Mainframe): the whole conversation loaded, down to the merge summary, and the status line showed `repo`. On exit Claude printed "Resume this session with: claude --resume <uuid A>".

Afterwards: `git -C <probe>/repo log --oneline -3` → `4aedd91 probe squash`, `fbe4c68 init`; `worktree list` → only `<probe>/repo [stage]`; `branch` → `* stage`. The transcript is stored under the **main checkout's** project directory (`-…-probe-repo/<uuid A>.jsonl`), not under the worktree's.

### Form 2: `claude -n probe-enter --session-id <uuid B>`, then EnterWorktree

Driven by the agent through Mainframe (a script typing into the app's terminal). The file was `probe-enter.txt`, because `probe.txt` was already on `stage` from form 1.

0. "Use EnterWorktree named probe-enter": `Creating worktree(probe-enter)` → "Switched to worktree on branch worktree-probe-enter" at `<probe>/repo/.claude/worktrees/probe-enter`, "created from the current repo state". Claude added: "To leave it mid-session, use ExitWorktree. Otherwise you'll be asked whether to keep or remove it when the session ends."
1. Commit: `b7f7c2b probe-enter` on `worktree-probe-enter`.
2. `git -C <probe>/repo status`: **refused** the same way. Claude: "The command was refused, so I haven't run it. The -C flag points git at the original checkout, and the harness blocks that because this session is isolated in the probe-enter worktree."
3. ExitWorktree keep: "Kept worktree (branch worktree-probe-enter) / Returned to <probe>/repo".
4. The four commands from `<probe>/repo`: all ran ("Committed 3639575, ran 3 shell commands"), no refusal, no permission prompt (auto mode).
5. `/exit`: **no keep/remove prompt** (the session was no longer in a worktree). It printed: "Resume this session with: claude --worktree \"probe-enter\" --resume <uuid B>", naming the worktree that no longer exists.
6. `claude --resume <uuid B>` from `<probe>/repo`: the whole conversation loaded; "Run pwd" → `<probe>/repo`.

Afterwards: `git log --oneline -3` → `3639575 probe enter squash`, `4aedd91 probe squash`, `fbe4c68 init`; `worktree list` → only `<probe>/repo [stage]`; `branch` → `* stage`. Claude kept a project directory for each worktree (`…-probe-repo--claude-worktrees-probe-enter`, `…-probe-merge`), but the transcripts live under the main checkout's directory.

### Answer

Yes, in both forms, but not from inside the worktree. While a session is in a worktree, the harness refuses any git command that points at the main checkout (`git -C <main>`), with the message quoted above. After `ExitWorktree` with `keep`, the same session runs in the main checkout and can squash-merge the worktree branch, commit, remove the worktree and delete the branch. The transcript survives all of it and resumes from the main checkout. The two forms behaved the same in every step that was recorded. Form 2's `/exit` printed a resume hint naming `--worktree "probe-enter"`, a worktree that no longer exists. Form 1's `/exit` text wasn't recorded, so it may do the same. `-w` also creates the worktree before the first prompt.

**For plan 2:** the merge turn is: ExitWorktree keep → merge in the main checkout → remove worktree and branch, all in the same session. `/exit` asks keep or remove only while the session is still in its worktree. Resume from the main checkout. Either launch form works; `-w` needs no first instruction.

## §11.6 MCP tool calls that wait

**Ran** (driven by the agent through Mainframe, in `<probe>/repo`; see the ledger ruling): the spike server in `spikes/mcp-wait`, built on `@modelcontextprotocol/server` 2.4.0 (the v2 TypeScript SDK). It has one tool, `wait_seconds`. Each app session ran `claude --mcp-config <root>/spikes/mcp-wait/mcp.json` and got this prompt: "Call the wait_seconds tool from the wait MCP server with seconds=<n>, then tell me exactly what it returned."

- Four sessions asked for 30, 150, 330 and 630 s.
- A fifth asked for 300 s, and got Esc after about 20 s.
- Two more ran with a timeout setting changed on the command line (`VAR=… claude …`).

Times are UTC, from the app's OSC log.

**Observed:**

| Call | Outcome | Prompt → background → result | OSC 7501 |
|---|---|---|---|
| 30 s | returned `waited 30s` in the foreground | 08:36:08 → — → 08:36:47 | `working` (no `msg`), `done` |
| 150 s | moved to a background task after two minutes; returned `waited 150s` | 08:36:31 → 08:38:39 → 08:39:05 | `working`; `done` when it moved to the background; `working`, `done` when the result arrived |
| 330 s | the same; returned `waited 330s` | 08:36:43 → 08:38:50 → 08:42:17 | the same |
| 630 s | the same; returned `waited 630s` | 08:36:54 → 08:39:02 → 08:47:29 | the same |
| 300 s, Esc after 19 s | "Interrupted · What should Claude do instead?" No result arrived later (checked at 08:49, past the 300 s). | 08:37:32 → Esc 08:37:51 | `working`, `idle` |
| 150 s, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` | stayed in the foreground; returned `waited 150s` ("Cooked for 2m 36s") | 08:40:19 → — → 08:42:55 | `working` throughout, then `done` |
| 90 s, `MCP_TOOL_TIMEOUT=60000` | failed: `MCP server "wait" tool "wait_seconds" timed out after 60s` | 08:40:31 → — → 08:41:39 | `working`, `done` |

- **Moving to the background.** Claude said so and ended its turn: "The wait call is still running. After 120 seconds it was moved to the background as task kmdgwxu0z, so it should finish about 510 seconds from now. I don't have its return value yet and won't report one until it arrives." The reply ended "done 9:39 AM · 1 MCP task still running", and the status line showed "auto mode on · 1 MCP task".
- **The result arriving.** Claude started a turn by itself: "⏺ MCP task kumil4ffw (wait/wait_seconds) completed.", then "⏺ The wait tool returned exactly: waited 330s".
- **Using the session during a background call.** In the 330 s session, "While that runs: what is 17 times 23?" got the reply "17 × 23 = 391. That's 340 (17 × 20) plus 51 (17 × 3). The wait task (kumil4ffw) is still running in the background." That was at 08:39:59, and the result still arrived at 08:42:17.
- **After the timeout.** Claude reported the error and did not retry: "I did not retry, since the same call would probably time out again."
- **No failing duration to repeat.** None of the 30, 150, 330 or 630 s calls failed, so the plan's "repeat the shortest failing duration with `MCP_TOOL_TIMEOUT` raised" had nothing to repeat. The 60 s run lowers it instead, to show what a failure looks like (ledger ruling).

**What the MCP docs say** (code.claude.com/docs/en/mcp, read 2026-11-05). This explains the numbers above:

- **Backgrounding:** "An MCP tool call in the main conversation that is still running after two minutes moves to a background task instead of blocking the session." `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` sets the threshold, and `0` turns it off.
- **Wall clock:** `MCP_TOOL_TIMEOUT` (all servers), or a per-server `timeout` field in milliseconds, is "a hard wall-clock limit per tool call, and progress notifications from the server don't extend it". Unset, the default is "about 28 hours".
- **Idle window:** "A tool call to an MCP server that sends no response and no progress notification for the idle window aborts with an error instead of waiting for the wall-clock limit." The window is 30 minutes for stdio servers and five minutes for HTTP, SSE and WebSocket servers. `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes it, and `0` turns it off. A per-server `timeout` of at least 1000 also sets a floor: "Claude Code never aborts that server's tool calls for idleness sooner than the per-server `timeout`."
- **Stopping a call:** "Pressing `Esc` doesn't stop a background task." To stop one, "select it in `/tasks` and press `x`, or ask Claude to. Claude Code stops following the task and asks the server to cancel it, though the server may still finish it."

**Not tested:**

- A wait longer than the 30-minute idle window.
- Stopping a background task.
- Whether the server is told when Esc interrupts a foreground call (the spike ignores cancellation).
- The per-server `timeout` field on a stdio server.

**Answer:** a waiting MCP call works for the merge turn.

- **Limits:** with the defaults, nothing up to 630 s failed. The limits that can bite are the idle window (30 min for stdio, 5 min for HTTP) and, much later, the 28-hour wall clock.
- **After two minutes:** the call moves to the background. The turn ends and the owner can use the session. When the call returns, Claude Code wakes the session, and it carries on with the result by itself.
- **A hook-delivered grant would be worse.** Hooks fire on the session's own events: a prompt, a tool call, the end of a turn, a notification. They don't fire when something outside the session happens, such as the app granting a turn. An idle session waiting for its turn would not see the grant until something started a turn in it, for example the owner typing. Spec §8 says the same of the branch-moved notices. (This comes from the hook events Claude Code has; it wasn't tested here.)

**For plan 2:**

- **Returning:** `request_merge_turn` returns when the turn is granted.
- **A long queue and the idle window.** Two measures cover it; plan 2 checks both, since neither was tested here:
  - The app's own `--mcp-config` entry sets a per-server `timeout`, for example 24 hours. That also sets the floor for the idle check.
  - The server sends progress notifications (the queue position) while the call waits.
- **Lanes:** while the call waits in the background, OSC 7501 says `done`. The lane must come from the app's own record of who is queued (Ready to merge), not from OSC.
- **Leaving the queue:** a queued call ends early when the session's process ends or the task is stopped in `/tasks`. The app then drops it from the queue. If the call was already gone when the grant went out, the app hands the turn to the next session.
- **Foreground calls:** the foreground setting (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`) isn't needed.

## Consequences for plan 2

1. **Launch form.** Launch from the main checkout with `claude -w <slug> -n <name> --session-id <uuid> --settings <app hooks file> --mcp-config <app MCP config>`.
   - The review gate loads in place (§11.1), and the worktree exists before the first prompt.
   - Claude offers ExitWorktree.
   - EnterWorktree behaves the same and stays the fallback.
2. **Permission mode.** Damela's `bypassPermissions` is ignored (§11.1). Sessions run in the owner's user-level `auto` mode and will show `blocked · permission`. No-questions mode (spec §7.2) is a prompt instruction (skip clarifying questions, merge without the menu), not a permission mode. If plan 2 also wants sessions without permission prompts, that has to come from `--permission-mode` at launch or from the owner's user settings. Neither was tested here.
3. **Hooks.** The app's hooks, passed with `--settings`, run alongside the owner's and Damela's hooks. They don't appear in `/hooks`, so the app lists them itself (§11.2).
4. **Resume.** Always run from the main checkout (§11.4).
   - **The worktree branch still exists:** use `claude --worktree <name> --resume <id>`. This re-creates the worktree if its directory was removed.
   - **The session was merged** (worktree and branch gone): use `claude --resume <id>`. It loads and continues in the main checkout.
   - **Build the resume command in the app.** Don't copy it from Claude's exit text: after EnterWorktree and then ExitWorktree, that text names a worktree that no longer exists.
   - **A session killed inside its worktree** (for example by an app quit): plain `claude --resume <id>` from the main checkout went back to the worktree (§11.4 row d). The quit left the worktree locked, and the resumed session's `/exit` → Remove still removed it.
5. **Merging in step 1 (no turn yet).** All of it happens in the same session (§11.5, §11.7):
   1. ExitWorktree with keep.
   2. Squash-merge and commit in the main checkout.
   3. `git worktree remove`.
   4. `git branch -D`.

   From inside the worktree, Claude Code refuses `git -C <main>`. Its message tells the session to run the command from the worktree; it doesn't mention ExitWorktree. Plan 2 should check one real Damela merge from start to finish. `/exit` asks keep or remove only while the session is still in its worktree; after the merge it asks nothing.
6. **The merge turn in step 2.** Use a waiting `request_merge_turn` MCP call, not a hook-delivered grant (§11.6).
   - A per-server `timeout` and progress notifications keep it inside the idle window.
   - Ready to merge comes from the app's queue, not from OSC.
7. **OSC 7501 → lanes (spec §7.3, from §11.3).**

   | OSC 7501 | Lane | Notes |
   |---|---|---|
   | `blocked` (`kind=permission` or `kind=question`) | Needs you | `msg` is the card's line |
   | `working` | Working | `msg` is the activity, when there is one (MCP calls have none) |
   | `done`, `idle` | Needs you | the turn ended, or the owner pressed Esc. Exception: a session the app knows is waiting for the merge turn goes to Ready to merge |
   | `clear` | — | the session ended |

   Reports carry no `id`, so there is one status per terminal, and each report replaces the whole status.
8. **Open decision: where new worktrees start.**
   - **The finding.** Worktrees from `-w` (§11.4, twice) and from EnterWorktree (§11.5 form 2) all branched from `origin/stage` (`fbe4c68`), while local `stage` was ahead (at `3639575`; at `4aedd91` for form 2). Claude Code's default `worktree.baseRef` is `"fresh"`: "branch from the repository's default branch on the remote" (worktrees doc), fetched if the last fetch is more than 24 hours old.
   - **The consequence.** A merge into local `stage` that isn't pushed is missing from every session started after it.

   Plan 2 picks one of two:
   - **(a) Every merge is followed by a push.** Damela's flow already pushes `stage`. The app checks that `origin/stage` equals `stage`: before the next Start in step 1, and before `release_merge_turn` counts as merged in step 2.
   - **(b) New sessions start from local `stage`.** Put `worktree.baseRef: "head"` ("branch from your current local `HEAD`") in the app's `--settings` file. This changes none of the owner's files, but it depends on the main checkout being on `stage`. It wasn't tested here.

   I recommend (a). It matches spec §8 ("squash-merge into `stage` in the main checkout, push `stage`"), and every session and the remote then agree. (b) is the fallback if pushes lag.
