# Finished tasks, Paused tasks and putting work back (design)

Brainstormed with the owner on 2026-11-13 and 2026-11-16. Mockup of where things live:
`docs/superpowers/mockups/2026-11-13-finished-tasks-placement.html` (option B was picked).

## Intent

Today nothing ever leaves the board. Every task whose session ends lands in **Closed** and stays there, newest first,
with no limit, next to its worktree and branch, which Mainframe never removes. Closed mixes two kinds of task: work that
is merged and done, and work the owner stopped and means to come back to. The list grows with every task.

What the owner said:

- **Merged work is finished.** Once a task's work is merged, the owner does not go back to its card. Its worktree and
  branch can go, and the card can leave the board.
- **History has one job: to pick up where an earlier task left off.** For example, to build more on a feature, from
  the task that made it, with its conversation still there. Otherwise the owner files a new ticket.
- **Unfinished work can be put back on the to-do list**, and the work already done on its branch stays tied to it.
- **Abandoned work can be thrown away (Discard)**, after Mainframe shows what would be lost.
- **The tracker is changed by an agent, not by a Trello API integration**, so it works for any tracker.

Mainframe is for friends' projects too (see `CLAUDE.md`). Nothing here may assume the owner's habits: a `main`
branch, agents that delete their own branch after merging, a tracker, or Trello.

## Goals

1. A task whose work is finished and would lose nothing leaves the board by itself and goes to **Finished**, with its
   worktree and branch removed.
2. A running task whose work is finished says so on its card, and one click (**Finish**) ends it and does the same.
3. The **Closed** lane becomes **Paused** and holds only unfinished work, each card with **Reopen · Put back ·
   Discard**.
4. **Put back** takes a task off the board and back onto the to-do list, keeping its branch. Starting that item again
   continues the same task on that branch.
5. **Discard** removes an abandoned task's worktree and branch after showing what would be lost.
6. The Todo panel gets a **Finished** tab next to **To do**: every finished and discarded task, searchable, each with
   **Continue**.
7. **Continue** brings a finished task back onto the board, in a fresh worktree and branch from today's default
   branch, with its conversation resumed when the agent still has it.

## Non-goals

- Deleting task records. A record is a few lines in `state.json`. Finished tasks keep theirs, and their folder in the
  data folder, so Continue can resume them.
- Reading an old conversation inside Mainframe. Continue resumes it in the agent.
- A setting for an integration branch other than the default one (Damela's `stage`, say). See "Known limits".
- Moving a tracker card on Discard (to "Rejected", say). The owner does that, or asks the manager.
- Changing how a task is started, or the opening prompt's merge rules.

## Anti-goals (a failure even if it works)

- Mainframe deletes work that is not provably safe to delete without the owner first seeing what would be lost.
- A task the owner paused to come back to vanishes into Finished.
- Mainframe ends a running session on its own.
- Anything assumes the default branch is called `main`, that a remote exists, or that a tracker is set up.

## Approaches considered

When does Mainframe notice that a task is finished?

- **A. Mainframe checks, and running tasks wait for the owner's click (picked).** Mainframe checks when a session ends,
  when the project opens, and every few minutes while it is open. A closed task with nothing to lose moves to Finished
  by itself. A running one is never ended for the owner: its card says **Merged**, and **Finish** ends it and cleans up.
  It catches every finished task, and never closes a chat the owner may still be reading.
- **B. Like A, but Mainframe also ends merged sessions once their turn is over.** No clicks at all, but a card can
  leave the board before the owner has read the agent's last message. Rejected for that.
- **C. The agent tells Mainframe** through a Mainframe tool the opening prompt asks it to call after finishing the
  branch. Exact timing, but a task that never calls it (an agent that forgets, a merge done by hand) stays on the
  board. Rejected as the only trigger.

Where finished tasks live (mockup options A, B, C): the owner picked **B**, a Finished tab in the Todo panel, which costs
the board no width when several projects are open side by side. The lane for unfinished work is renamed **Paused**,
since "Stopped" is already the label of a session that ended with an error.

## What a task can be

A task is in one of four places. The record gains an optional field for it, so records kept before this change load
as they are and count as on the board (see "Data").

| Where | Shown in | How it gets there |
|---|---|---|
| **Board** | Needs you, Working or Paused, by its session as today | Start, Reopen, Continue |
| **Put back** | Off the board. Its to-do item offers Continue | Put back |
| **Finished** | Finished tab, "Finished <date>" | The check finds nothing to lose; Finish |
| **Discarded** | Finished tab, "Discarded <date>" | Discard |

A task on the board with no running session is **Paused** (today's Closed).

## The check: "nothing would be lost"

The owner agreed that finished tasks clean up by themselves, and that anything Mainframe can't prove safe stays put.
The test is "nothing would be lost", not "git says merged": the owner's agents often delete the branch themselves
after merging, and then git can no longer show the merge at all.

**The base.** The project's default branch, `origin/HEAD`. With no `origin/HEAD`, the main checkout's current branch,
as a new worktree starts from it today (`addWorktree`). Never a branch name Mainframe assumes.

**Fresh enough.** Before a round of checks, Mainframe fetches the base's branch from `origin` quietly, so that a pull
request merged on GitHub counts. A failed fetch (offline, no remote) is not an error: the check uses what it has.
At most one fetch per project per round.

A task has nothing to lose when all of these hold:

1. **Its conversation began.** Claude: its SessionStart hook recorded a session (`recordedSession` is not null).
   OpenCode: `began`. Without this, a task closed before its agent made the worktree would look finished, as its
   branch is missing too.
2. **Its worktree has nothing uncommitted, and is on the task's branch.** The folder is gone, or `git status` there
   shows no changed or untracked files (ignored files don't count) and its HEAD is the task's branch. A worktree on
   another branch, or on a detached HEAD, is never safe, whatever the task's branch says (builder's call, from the
   plan review: otherwise a renamed branch or a commit on a detached HEAD would look finished). Discard's loss list
   includes that HEAD's commits too.
3. **Its branch has nothing unmerged.** Either:
   - the branch is gone, or
   - the branch has at least one commit of its own, and merging it into the base now would change nothing (the merged
     tree equals the base's tree, so squash and rebase merges count too).

   A branch with no commits of its own does **not** count as finished: that is a task paused before it did anything,
   which the owner may want to come back to.

**When it runs:** for every task on the board or put back, in an open project, when a session exits, when the project opens, and
every few minutes (the builder picks the interval). One round at a time per project.

**What it does:**

- **Paused or put-back task, nothing to lose:** runs the check once more, then removes the worktree (if there) and
  the branch (if there), and moves the task to Finished. The branch is deleted with `git branch -D`: plain `-d` compares
  against the main checkout's branch, not the base, so it refuses squash-merged branches and merges not yet pulled.
  Mainframe's own check is the proof (builder's call, from the review). The worktree is removed without `--force`. If
  git refuses a removal, the task stays where it was and the failure is logged.
- **Running task, nothing to lose:** nothing is removed. The task is marked as merged (kept in memory, not saved), and
  its card shows **Merged** with **Finish** in place of Answer. While its session is Working, the card shows no button,
  as today.
- **Otherwise:** nothing changes.

**Finish** (on a running task marked merged): ends the session as Close does, runs the check again once it has exited,
and on a pass cleans up and moves the task to Finished. On a fail (the agent changed something meanwhile), the task
stays Paused.

## The board

- The lane **Closed** is renamed **Paused**, empty text "No paused tasks", newest first as today. The lane, its
  label and its state label say Paused. The panel's note under a closed task reads "Paused. Reopen continues this chat."
- A Paused card has three buttons: **Reopen** (as today), **Put back**, **Discard**. How three fit on a card is a
  design call for the build (a menu for the last two is fine).
- A task that is put back, finished or discarded is not on the board, in the board's counts, in Cmd/Ctrl-key stepping
  through Needs you, or in the session panel's list.

## Put back

**A note's task** (no card): Mainframe adds the note back to the to-do list with the task's title and description and
a link to the task (`taskId`, see "Data"). The task is marked put back and leaves the board. Its worktree and branch
stay as they are.

**A card's task:** the card must go back to the tracker's to-do list, and only an agent can write to the tracker.
Mainframe uses the task's own agent, which has the connector and knows the card:

1. Mainframe reopens the task with a prompt in place of the usual carry-on prompt: the owner is putting this task
   back on the to-do list for later; move the card back to the to-do list the way the repo's instructions say, or
   else to its board's to-do list or status; then stop. The task shows in Working while it does this.
2. When the turn ends, Mainframe closes the session, then syncs the Todo panel.
3. If the card is on the synced list, the task is marked put back and leaves the board. If it is not (the agent
   couldn't, or the sync failed), the task stays Paused and its card says why, for example "Put back: the card is not
   on the to-do list". The owner can try again or move the card by hand.

If the turn ends in a question or an error, the task stays on the board in Needs you, like any task.

**Continuing put-back work.** A to-do item whose task was put back offers **Continue** where it would offer Start (in
the list and in its ticket). Continue reopens that task on its own branch and worktree, with its conversation, and it
returns to the board. A note leaves the list when its task continues, as a started note does today. A card's row already
maps to its task "for good" (`todoItems`): only the label changes, from Reopen to Continue. The manager's `start_task`
on a put-back card continues its task the same way, instead of refusing.

**A put-back task never goes missing** (builder's call, from the review). It is visible only through its to-do item, so
when that item goes, the task returns to Paused on the board:
- deleting a note that has a `taskId` sends its task back to Paused (the delete button says so);
- a sync whose list no longer has the card of a put-back task sends that task back to Paused.

## Discard

On a Paused task. A dialog first lists what would be lost:

- uncommitted and untracked files in the worktree,
- commits on the branch that are on neither the base nor any remote branch.

With nothing to list, it says so. On confirm, Mainframe removes the worktree and deletes the branch, forced (the owner
has seen the list), and moves the task to Discarded. A card's tracker card is not touched (Non-goals). The task's
record and conversation are kept, so Continue still works from the Finished tab.

## A card whose task is finished or discarded

A card can still be on the to-do list after its task finished or was discarded: Discard leaves the card alone, and the
owner may move a card back for more work. The owner decided (2026-11-16):

- **Discarded: Start.** A discarded attempt is given up, so the card starts a fresh task. The rule "a card has one
  task for good" (`TaskService.start`, `todoItems`) stops counting discarded tasks: a card can have any number of
  discarded tasks and at most one other. The discarded ones stay in the Finished tab, with Continue.
- **Finished: Continue.** The row offers Continue, which continues the finished task as from the Finished tab.

The manager's `start_task` on such a card does the same: it starts a fresh task for a card whose task was discarded,
and continues a finished one.

## The Finished tab

The Todo panel's header gets two tabs, **To do** and **Finished**, with Finished's count. Quick Add and Sync belong to
To do. (Today the header holds one heading, "Todo", whose comment already expects more tabs.)

Finished lists the project's finished and discarded tasks, newest first, with a search box that filters on title and
card number. Each row shows the card number (if any), the title, "Finished 11 Nov" or "Discarded 11 Nov" (or "· no card"),
and **Continue**. Clicking a row does nothing else in this version.

It works the same with no tracker set up: a friend with only notes still gets a Finished tab.

## Continue

On a finished or discarded task (Finished tab), or a put-back one (its to-do item).

- **Finished and discarded tasks** have no branch any more. Continue makes a fresh worktree on the task's branch name,
  from today's base, which has the merged work in it. Claude Code: always pass `--worktree <slug>` on the resume. Claude
  Code's docs (read 2026-11-16) say it then creates the branch from the remote's default branch when it is missing, and
  resets an existing worktree only when it is clean and has no commits of its own or its merged remote branch is
  deleted, so unmerged work is never reset. OpenCode: `addWorktree` with `create: true`. This fixes today's Reopen
  for a task whose branch is gone, which runs the session in the main checkout.
- **The conversation** is resumed when the agent still has it. Mainframe sends one short prompt with the resume, so
  the agent knows where it is: it now runs in a fresh worktree on that branch, from the default branch, which has its
  earlier work merged in; wait for the owner. **Claude Code deletes chats older than 30 days by default**
  (`cleanupPeriodDays`). When the chat is gone, Continue starts a new conversation with the task's opening prompt,
  plus a line saying it continues the earlier task of the same name.
- The task returns to the board, selected, as Reopen does today. When its work is merged again, the check moves it to
  Finished again.

## Data

`TaskRecord` (in `state.json`) gains optional fields, so older records still load as they are and `VERSION` stays 1:

- `place?: 'putBack' | 'finished' | 'discarded'`. Missing means on the board.
- `endedAt?: number`. When it was finished or discarded, for the Finished tab's date and order.

`TaskView` carries `place` and `endedAt`, and `list()` keeps returning every task: the renderer needs finished ones for
the Finished tab and for matching cards to tasks. The board filters to tasks on the board.

`TodoNote` (in `todo.json`) gains `taskId?: string`: a note put back from a task. Start on such a note reopens that task
instead of starting a new one.

The "merged" mark on a running task lives in memory in `TaskService`, sent with the view, and is worked out again by
the next round.

The manager's `list_sessions` reports each task's place and `endedAt`, so it can answer "what finished today?".

## Constraints

- **Every project, side by side.** The check, its timer and its fetch belong to each project's `TaskService`. Nothing is
  global. Closing a project stops its timer, and Quit stops them all before sessions end.
- **No owner tooling in prompts.** The put-back and Continue prompts defer to "the repo's instructions" in the agent's
  words (the `Instructions` each adapter has), as the opening prompt does.
- **Git safety.** Mainframe's git calls keep `--no-optional-locks`. Nothing is deleted without proof: the check, run
  again just before the removal, or the owner's confirm on Discard's loss list. Only Discard forces a worktree removal.
- **Windows.** Worktree removal and folder checks must work on Windows paths (CI covers it).

## Known limits

- **An integration branch other than the default one.** A project that merges into `stage` and releases to `main`
  later: if the agent keeps its branch after merging into `stage`, the check sees it as unmerged until the release.
  The owner's projects are covered because their agents delete the branch after merging. A per-project setting can
  come later if a friend needs it.
- **Old chats.** Continue on a task older than Claude Code's retention starts a new chat (above).
- **A task ended with `/exit` before it did anything.** Claude Code may offer to remove its clean worktree, and that
  deletes its branch. The check then sees the branch gone and moves the task to Finished, though it did nothing.
  Continue brings it back, so this is accepted.

## Left to the builder

- The check's interval, and how its rounds are spaced across several open projects.
- The exact git commands for the merge test (`git merge-tree --write-tree` needs git 2.38 or later; say so in the
  status check or fall back) and for the loss list.
- How three buttons fit on a Paused card, and the Finished tab's look (with `frontend-design`).
- The wording of the put-back and Continue prompts, within the rules above.
- Whether the Finished tab shows more than 100 rows at once.
