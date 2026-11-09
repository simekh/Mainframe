# Mainframe

Mainframe is a desktop app that runs several [Claude Code](https://code.claude.com/docs) sessions side by side, across your projects, in one window.

- **A board of tasks.** Each task is a Claude Code session in its own git worktree (`.claude/worktrees/<name>` in your project). The board shows which sessions are working and which need you.
- **A manager.** Each project has one Claude session you can talk to. It can list the tasks, start new ones, and sync your to-do list.
- **A Todo panel.** It reads your to-do list from your task tracker through a Claude Code connector, so it works with any tracker you have one for: Trello, Linear, GitHub Issues and others. You start a task from a card.
- **Several projects at once.** Show them one at a time, side by side, or in a grid. Quit ends every session, and the next start brings them back.

Every session is a real `claude` process. It runs with your own Claude Code login, settings and permissions.

## What you need

- **macOS.** Mainframe is built and tested there.
- **Node.js** 22.12 or later.
- **Claude Code**, installed and logged in: `claude` must run in your terminal.
- **git.** Each project you open must be a git repository.

**On Linux**, `npm install` compiles node-pty, so it needs a C++ compiler, `make` and Python 3 (`sudo apt install build-essential python3` on Ubuntu and Debian).

Ubuntu 24.04 and later block what Chromium's sandbox needs. There `npm start` starts Mainframe without the sandbox and says so. To keep the sandbox, run this once, and again after an `npm install` that reinstalls Electron:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Run it

```sh
git clone <this repo's URL> mainframe
cd mainframe
npm install
npm start
```

At the first start, Mainframe opens a setup screen. It looks for `git` and `claude`, says what it found, and for anything it couldn't find it gives you a button: **Find claude…** to point it at a Claude Code it missed, **How to install** to open the install page, and **Look again** once you've fixed it. When both work, it asks which project to start with: any folder that is a git repository.

Mainframe remembers the `claude` it found in `settings.json` in its data folder. At every start it checks `git` and `claude` again, and shows the setup screen only when one of them has moved or stopped working. To open more projects, use **File → Open Project…** (⌘O). Mainframe remembers which projects are open.

## Set up the Todo panel

1. In Claude Code, add a connector (an MCP server) for your tracker, and check that a normal `claude` session in your project can read your board.
2. In your project's `CLAUDE.md`, say which list is the to-do list. You can also say which cards are yours rather than an agent's, and which come first, for example: "Cards labelled *You* are mine; cards labelled *Urgent* come first."
3. Press **Sync** in the Todo panel. The first sync names the connector's tools it wants to read with. Allow them only if none of them can change your board.

Each sync is a short background `claude` run. It may use only the read tools you allowed, and it keeps no chat history.

## Settings

Set these as environment variables before `npm start`:

| Variable | What it does |
|---|---|
| `MAINFRAME_DATA_DIR` | Where Mainframe keeps its state (default: `~/Library/Application Support/mainframe`) |
| `MAINFRAME_CLAUDE_BIN` | The `claude` file to run. Checked at every start, wins over the saved path, and is never saved. When it can't run, the setup screen says so and looks nowhere else |
| `MAINFRAME_LOG_OSC=1` | Prints the sessions' status reports to the terminal |

## Develop

```sh
npm run dev         # run with hot reload
npm test            # unit tests
npm run typecheck
npm run test:e2e    # builds, then runs the end-to-end tests (Playwright + Electron)
```

On Windows the end-to-end tests need [Git for Windows](https://gitforwindows.org/), because their stand-in for `claude` opens Git Bash.

On a Linux that blocks Chromium's sandbox (see "What you need"), run `npm run dev -- --noSandbox`.

Mainframe adapts some code from Parallel Code; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
