# Terminal text size, pasted images, and model pickers: design

Date: 2026-11-19. Branch: `designer-readability`.

## Why

A designer who works in Claude Code's VS Code extension tried Mainframe and gave three pieces of feedback:

1. The extension's chat is easier to read than Mainframe's terminal. A sans-serif chat view is out of reach (the
   terminal is a character grid, and the agents lay out their screens by counting characters), but a larger size and
   more line height would help a lot. Today it is JetBrains Mono 13 px at line height 1.0, fixed.
2. He pastes many images into a session and refers to them by number ("compare with [Image #2]"). He needs to see
   which image is which number. The extension lets him open a pasted image; Mainframe can't.
3. He likes the extension's model and effort pickers.

The owner decided: (1) size and line height in Settings; (2) clickable `[Image #N]` labels plus a strip of thumbnails
under the terminal, kept across restarts, with "Not available" when a file has gone; (3) model and effort pickers in
the New Task dialog only (no live picker on a running session), with a help line per agent saying how to switch in a
running session.

## Goals

- Terminal text size and line height are settings, apply to every open terminal at once, and are kept.
- Every image a session receives through Mainframe can be opened full size, from its label in the terminal or from a
  thumbnail, and the numbers match the agent's own.
- A new task can start on a chosen model and effort, from lists the agent itself provides.

## Non-goals

- A proportional (sans-serif) font, a font picker, letter spacing, themes.
- A rendered chat view of the conversation.
- Changing the model or effort of a running session, or showing which model a session is on.
- Pickers for the manager or the Todo sync.
- Images the agent receives some other way than through Mainframe (a path typed by hand, an image the agent
  fetched itself).

## Anti-goals

- A wrong number. A thumbnail labelled #3 that opens what the agent calls Image #4 is worse than no number. Where
  Mainframe can't be sure, it shows the image in order without a number, or leaves the label unlinked.
- Any of this naming the owner's projects, folders or models (the project-agnostic rule in `CLAUDE.md`).
- A one-project assumption: two projects side by side each show their own sessions' images.

## What the experiments found (2026-11-19)

Driven in a pty against Claude Code 2.1.328, OpenCode 2.2.7 and Codex 0.169.0:

- **Claude Code** labels each pasted image `[Image #N]`. N counts every image pasted into the conversation, including
  ones deleted from the prompt before sending. `/clear` does not restart the count. A `--resume` carries it on (two
  images sent, quit, resume: the next two were #3 and #4). After `/clear` the session id changes, and resuming that
  new id still carries the count on (#1 to #3 across the clear, then #4 and #5 after quit and resume). Claude Code also saves each pasted image as
  `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png` (undocumented; cleared with the temp folder). The design
  doesn't rely on that folder.
- **OpenCode** 2.2.7 labels them `[Image N]`, but N starts again at 1 in each message, so a number doesn't name one
  image in the conversation: Mainframe gives OpenCode's images no number.
- **Codex** was not signed in on this Mac, so its label and count are unchecked.
- **Models:** `claude --model <alias|full name>` (aliases such as `fable`, `opus`, `sonnet`, which follow the latest
  model) and `claude --effort <low|medium|high|xhigh|max>`. `codex -m <model>`, with effort through `-c`; `codex debug
  models` prints the model catalog as JSON, each model with its `supported_reasoning_levels` and
  `default_reasoning_level`. `opencode -m provider/model#variant`; Mainframe already lists OpenCode's models for the
  Todo sync (`api model.list`).

## Part 1: terminal text size and line height

**Approach:** xterm options changed live. Mainframe already sets `fontSize` and `lineHeight` once in
`terminalOptions.ts`; xterm accepts changes to both on an open terminal. The other ways (a restart to apply, or CSS
zoom on the pane) were dropped: the first is needless, the second blurs the WebGL text and doesn't add line height.

- Settings gets a "Terminal text" section with two controls: size (px) and line height. Today's values (13, 1.0) are
  the defaults, so nothing changes for anyone until they move a control.
- Saved in Mainframe's settings, app-wide (not per project; it's a preference of the person at the screen).
- A change applies at once to every open terminal, tasks and managers, in every project, and to terminals opened
  later. Each terminal refits after the change, so its size reaches the agent.
- No restart is needed. If building finds a case that does need one, the section says so under the controls.

Left to the builder: the ranges and steps (something like 10 to 20 px and 1.0 to 1.6), the controls' look, how the
change reaches every terminal, and what `loadTerminalFont` must do at a new size (it loads the font at 13 px today).

## Part 2: opening pasted images

**Approach (owner's pick, "count and confirm"):** Mainframe keeps its own list of each conversation's images,
recorded as it hands them to the agent, and takes each image's number from the label the agent shows in reply to
the paste. Dropped: counting alone (a paste the agent didn't take, such as one into a question it is asking, would
shift every later number) and reading the agent's own copies (undocumented, temp only, different per agent and
system).

### What Mainframe records

- Every image Mainframe passes to a session, by paste or by drop, in order: its number, the file's path, and its
  name, once the agent has confirmed it with a label (see Numbers). For Claude Code an image is a bracketed paste of
  an existing image file's path; the builder checks which file types each agent accepts, and watches for a label
  only after pasting one of those.
- The list belongs to the agent conversation, not to the terminal: one list per task, and one per manager chat. It
  is not keyed to the agent's session id, which changes on `/clear`, compaction or an in-session resume while the
  count carries on (see the experiments). Reopen and Continue carry the list and count on. It restarts at #1 only
  when Mainframe itself starts a new chat: a new manager chat, or a task's Continue that starts over because the
  agent no longer has the chat.
- The list is saved in the data folder and survives a restart.
- **Pasted images** (from the clipboard) are saved as files in a folder per conversation, kept until the task is
  removed (or, for the manager, until its chat is forgotten or replaced). This replaces today's single folder that is
  emptied at every start. **Dropped files** are not copied: the list points at the original.

### Numbers

- **Every image paste goes through Mainframe.** On the Mac, Ctrl+V with an image or a file on the clipboard is
  handled like Cmd+V (Mainframe saves the image and pastes its path), so the agent never reads the clipboard itself
  behind Mainframe's back. Ctrl+V with anything else still goes to the agent, as today. Windows and Linux already
  paste through Mainframe.
- **The number comes from the agent.** Each agent's adapter gives the pattern of its image label in the terminal
  (`[Image #N]` for Claude Code, `Image N` for OpenCode; Codex's checked while building). After pasting an image's
  path, Mainframe watches the terminal for a label it hasn't seen before, for a few seconds, and records the image
  with the number that label shows. Several files dropped at once expect as many labels, taken in order.
- **No label, no entry.** If no new label appears (the paste went into a question, or the agent didn't take the
  file as an image), the image isn't recorded, and a pasted image's file is deleted.
- **No pattern, no number.** An agent without a known pattern, or a label format that changes in a later version,
  gives images in the strip in order without numbers, and no clickable labels. A wrong number is never shown.
- **What's left:** an image the agent numbers without Mainframe's paste (a path typed by hand) has no entry, so its
  label isn't clickable and it isn't in the strip. No other number shifts.
- The builder checks the watch against the agent's screen redraws (Claude Code repaints only changed cells, so a
  label can arrive split across writes; reading the terminal's buffer rather than the raw output avoids that).

### What the user sees

```
┌ Product card spacing ──────────────────────── Close session ┐
│ ● Damela   ⎇ product-card-spacing              Working · 4m │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⏺ The cards now sit 16 px apart, rows 24 px.            │ │
│ │ ❯ [Image #3] the border is still there, see [Image #2]  │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌ Images [#1][#2][#3][#4 Not available] ──────────────────┐ │
└─────────────────────────────────────────────────────────────┘
```

- **Clickable labels.** The agent's image labels in the terminal (the prompt being typed and earlier messages
  alike) underline on hover and open that image. A label whose number isn't in the list does nothing. They open the
  way links in the terminal open today, with Cmd+click (Ctrl+click on Windows and Linux): a plain click selects text,
  and Claude Code's fullscreen mode takes the mouse. *(A call made while writing this design, not the owner's.)*
- **The strip.** Under the terminal, in task panels and the manager column: thumbnails labelled #N, newest on the
  right, scrolling sideways when they overflow. Hidden while the conversation has no images. A missing file shows a
  hatched "Not available" thumbnail.
- **The full-size view.** Opens from a label or a thumbnail. It shows the number, the file name and the image's size;
  left and right arrows step through the conversation's images; Esc or the close button closes it; "Show in Finder"
  (Explorer, or the file manager on Linux) when the file is there. A missing file shows "Not available", "The file has
  been moved or deleted." and the path it had.
- The mockups the owner chose from are in `.superpowers/brainstorm/` (not in git): option A, "a strip under the
  terminal".

Left to the builder: where the list is stored and its format, how a paste knows its conversation, thumbnail size
and how they're made (the file itself, scaled by the browser, is fine), whether the full-size view covers the
window or the pane, and how renderer code reads image files (it must not be able to read arbitrary files).

## Part 3: model and effort in the New Task dialog

**Approach:** lists come from each agent. Dropped: lists written into Mainframe (stale at every model release) and
plain text boxes (he'd need exact model names).

- Two pickers under Agent: Model and Effort. Both start on "Default", which passes no option, so a task started
  without touching them launches exactly as today. Like the Agent choice, a pick lasts for that dialog only.
- **Claude Code:** models are Default plus its aliases (`fable`, `opus`, `sonnet`, `haiku`), which follow the latest
  model, so they don't go stale. Efforts: low, medium, high, xhigh, max. Passed as `--model` and `--effort`.
- **Codex:** models from `codex debug models` (those it lists for display); efforts are the chosen model's
  `supported_reasoning_levels`. Passed as `-m` and the effort `-c` key (checked against Codex's docs). If the catalog
  can't be read or parsed, both pickers offer only Default.
- **OpenCode:** models from the list Mainframe already reads for the Todo sync; efforts are the chosen model's
  variants, if the list has them (otherwise no Effort picker). The interactive `opencode` has no `-m`, so the pick goes
  in `OPENCODE_CONFIG_CONTENT` as `model: { providerID, model, variant }`, added to any the user set (OpenCode's TUI
  drops a variant given in the `provider/model#variant` string; a variant the user saved for that model in OpenCode wins).
- Changing the model resets Effort to Default when the old pick isn't offered for the new model.
- The lists are asked for when the dialog opens or the agent changes. While they load, and when they fail, the
  pickers show Default only; a failure is logged, and doesn't block Start.
- The picks are saved on the task and passed again when it is reopened or continued, as the task's starting
  choice. A switch made inside the session (`/model`) lasts until the session ends; Reopen starts on the dialog's
  pick again. Before a Codex or OpenCode reopen, a saved model the agent no longer lists is left off that launch, which
  runs on Default (with a logged warning), so a retired model can't leave a task that won't reopen; an effort the model
  no longer offers is left off the same way. The task keeps its pick, which applies again if the model is listed again.
  If the list can't be read at that moment, or takes over 5 s, the pick is passed as saved. *(A call made while writing this design, not the owner's.)*
- **Help line** under the pickers, per agent: how to switch in a running session (Claude Code: `/model` and
  `/effort`; Codex and OpenCode: their commands, checked against their current docs), and that a reopen starts on
  the pick made here.

Left to the builder: the pickers' layout, how the lists reach the dialog, display names, and whether the Claude
alias list and effort levels are read from `claude --help` or kept in the adapter.

## Constraints

- Works on macOS, Windows and Linux (paths, Show in Finder/Explorer, file types).
- Every part is per project where it touches projects: image lists per conversation, pickers per dialog. Text
  settings are app-wide.
- Each part gets a `New:` line in `CHANGELOG.md` under `## Unreleased`.
- External CLIs' flags, labels and commands are checked against their current docs and behaviour while building,
  not taken from this document's memory of them.
