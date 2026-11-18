# A Done lane, and a manager that can close sessions: design

2026-11-17. A small change. It builds on [the finished-tasks design](2026-11-16-mainframe-finished-tasks-design.md) and
changes one thing in it: where a running, merged task's card sits.

## Why

Needs you fills up with cards that need nothing from the owner. Two things cause it:

- A running task whose branch is merged and clean says **Merged** and offers **Finish**, but its card stays in Needs
  you, counted in the badge and visited by the "next that needs you" jump.
- The other "Finished its turn" cards can only be cleared by the owner, one Close session click at a time. The manager
  can list the sessions but cannot close one.

"Finished its turn" alone cannot move a card: an agent reports it at the end of every turn, also when it waits for the
owner to test, or ended on a question. Those cards stay in Needs you.

## Goals

1. A running task that Mainframe has proved finished (the round's "nothing to lose" proof) leaves Needs you by itself,
   for a **Done** lane.
2. The owner can ask the manager to close sessions, one or a whole list, with the same effect as their own **Close
   session** button.

## Non-goals

- Telling a finished task from a waiting one by anything but the existing proof. No reading of the agent's last message.
- A manager tool that discards, puts back, or deletes anything.
- Waking the manager when a task finishes. It acts when the owner talks to it.

## Anti-goals (a failure even if it works)

- Mainframe ends a running session on its own. Still true: a Done card keeps its session until the owner, or the manager
  on the owner's ask, ends it.
- The manager cuts off a session in the middle of its work, because the list it read was a moment old.
- A card that does need the owner (a question, a permission prompt, an error) sits in Done.

## Approaches considered

Where do the proved-finished cards go?

- **A. A Done lane that shows only while it holds a card (picked by the owner).** The card moves there by itself and
  keeps its session, so the last message can still be read. It is the last lane, so the others don't shift when it
  appears, and it takes no width while empty.
- **B. A Done lane that is always there.** More predictable, but about 230 px of every board all the time; with two
  projects side by side the lanes scroll sideways sooner.
- **C. No lane: Mainframe ends merged sessions itself.** No clicks, but it reverses the 2026-11-16 decision that
  Mainframe never ends a running session, made because a card could leave before the owner read the agent's last
  message.

## The Done lane

- **Which cards.** Exactly the ones that show **Merged** and **Finish** today: a running task the round marked merged,
  not being put back, whose turn is over (its state is `done`, or `idle` after it started). Everything else is where it
  is today. *(The owner's decision.)*
- **It moves both ways.** A Done task that starts working again goes to Working. One the round stops finding merged
  goes back to Needs you.
- **The card** is the one the owner knows: the **Merged** label and **Finish**. Finish does what it does today.
- **The lane** is named **Done**, comes after Paused, and is drawn only while it has a card. The three other lanes are
  always drawn, as today. *(My call: last, so its appearing moves nothing.)*
- **What skips it.** The Needs you count, the project rail's badge and the "next that needs you" jump read the Needs you
  lane, so they no longer include these cards.
- **When it moves.** The merged mark is set by the check round, which runs every three minutes, at each session's exit
  and at start. A task that merges and then ends its turn would sit in Needs you for up to three minutes. So the round
  also runs when a task session reports `done`. *(My call. It costs one fetch of the base per finished turn; rounds
  already queue behind each other. The card still passes through Needs you for the moment the check takes.)*

## The manager's tool

`close_session`, with a `taskId` from `list_sessions`.

- **What it does.** What the owner's Close session button does, through the same `TaskService.close`: it ends the
  session and deletes nothing. The task goes to Paused, or to Finished when the round its exit starts proves it has
  nothing to lose. Reopen and Continue bring it back, as today.
- **What it refuses**, each with a sentence the manager can pass on. *(My calls.)*
  - A task id this project doesn't have. Another open project's task is unknown here.
  - A task with no running session: it says where the task is instead (paused, put back, finished, discarded).
  - A session whose turn is not over: `working`, `blocked`, still starting, or being put back. The check is made when the
    tool runs, not from the list the manager read. The owner's own button is not changed and still closes anything.
- **What it returns.** The task's title, its last reported message, and whether Mainframe had it marked merged, so the
  manager can tell the owner what it closed and where each one went.
- **`list_sessions` gains `merged`** (true or false) for each session, so "close the done ones" needs no guessing.
- **No permission prompt**, for either agent: it joins `list_sessions` and `sync_todo` in Claude's allow list and gets
  `allow` in OpenCode's rules. *(My call: it is undone with Reopen, loses nothing, and a prompt per card would defeat
  "go through the list".)* Its description says it is used only when the owner asks, as `start_task`'s does.
- **The role prompt's** one sentence about the tools mentions closing. A resumed manager keeps its older prompt, so how
  the tool is used lives in the tool's description, as for the others.

## Checks

- Unit: the lane table and `laneOrder` (Done membership, both ways out, the count and the jump); the tool (each
  refusal, the result, the `merged` field); the round on `done`; both agents' rules.
- e2e: a merged running task's card moves to Done and the lane appears; Finish there sends it to the Finished tab and
  the lane goes; the manager's `close_session` closes a finished-its-turn session and refuses a working one. No e2e
  presses Finish today.
- The two standing questions: nothing here names a project, a branch or a plugin; and each project's manager closes
  only its own project's sessions, with a Done lane per project's board.

## Left to the builder

- The order of cards within Done.
- The exact wording of the tool's description, its refusals and the role prompt's sentence.
- Whether the user-facing docs (README) describe the lanes or the manager's tools, and if so, updating them; and a line
  in the finished-tasks design pointing here.
