# Changelog

## Unreleased

## 0.2.1 · 20 Nov 2026

Fixed: After a restart, Claude Code's [Image #1] no longer opens an image pasted before the restart.
Fixed: Images whose [Image #N] label Claude Code wraps onto the next line are kept, and Cmd+click on either part opens them.

## 0.2.0 · 20 Nov 2026

New: On the Mac, Ctrl+V pastes a copied image or file, as Cmd+V does.
New: Cmd+click (Ctrl+click on Windows and Linux) on Claude Code's [Image #N] label opens the image you pasted or dropped full size.
New: New Task can start a task on a chosen model and effort.
New: Settings can make the terminal text larger and give it more line height.

## 0.1.1 · 18 Nov 2026

Fixed: A finished task's worktree is cleaned up even when its closed Claude Code session left the worktree locked.

## 0.1.0 · 18 Nov 2026

Fixed: Mainframe runs on a newer Electron with Chromium's latest security fixes; on Linux, run the two `chrome-sandbox` lines from the README again to keep the sandbox.
New: The manager and the Todo sync run on Codex too.
New: Codex can run your tasks, beside Claude Code and OpenCode.
Fixed: After a restart, restored sessions no longer stay on "Starting…": each card shows what its session is doing.
New: Mainframe tells you when there's a new release, and updates in one click.
