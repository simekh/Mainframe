# Feel test: Mainframe's terminal next to iTerm2

Spec §10 step 1: does the app's terminal feel as good as iTerm2 for real Claude Code work? The owner decides Pass or Fail.

## Ground rules

- Sessions run in Damela's main checkout without worktrees. Give them **read-only prompts only**: no edits, commits, merges or pushes. (Damela's `bypassPermissions` setting doesn't apply: Claude Code 2.1.318 ignores bypass mode from local settings, so the sessions ran in the owner's user-level `auto` mode. See §11.1 of the step 1 findings.)
- iTerm2 sits next to the app. Both run `claude` in `/Users/simonekholm/Developer/Simmesolo/Damela`.
- The app wears Parallel Code's default look, terminal included (JetBrains Mono 13 and its colours), so its colours and font differ from iTerm2 on purpose. Compare how it feels and how cleanly it draws, not the palette.

## Setup

1. Count Claude and MCP processes before starting the app (for check 13), in iTerm2:
   `pgrep -lf 'claude|mcp' | wc -l` → before: 69
2. Build once: `npm --prefix /Users/simonekholm/Developer/Simmesolo/Mainframe run build`
3. Start one variant at a time (Cmd+Q between variants):

| Variant | Command | Input batching | Output batching |
|---|---|---|---|
| A (default) | `npm --prefix /Users/simonekholm/Developer/Simmesolo/Mainframe start` | 0 ms | 8 ms |
| B (Parallel Code) | `MAINFRAME_INPUT_BATCH_MS=8 npm --prefix /Users/simonekholm/Developer/Simmesolo/Mainframe start` | 8 ms | 8 ms |
| C | `MAINFRAME_OUTPUT_BATCH_MS=0 npm --prefix /Users/simonekholm/Developer/Simmesolo/Mainframe start` | 0 ms | 0 ms |

Click **New session** to start `claude` in Damela.

## Checks

Same / worse / better is Mainframe compared with iTerm2.

| # | Check | iTerm2 | Mainframe | Same / worse / better | Note |
|---|---|---|---|---|---|
| 1 | Typing: fast typing and key repeat in the prompt. Does any variant (A, B, C) feel delayed? | | Variant A: "the feel of the terminal is OK" | | Owner, 2026-11-05 |
| 2 | Shift+Enter inserts a newline; Enter submits. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 3 | Swedish Option characters: @ £ $ € \| [ ] { } \\ ≈; dead keys ~ ^ ¨ ´ ` (e.g. Option+¨ then space); å ä ö. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 4 | Option+←/→ moves by word, Option+⌫ deletes a word, Cmd+←/→ goes to line start/end, Cmd+⌫ deletes to line start. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 5 | Copy: drag-select and Cmd+C (no trailing padding); Option+drag while Claude Code captures the mouse. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 6 | Paste: Cmd+V of multi-line text (`[Pasted text #1 …]`); a screenshot (Cmd+Ctrl+Shift+4, then Cmd+V → `[Image #1]`); two screenshots in one prompt; a file copied in Finder (its path); a file dragged from Finder. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 7 | Fullscreen mode (`/tui fullscreen`, back with `/tui default`): trackpad scrolling, PageUp/PageDown, selecting text copies it (OSC 52). | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 8 | Normal mode scrolling: trackpad speed through long output; Cmd+Shift+↑/↓/PageUp/PageDown. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 9 | Rendering: colours, spinner, box drawing, a table with emoji (alignment), diffs, the status line, window resize, View → Redraw Terminals (Cmd+Shift+L). If emoji widths misalign, the fix to try is `@xterm/addon-unicode11` with `term.unicode.activeVersion = '11'`. | Bold text green | Bold text white, "more single colour" | worse | Claude Code sends bold as plain SGR 1; iTerm2's profile draws it in its bold colour #addb67 ("Brighten bold text"). xterm.js has no bold colour. Inline code is the same lavender (truecolor 177,185,249) in both. Owner: follow Parallel Code's colours for everything, so bold stays white as in Parallel Code. Emoji table: the right border fell out of line (xterm counted emoji as one column, Claude Code as two); fixed with `@xterm/addon-unicode11`; owner re-checked: the table lines up. Window resize: the terminal refits by itself; Redraw Terminals not needed. |
| 10 | Load: 7 sessions; 6 stream long read-only answers (e.g. "Read the five largest files under frontend/src and summarise each in detail") while you type in the 7th and switch between sessions. Compare CPU in Activity Monitor with iTerm2 running the same 7. | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 11 | Status: does each row show `working`, then `idle` / `done` / `blocked · …`, as Claude works and stops? | — | Works as it should | — | Owner, 2026-11-05 |
| 12 | Stray output: any escape-sequence garbage (for example from the iTerm2 `cc-status` hook) in the terminal? | | Works as it should | same | Owner, 2026-11-05: "Everything else is working as it should." |
| 13 | Quit with sessions running (Cmd+Q). Then in iTerm2 `pgrep -lf 'claude\|mcp' \| wc -l` gives the same count as before the app started (this includes the MCP servers Claude Code starts). | — | after: lower than 69 | same | Exact check: every process the app had started (Electron and its helpers, `claude` 996, the IntelliJ MCP server 1042 it launched) was gone after Cmd+Q. |

## Result

**Verdict:** Pass

**Batching chosen:** input 0 ms, output 8 ms (variant A, the default; the owner felt no difference between variants)

**Fixes made during the test:**

- Parallel Code's default look for the window and the terminal (owner's choice): blue-black panels, cyan accent, Inter and Sora, JetBrains Mono 13 with Parallel Code's terminal colours. The terminal font loads before any terminal opens.
- Emoji count as two columns (`@xterm/addon-unicode11`, Unicode 11 widths), so Claude Code's tables line up.

**Owner's notes for plan 2:**

- The terminal works as in Parallel Code: one terminal on screen, the one for the task you click.
- The agent manager window should be resizable: full height, adjustable width, with a pin/unpin button.
- Redraw Terminals isn't needed in the end product.

**Date:** 2026-11-05
