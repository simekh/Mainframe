# Acceptance: plan 2b part 1, the manager

The owner ran Mainframe with real Claude Code (v2.1.319) in Damela on 2026-11-07, on their real data folder, on branch `manager`. Logged with `MAINFRAME_LOG_OSC=1`.

The owner decides Pass or Fail.

## First pass (build 92b0f60)

| # | Check | Seen | Pass / fail | Note |
|---|---|---|---|---|
| 1 | The manager starts with the app | It exited at launch, and the column showed the stopped note and Restart | Fail | Fix 1 below. |

## Second pass (build 81cddb0)

The manager started a new chat in the first form (`-n damela-manager --session-id …`). The open task `cd405a4d` resumed its own chat.

| # | Check | Seen | Pass / fail | Note |
|---|---|---|---|---|
| 1 | The manager starts with the app; asked what it can do, it names listing and starting sessions | It works | Pass | Owner, 2026-11-07 |
| 2 | "What's running?" calls `list_sessions` with no permission prompt | It works | Pass | No approval prompt for the `--mcp-config` server at launch either (D2's open question). |
| 3a | A task the manager starts shows on the board, unselected | "List TODO comments" appeared, and the session panel stayed hidden with nothing selected | Pass | Run by Claude at the owner's request, through the same `start_task` call the manager makes, with the manager's token. The card went to Needs you, not Working: its first step asked to approve `git -C …` under the owner's `auto` mode. |
| 3b | Typing stays in the manager | The manager's terminal kept the focus after the start | Pass | Seen in a window capture. Also pinned by the e2e test. |
| 3c | The task's opening prompt carries the brief | The launch's prompt holds the brief word for word under `Task: List TODO comments` | Pass | Read from the process arguments. |
| 3d | A start-check warning reaches the manager | Not reached: `stage` is level with `origin/stage`, so no warning was due, and none came | Not reached | Pinned by the unit tests (`managerTools.test.ts`). |
| 5 | `/clear` in the manager, then restart the app: the cleared chat continues | `/clear` cleared the chat "just like regular iTerm claude". The chat at launch was `0aa42e22`, the `/clear` made `eb82948e`, and the next app start resumed `eb82948e` | Pass | Ids from the launch arguments and `session-start.json`. |
| 6 | Exit, then Restart: the same chat continues | The owner typed `quit`, which is Claude Code's exit command, while the manager was working. Claude reported `clear` and exited, and the column showed Restart. Restart resumed `eb82948e`, with no carry-on prompt | Pass | `quit` ends Claude Code as `/exit` does. No carry-on prompt, because an exit the owner chose clears the turn, as for tasks. |
| 4a | Quit with the manager mid-turn, start again: it carries on | The quit recorded `midTurn: true`. The relaunch was `--resume eb82948e…` ending with `Continue where you left off.`, and the manager went back to `working` | Pass | Built on a5e878f. The manager was summarising CLAUDE.md (its status message read "Reading CLAUDE…"). |
| 4b | Quit with the manager idle, start again: it waits | The relaunch was `--resume cc2ab37d…` with nothing after the role prompt, and the manager reported `idle` | Pass | `cc2ab37d` came from a second `/clear` with a message after it, so this also confirms row 5 again. |
| 7 | Feel: typing, paste and scrolling in the manager compared with iTerm2; dragging the column, including near the top bar; the board's room on the laptop screen with the session panel pinned | "All looks good to me!" | Pass | Owner, 2026-11-07. The default widths stay as they are (board about 344 px at 1400 px). |
| 8 | The manager shows as `damela-manager` in `claude --resume` | The picker in Damela lists the manager's chats as `damela-manager`, including chats made by `/clear` | Pass | Read by Claude from the picker's first screen. The resume form carries no `-n`, but the name carries over to resumed and cleared chats. |
| 9 | The window buttons' padding in the manager column's top strip | "All looks good to me!" | Pass | Owner, 2026-11-07. `trafficLightPosition` stays unset. |
| 10 | Copy and behaviour the reviews left to the owner: a stopped manager's header reads "Closed"; an unpinned session panel hides on a click on the board but not in the manager column | "All looks good to me!" | Pass | Owner, 2026-11-07. Both stay. |

## Left open

- If Claude Code's transcript cleanup deletes a manager chat whose last start was a resume (which takes 30 or more days without using the manager), `--resume` fails until the record changes, as it did before fix 1.
- A task whose `claude` quits after SessionStart but before its opening prompt is submitted still gets `No conversation found` at Reopen, as before this branch. The owner chose to keep tasks off Claude Code's chat files.

## Fixes

### Fix 1: never resume a conversation Claude Code never saved

- **Cause:** an earlier manager launch (09:03) recorded its id through the SessionStart hook, which fires before any message. Nobody typed to it, so Claude Code never wrote its transcript. At the next start Mainframe ran `claude --resume <that id>`, which prints `No conversation found with session ID: …` and exits. Restart repeated it, because the recorded id never changes. A `/clear` followed by a quit before the next message sets the same trap.
- **Ruled out first:** the space in `Application Support` in the `--mcp-config` path. A config at a spaced path loads fine.
- **Fix (final form, a5e878f):** only the manager checks, and only when the recorded SessionStart's `source` is `startup` or `clear`. Those are the only cases that can leave a chat unsaved. In those cases it resumes only if `<id>.jsonl` exists in one of the folders under Claude Code's projects folder (the parent of the folder `transcript_path` names). Otherwise it starts a new chat. Any other source resumes without looking. Tasks resume whatever SessionStart recorded, as in plan 2a.
- **Why only the manager (owner's decision, after a side agent's note):** that layout of Claude Code's chat files isn't documented. If an update changed it, a task check would silently restart every open task with its opening prompt, in a worktree that already has work. For the manager, the worst case is an empty new chat. Tasks launch with a prompt, so they rarely have an unsaved chat. Commits 73d7b80 and 81cddb0 held the earlier versions.
- **Why not `transcript_path` itself:** the first version checked only that path, and its review asked whether the path is right for worktree sessions. It isn't always. A real task, `cd405a4d`, was resumed from the main checkout because its worktree branch is gone. Its hook named a transcript under the main checkout's project folder, but the chat lives under the worktree's folder, and `claude --resume` found it there. With the first version, that task would have restarted from scratch at the next start.
