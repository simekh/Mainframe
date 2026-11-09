# Acceptance: plan 2b part 2, the Todo panel

The owner ran Mainframe with real Claude Code (v2.1.319) on 2026-11-08, on their real data folder, on branch `todo` (build 69b5afc), with Damela open. Logged with `MAINFRAME_LOG_OSC=1`. The board's conventions (You, Decision, Blocker, the in-progress list) are in the shared `Simmesolo/CLAUDE.md`, which Claude Code loads in Damela as a parent folder's file. Mainframe ships none of them.

The owner decides Pass or Fail.

## First pass (build 69b5afc)

| # | Check | Seen | Pass / fail | Note |
|---|---|---|---|---|
| 1 | The first Sync: the connector and its read tools, the list in the board's order, the owner's cards, the source row and the synced time | The tools confirmed were `trelloReadBoard`, `trelloReadList` and `trelloReadCard`. The read synced 31 cards from Trello › Damela › TODO. Compared with the live list through the Trello connector, the ids and order are the same, and every title, description, label set and URL matches word for word. No card in that list has a checklist. Each Blocker card is urgent, and each You or Decision card is the owner's. | | The greyed rows, the source row and the synced time are for the owner to judge on screen. |
| 2 | The sync run: no Bash, file tools or Trello write tools; not in `claude --resume` | Launch: `claude -p --model haiku --no-session-persistence --tools "" --disable-slash-commands --permission-mode dontAsk --permission-prompts none --settings …/todo/damela-fe166ce3/sync-settings.json --output-format json --json-schema … --max-budget-usd 1`. The settings allow only the three read tools. The guard turns away every other tool, and `disableAllHooks` is false. The run took 81 s (19:25:32 to 19:26:53). It started the owner's wiremock MCP server, and nothing it started was left running after it ended. No new chat file in Damela's project folder. | Pass | The run finished on its own. A stopped sync's children are still to check (Quit during a sync). |
| 9 | Feel: the Todo panel beside the manager in each of its states | With the manager hidden and the Todo panel floating, the manager's way back pokes out from behind the Todo panel's left edge | Fail | Fix A below. |

## Fixes

### Fix A: the manager's way back behind the floating Todo panel

- **Seen:** with the manager hidden and the Todo panel floating, a sliver of the manager's way back shows left of the Todo panel (owner's screenshot).
- **Cause:** the floating Todo panel sits 8 px in from the pane's left edge (`left: 8px`, z 7). The manager's way back is a 22 px half pill at the pane's very edge (`left: var(--left-room)`, which is 0 while the Todo panel floats; z 6). The panel covers 14 px of it, and the 8 px margin shows the rest.
- **Fix:** hide the manager's way back while the floating Todo panel is out, as it is covered anyway. It comes back as the Todo panel slides away.
- **Fixed in:** cc7dcd6.

### Asked for during acceptance

The owner asked for these while trying the branch. Each was agreed in chat.

- **Hide my cards (667d203).** A switch at the top of the list hides the cards marked as the owner's and counts them. Notes stay, and the choice is kept per project. There is no sorting: the board's order is the owner's ranking.
- **Markdown descriptions (e881999, 994175e).** The ticket shows a card's description as Markdown, built from `marked` 18.1.3's tokens with no HTML. Raw HTML shows as text, images are never loaded, and only http(s) links open. A row's preview is the text with the marks stripped.
- **A card marked as the owner's starts anyway (227d37a, 3840634).** The mark is a hint, not a lock: the ticket offers "Start anyway". The manager can never start such a card. The owner chose this real lock over an "owner named it" flag the manager would have set itself.
- **Reviews.** `/simplify` (3120f08) and `/code-review high` (cfbb84f) ran again on the branch after these changes.

## Second pass (builds dfefdc4 and cf119a5)

| # | Check | Seen | Pass / fail | Note |
|---|---|---|---|---|
| 2 | A stopped sync leaves nothing running | A sync started at 09:07:59 and was stopped at 09:08:01. Its `claude -p` (pid 84555) and the wiremock MCP server it started (pid 84585) were both gone when it ended, and stayed gone. The other wiremock processes on the machine belong to other Claude sessions. In the panel the list stayed as it was, with no error. | Pass | Quit during a sync is not checked yet. |
| 9 | Fix A: the manager's way back under the floating Todo panel | It no longer shows while the floating Todo panel is out. | Pass | |
| — | Hide my cards | Checked by the owner. | Pass | |
| — | Markdown descriptions | Checked by the owner. | Pass | |
| — | Start anyway on a card marked as the owner's, and the manager refusing one | Checked by the owner. | Pass | |
| — | Stop during a sync | See check 2 above. | Pass | |
| — | A note's unsaved text kept as a draft (asked for at code review, dfefdc4) | Checked by the owner. | Pass | |
| 3 | Start on a card | The owner started #130 ("Scan new receipt-button is behind the app swap/home/back android buttons", label UI) at 09:24:54. The session runs as `claude -w scan-new-receipt-button-is-behind-the -n damela-scan-new-receipt-button-is-behind-the --session-id … --settings …`. Its opening prompt names the card, its label and its URL, says to read the live card with the Trello connector first, and to mark it in progress the way this repo's `CLAUDE.md` says. Trello's activity shows the card moved from TODO to In Progress at 09:25:24 (GMT+1), 30 s after the start. The task's card id is the one the connector's tools return (an `ari:cloud:trello::card/…` id). | Pass | The session started in Manual mode, as the owner's own Damela sessions do, and the owner switched it. Mainframe passes no permission mode: it comes from the owner's Claude Code settings (CLAUDE.md can't set one). |
| 4 | The ticket | Descriptions matched the live cards word for word in check 1, and no card on the list has a checklist. Open in Trello opens the card in the browser. | Pass | |
| 6 | The manager | "sync my list": the manager called `sync_todo` (MCP task k8wec3bm4) and answered "Your Todo panel is synced, and it now shows 30 cards from your list." The sync ran 10:24:21–10:26:45 and left nothing running. "start #n, brief": the card started as a task on the board. | Pass | |
| 7 | Needs you: a Blocker card's task comes before older ones | Checked by the owner. | Pass | |
| 8 | Two projects | Word² beside Damela. Word²'s first sync (10:35:29, 11 s) only found the tools; the read after Allow (10:35:40–10:36:27) gave Word²'s TODO list, 4 cards, from the Word2 board. Damela's list stayed as its 10:26 sync left it (30 cards), in its own `todo.json`. | Pass | |
| 9 | Feel on the laptop screen | Todo pinned and unpinned beside the manager pinned, floating and hidden; the board's room with all three pinned. Checked by the owner: "Good". | Pass | |
| 2 | Quit during a sync | The owner quit with Cmd+Q during a sync that started at 10:37:11. The sync's `claude -p` (pid 22399) and its wiremock MCP server (pid 22427) ended with it, at 10:37:14; Mainframe exited with code 0, and no `claude -p --model haiku` or Mainframe process was left. A sync stopped at 10:36:54 also left nothing. | Pass | |
| 5 | Todos (Mainframe's own notes) | Checked by the owner on build cf119a5: Quick Add at the top right, its hover text, add, edit, start. | Pass | The owner asked for the button at the top right (270ca13), for "todo" wording throughout, and for the name Quick Add with a hover text. After this check they renamed "Hide my cards" to "Hide my tasks" (0b43177). |
| — | The source link and "Hide my tasks" (build 8bf7cbe) | The owner asked for the service's name in the source line to open the list (4790464): "Trello" opens the board in the browser, marked ↗ as the ticket's Open in. Checked by the owner with the switch's new name. | Pass | |

## Reviews after the second pass

`/simplify` (cf28080) shared the source link's colour and hover rule with the card links. `/code-review high` (8bf7cbe) found eight points, and four were fixed:

- A sync whose settings file can't be written now says so in the panel. Before, the Sync button did nothing.
- `start_task` no longer needs a brief.
- An image in a description shows as its alt text, not as a link to the picture.
- The set-aside comment now says the notes go with the file.

The other four were left with reasons in the plan's ledger: card fields in a task's opening prompt, notes in a `todo.json` that fails validation, card ids colliding across trackers, and two starts at once in one project.

## Points raised with the owner

- In a very narrow pane, a pinned Todo panel stays pinned, while the session panel floats instead. The owner may want it to float too.
- An "open link" button component could serve the three links that open in the browser: the ticket's, the session panel's and the source line's.

## Verdict

Accepted by the owner on 2026-11-09; merged into `main`.
