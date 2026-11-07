# Mainframe plan 2b: the manager and the Todo panel

Design, 2026-11-06. Written after a brainstorm with the owner, following plan 2a and its acceptance run. It changes parts of the main spec, `docs/superpowers/specs/2026-11-04-mainframe-agent-manager-design.md` (called "the spec" below); §8 lists exactly which parts. Decisions the owner made are stated plainly or marked **(owner)**. Decisions the designer made on the owner's behalf are marked **(designer's call)**; the owner may overturn them.

Approved mockups:
- `docs/superpowers/mockups/2026-11-06-plan-2b-manager-layout.html`: the manager column, and the Todo panel hidden, floating and pinned.
- `docs/superpowers/mockups/2026-11-06-plan-2b-todo-and-ticket.html`: the Todo panel with the ticket panel attached.

Their cards are made up. The look is the app's current one (`src/renderer/src/app.css`).

## 1. Why

Today the owner starts a Damela card by asking a Claude session to open it through the Trello connector (MCP). The spec planned a different route: Mainframe reading Trello's REST API itself, with an API key in the Keychain, and the manager arriving only in step 3. The owner wants the opposite. **Claude Code finds the to-do list and fills the Todo panel, using whatever connector the owner has.** For Damela that is Trello. With no connector at all, the owner keeps notes in the Todo panel instead. Mainframe never talks to the to-do source itself.
- **The manager** is the agent the owner talks to about Trello and about the work.
- **Sync** is a background Claude Code run that Mainframe starts when the owner presses the button (§5.3). It was first designed to go through the manager's chat. The owner moved it to the background after review, because the manager is often busy with other work.

So this plan brings the manager forward and builds the Todo list beside it. Step 1 of the spec is done when this plan is.

## 2. Goals, non-goals, anti-goals

**Goals**
- A manager session in its own column on the left of the window: an ordinary Claude Code session for talking to Trello, for general work when there is no task yet, and for questions about the work in progress.
- The manager can start task sessions (the owner's "sub agents") when the owner asks. They land on the board like any other task.
- A Todo panel holding the to-do list in a tab, filled when the owner presses Sync, plus local notes.
- Clicking a card opens the full ticket in a panel attached to the Todo panel, with Start.
- A session started from a card reads the live card first, then moves it to In Progress.

**Non-goals (this plan)**
- Mainframe talking to Trello or any to-do service itself. A direct integration may come later, to make syncing cheaper **(owner)**.
- Syncing on a timer or at app start **(owner: a manual Sync button for now, because every sync costs a Claude run)**.
- Start next card (§7).
- The manager passing messages to sessions, reading their screens, or anything about merging. These stay in spec steps 2 and 3.
- More tabs in the Todo panel. The panel has a tab strip so they can join later **(owner)**.

**Anti-goals**
- The spec's anti-goals stand. In particular, the manager is a real Claude Code session, never an agent loop or chat view of Mainframe's own (spec §2).
- The manager starting sessions the owner didn't ask for **(designer's call)**.

## 3. The window

Left to right: **[Todo panel, when pinned] [manager column] [board] [session panel]** **(owner)**.

- **Manager column.** It sits at the left edge, full height, with a width the owner drags. Its header reads "Manager" with the project name and a status glyph. Below the header is the manager's real terminal, with the same terminal handling as task sessions (keys, paste, links, colours, the suggestion scan).
  - It is always shown in this plan. Hiding it is left for later **(designer's call)**.
  - It is not a task. It never appears on the board or in Needs you, and Ctrl+Tab skips it **(designer's call)**.
- **Todo panel.** It uses the same shell as the session panel (`SidePanel`): full height, a drag edge, and a pin, mirrored for the left edge.
  - Unpinned, it slides out over the manager column and hides when the owner clicks elsewhere **(owner)**.
  - Pinned, it takes the far left and pushes the manager column to the right **(owner)**.
  - It opens from a Todo button in the top bar and from a handle on the window's left edge. Its width and pin state are remembered like the session panel's **(designer's call)**.
- **The board** keeps Needs you, Working and Closed. There is no TODO lane: the Todo list lives in the panel **(owner)**.
- **Session panel.** It works as today. Its header gains a link to the task's card, when it has one (the spec's plan 2b item). With nothing selected it keeps its current empty state. The spec's "manager in the right panel" is replaced by the manager column.
- The owner accepted the cost that with the Todo panel, the manager and the session panel all pinned, the board is narrow on a laptop screen.

## 4. The manager

### 4.1 The session

- An ordinary interactive `claude` process, with the owner's user settings, connectors (including Trello), skills and permission mode. It runs in the project's main checkout, so it reads the repo's CLAUDE.md. It has no `-w`: the manager has no worktree of its own.
- It follows the repo's CLAUDE.md like any session, so it may change code **(owner)**. This replaces the spec §7.6 line "It doesn't change files". For Damela, CLAUDE.md's own rule (work happens in worktrees, the main checkout stays clean on `stage`) governs this, not Mainframe.
- It gets an appended system prompt describing its role:
  - It is Mainframe's manager for this project.
  - It can list the sessions, start task sessions and start a Sync with Mainframe's tools (§4.2).
  - It starts sessions only when the owner asks.
  - It may make small changes itself, but work that needs a branch becomes a task, so it shows on the board. A change the manager makes itself has no card, no changed-files list and, later, no place in the merge turn **(designer's call, following the owner's "mainly it would fire off sub agents")**.
- **Starting fresh:** the manager's chat carries on across restarts, so it keeps growing. `/clear` in its terminal starts a new chat. The SessionStart hook records the new id, so Restart and app restarts continue the cleared chat. Nothing extra is built for this.
- It gets Mainframe's hooks file (the SessionStart hook that records the current session id, as for tasks) and Mainframe's MCP config (§4.2).
- **Lifetime** **(designer's call)**:
  - The manager starts when the app starts.
  - It continues the same chat after a restart: `--resume` with the recorded id, under the same carry-on rules as tasks (spec §7.4), so a manager stopped mid-turn carries on.
  - If its process ends, the column shows the exit and a Restart button, which resumes the chat.
  - There is no Close for the manager.
- Launch form, to verify against the current CLI reference while planning:
  - First run: `claude -n <project>-manager --session-id <uuid> --settings <hooks> --mcp-config <mainframe mcp> --append-system-prompt <role>` in the main checkout.
  - Afterwards: the same with `--resume <id>` in place of `--session-id`.
  - As plan 2a noted, `--mcp-config` takes several values, so no prompt may come right after it.

### 4.2 Mainframe's tools for the manager

Mainframe runs an MCP server and passes it to the manager with `--mcp-config` (spec §2 and §6.7). How it is exposed is the builder's call (spec §12), within two limits:
- Only sessions Mainframe starts can reach it, for example through a token in the config.
- It is never written into the owner's or a repo's settings.

The MCP config goes to the manager and to the background sync run (§5.3), each with only its own tools. Task sessions launch as today **(designer's call)**. The merge-turn tools join in step 2.

**Mainframe's tools run without a permission prompt (owner).** The owner's user-level mode is `auto`, which still asks before some actions (step 1 findings §11.1), and "don't ask again" would write the rule into the repo's `settings.local.json`. So each per-launch `--settings` file allows Mainframe's tools; the exact rule syntax is to be verified against the current settings docs. This means only the role prompt keeps the manager from starting sessions the owner didn't ask for. The owner accepted that: an unwanted session shows in the manager's chat and on the board, and Close stops it.

**Changed 2026-11-07 (owner):** only the tools that read run without a prompt. Starting a task goes through the owner's permission mode (a prompt in the manager's terminal, or auto mode's classifier), so it is no longer the role prompt alone.

The manager's tools, with names and exact shapes left to the builder:
- **Sync the Todo list.** Starts the same background sync as the panel's Sync button, so "sync my list" still works when said to the manager. It returns when the sync ends, with the card count or the error.
- **List sessions.** Returns every task: id, title, card (number and URL, if any), lane and state as the board shows them, branch, worktree path, Claude session id, and start and close times. With that, the manager answers "what is #124 doing?" by reading the worktree and its git history itself.
- **Start a task.** Takes a title, a brief, optionally a synced card's id, and the no-questions flag.
  - With a card id, it starts as Start on that card does (§6), and the brief joins the opening prompt below the card as what the owner added. The task record keeps the brief, so a Reopen that has to rebuild the opening prompt includes it **(designer's call: it is the only way "start #131, web only" reaches the session in this plan)**.
  - Without one, it starts like New task, with the brief as the description.
  - It returns the new task's id. It runs the same start check as New task (main checkout ahead of `origin/HEAD`) and reports the warning back to the manager rather than blocking.
  - It refuses a card whose task is open, and says which task has it. This applies to every start path, including the panel's, so a card can't get two sessions at once **(designer's call)**.
  - A task the manager starts appears under Working but isn't selected, so the session panel and the focus stay where the owner was typing **(designer's call)**.

## 5. The Todo panel

### 5.1 The list

- **Header** **(designer's call)**:
  - The tab strip, with one tab, Todo.
  - Under it, a line naming the source ("Trello · Damela · TODO") and when it was last synced ("12 min ago"), and the Sync button.
  - Before the first sync, the line reads "Not synced yet".
- **Cards** keep the source's order. Each shows the number, the title, two lines of the description, the labels, and Start **(owner: title, a short truncated body, Start)**.
- **Cards labelled "You"** are greyed out and have no Start (spec §3).
- Label names are matched case-insensitively. "You" and "Blocker" are the only names Mainframe gives meaning to (spec §7.1).
- **A card whose task is open** (matched on the card id) is not shown, even if a sync returns it again because its session hasn't moved it yet. **A card whose task is closed** is shown with Reopen in place of Start. Reopen continues that task's session, so moving a card back to TODO never strands it **(designer's call)**.
- The synced list and its source are kept across restarts **(designer's call)**.

### 5.2 Notes

- "+ Add note" adds a note: a title and some text. Notes live only in Mainframe, per project, and are never sent anywhere **(owner)**.
- Notes show in the same list below the synced cards, marked "Note". The owner can edit or delete a note **(designer's call)**.
- Start on a note works like New task with its title and text. The note leaves the list once its task exists, and the task keeps the title and text **(designer's call)**.

### 5.3 Sync

**Sync is a background Claude Code run (owner).** Pressing Sync, or asking the manager to sync, makes Mainframe start a one-off non-interactive `claude` run. It never touches the manager's chat or any terminal.
- **Why (owner, after review):**
  - Going through the manager meant Sync waited whenever the manager was busy with other work, and its request could join a half-typed message of the owner's.
  - Handing the list over means writing every card out again. That is slow, and in the manager's chat the list would have landed twice per Sync.
- **The run:**
  - It uses a fast model and the owner's connectors: the same MCP servers the owner's sessions in this project see.
  - It also gets Mainframe's MCP server with one tool, **Set the Todo list**. That tool takes:
    - the source: a kind such as "Trello", plus the board and list it read, as names and a URL;
    - the cards in the source's order: id, short number, title, description, labels, checklists with their items' done state, and URL.
  - Set the Todo list replaces the synced cards, never the notes, and records the source and the sync time.
- **The run's prompt:**
  - Read the named list with the to-do connector, or on the first sync find the owner's to-do list.
  - Copy each card's text word for word.
  - Call Set the Todo list.
  - Only read from the to-do source, never change it.
- **The run may call only the to-do source's read tools and Set the Todo list. Every other tool is denied** **(designer's call, after review)**.
  - That covers the shell, file edits, Trello's write tools and every other connector (Google Drive, Notion, Dropbox and so on), including tools the owner's own settings allow.
  - **Why:** no one watches the run, so no one can answer a prompt, and it reads card text that anyone on the board can write.
  - **How Mainframe knows the read tools:** the first sync reads nothing. The run reports which connector holds the to-do list and which of its tools only read, by name (for example `mcp__trello__trelloReadList`). The panel shows those names, and the owner confirms them once. Mainframe keeps them for the project, and later syncs allow exactly those tools.
  - The flags that enforce this are to be verified while planning part 2. Candidates:
    - `--tools ""`, which removes the built-in tools;
    - `--permission-mode dontAsk`, which denies anything not allowed;
    - `--allowedTools` with the confirmed names;
    - a way to keep the owner's own allow rules out of the run, such as `--setting-sources`.
  - **The cost if this isn't enforced:** a card's text could lead the run to change things in the owner's other services.
- **The panel while syncing:**
  - Sync shows "Syncing…", and a second press does nothing while one runs.
  - Success updates the list and the "synced … ago" line.
  - A failure shows the run's last message in the panel header, for example that no to-do connector was found. The list stays as it was.
  - A run that takes too long is stopped, with a limit the builder picks.
- **The first sync:**
  - If exactly one list is clearly the to-do list, the run uses it.
  - If several could be, it passes the candidates back instead of cards. The panel shows them as choices. The owner picks one, and Mainframe remembers it for the project and syncs it **(designer's call)**.
- With no connector, the panel keeps the notes, and the header shows the run's message.

### 5.4 The ticket panel

Clicking a card opens a ticket panel joined to the Todo panel's right edge, as in the mockup **(owner)**. The clicked card reaches into it, so the two read as one piece.

- **Contents:**
  - the number and title;
  - the labels;
  - "Open in Trello ↗", which opens in the browser like terminal links;
  - the full description as plain text with its line breaks;
  - the checklists, read-only;
  - a quiet line saying this is the card as of the last sync, with its time;
  - a footer with Start and "Don't ask me questions" (spec §7.2's no-questions mode).
- It slides over the board and the manager column and never pushes the lanes aside. It is the same with the Todo panel pinned **(designer's call)**.
- It closes with ✕, Esc, a click on the board, or a second click on the open card. Clicking another card swaps the ticket in place **(designer's call)**.
- Notes open in the same panel, with their title and text editable, and Start **(designer's call)**.
- When the start check warns (the main checkout has commits that `origin/HEAD` lacks), the warning shows in the footer and Start becomes "Start anyway", as in New task.
- **Start on a card or note in the list** runs the same check first. If it's clean, the task starts at once. If it warns, the click doesn't start anything: it opens that card's ticket panel with the warning and "Start anyway" **(designer's call: it keeps the owner's 2026-11-05 rule, spec §7.2, that the app warns before a Start)**.
- A "You" card opens in the ticket panel like any card, with no Start.

## 6. Starting from a card

Start, on a card or in the ticket panel, starts the session directly from the card Mainframe already has. It needs no manager turn, so it is instant **(designer's call; the spec has Mainframe do the mechanical work)**.

- The launch is plan 2a's start form, unchanged.
- The slug comes from the card's title, as today.
- **The task record gains the card**, all optional so older records still read:
  - source kind, card id, number, URL and labels;
  - the card's position in the list when it started.
- **Opening prompt.** It is plan 2a's prompt with the card in place of the plain title and description:
  - the card's number, title, labels and URL;
  - an instruction to read the live card with the to-do connector before planning, and to ask the owner if it can't;
  - an instruction to move the card to the "in progress" list of its board. For Trello, that list is named "In Progress" today.
  - the manager's brief, when the manager started it (§4.2);
  - then the worktree note and, if ticked, the no-questions text, as today.

  The synced description and checklists are left out **(designer's call)**. The session reads the real, current card, as the owner's sessions do in iTerm2 today. A copy could be hours old, or shortened by the sync. The worker, not Mainframe, moves the card, because Mainframe doesn't know list names.
- Start closes the ticket panel. The card leaves the list and appears under Working, selected, with its session in the right panel.

## 7. Smaller decisions

- **Needs you order:** cards labelled Blocker first, then by the card's position when it started, then tasks without a card by start time **(spec §7.1, extended by designer's call)**. Working and Closed keep their current order.
- **Start next card is dropped for now.** Start on the top card is one click, and the manager can be asked **(designer's call)**.
- **New task stays** in the top bar for starting something right away. A note is for later **(designer's call)**.
- **The "ready: asks to merge" card line waits for step 2** **(designer's call)**. Damela's merge menu (`superpowers:finishing-a-development-branch`) asks in plain text ("Which option?"), so OSC 7501 reports a plain turn end and the card reads "Finished its turn". Only a new Stop hook could tell the difference, and that belongs with the merge turn. This closes plan 2a's open check 8.2.

## 8. What this changes in the spec

| Spec | Was | Now |
|---|---|---|
| §5 | Mainframe reads Trello's REST API with a key and token in the Keychain | Mainframe never talks to Trello. A background Claude Code run reads the list on Sync, and the manager and the sessions use the owner's connector. |
| §7.1 | TODO lane on the board. Toolbar with Manager and Start next card. Manager shown in the right panel when nothing is selected | Todo panel with tabs, ticket panel, manager column on the left, no Start next card |
| §7.2 step 4 | Mainframe moves the card to In Progress | The session moves its own card |
| §7.5 | Mainframe reads the list and stores which board and lists to use | A background Claude Code run reads the list on Sync. Mainframe keeps the source that run last reported, or the one the owner picked. |
| §7.6 | The manager comes in step 3, sits in the right panel and doesn't change files | It comes now, sits in its own column, follows CLAUDE.md, and starts tasks when asked. Messaging sessions and reading their output stay in step 3. |
| §10 | Plan 2b: the Trello TODO lane, Start and Start next card | Plan 2b: this document |

## 9. Constraints

- **Existing code to build on:**
  - `SidePanel` (the panel shell);
  - `TerminalView` and its registry;
  - `SessionHost` (PTYs), the OSC 7501 status and the suggestion scan;
  - `taskService` with `launch.ts`, `openingPrompt.ts` and `taskStore.ts` (state.json, version 1, which has fields that older records lack);
  - `NewTaskDialog`'s start check;
  - the shared `httpUrl` check and `openExternal` for links.
- **Which versions read which state.** A build must not drop or overwrite records an older build wrote. Raising state.json's version makes older builds refuse the file (`NewerStateError`), which is the intended behaviour.
- **Verify before planning:**
  - the CLI flags in §4.1 (`--append-system-prompt`, `--mcp-config` and its value format, `-n`) against the current Claude Code CLI reference;
  - whether a resumed manager keeps the role prompt it was first given (the CLI reference's "system prompt flags in resumed conversations"), so a later Mainframe can still change it;
  - for the background sync run (§5.3):
    - that the owner's claude.ai connectors, including Trello, load in a non-interactive run (the MCP docs list claude.ai connectors as a source but don't say so for `-p`);
    - how to limit the run to MCP tools and allow them without prompts;
    - how to pick a fast model;
    - how to keep these runs out of the owner's `--resume` list and agent view;
  - the MCP SDK and transport chosen for §4.2 against their current docs (the owner's CLAUDE.md requires this).
- **Check in the acceptance run:** whether the owner's `auto` mode asks before a session moves its card to In Progress. If it does, every new card would first land in Needs you with a Trello prompt. Mainframe can't pre-approve the connector's tools, because it doesn't know their names. The owner then decides: approve once with "don't ask again", or allow the connector in their user settings.
- **The repo's rules:** the code stays in proportion to what it does, task reviews judge proportion, `/simplify` runs before the final review, and e2e runs never touch the owner's real Trello or browser.

## 10. Left to the builder

- How the plan is split. The designer suggests two parts:
  1. the manager column, the MCP server, List sessions and Start a task;
  2. the Todo panel, notes, the background sync run with Set the Todo list and the manager's Sync tool, the ticket panel, Start from a card, the Needs you order and the header link.
- The MCP transport and how it is secured.
- The tools' names and exact shapes.
- Where the synced list, the notes and the manager's record are stored.
- How e2e tests drive the manager. For example, the fake `claude` can call the MCP tools directly.
- Exact copy, sizes and motion, within the mockups and the app's current look.
