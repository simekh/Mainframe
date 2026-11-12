# Mainframe

Mainframe is a desktop app that runs several [Claude Code](https://code.claude.com/docs) and [OpenCode](https://opencode.ai) sessions side by side, across your projects, in one window.

- **A board of tasks.** Each task is a Claude Code or OpenCode session in its own git worktree (`.claude/worktrees/<name>` in your project). The board shows which sessions are working and which need you.
- **A manager.** Each project has one Claude session you can talk to. It can list the tasks, start new ones, and sync your to-do list.
- **A Todo panel.** It reads your to-do list from your task tracker through a Claude Code connector, so it works with any tracker you have one for: Trello, Linear, GitHub Issues and others. You start a task from a card.
- **Several projects at once.** Show them one at a time, side by side, or in a grid. Quit ends every session, and the next start brings them back.

Every session is a real `claude` or `opencode` process. It runs with your own login, settings and permissions.

## What you need

Mainframe runs on macOS, Windows 11 and Linux. It is built for current versions: a current system, the newest Node.js LTS and a current Claude Code.

| | macOS | Windows | Linux |
|---|---|---|---|
| [Node.js](https://nodejs.org/), the newest LTS | yes | yes | yes |
| git on your PATH | yes | [Git for Windows](https://gitforwindows.org/), or any `git.exe` on PATH | yes |
| [Claude Code](https://code.claude.com/docs/en/setup), installed and logged in | native installer, Homebrew or npm | native installer or WinGet; npm, see below | native installer or npm |
| A compiler for `npm install` | no | no | yes, see below |
| Optional: [OpenCode](https://opencode.ai/) 2.1 or later, from its installer (`~/.opencode/bin`) or on PATH | `opencode` | `opencode.exe` | `opencode` |

Each project you open must be a git repository.

The New task box offers OpenCode as a task's agent when Mainframe finds it. An OpenCode task runs in the same kind of worktree and follows the repo's `AGENTS.md` (or `CLAUDE.md`). The manager, the Todo sync and tasks started from cards still use Claude Code. To use a particular `opencode`, set `MAINFRAME_OPENCODE_BIN` to its path.

On macOS and Linux, any Claude Code whose `claude` runs in your terminal works, and so does the native installer's `~/.local/bin/claude` when that folder isn't on your PATH.

**On Windows**, Mainframe finds the native installer's `claude.exe` in `%USERPROFILE%\.local\bin`, even when that folder isn't on your PATH (the installer doesn't add it). Claude Code installed with npm puts a `claude.cmd` on your PATH, which Mainframe never runs: it uses the `claude.exe` in npm's package instead, once npm has put the real one in place. When it hasn't, the setup screen says so and suggests the native installer. No compiler is needed: node-pty comes ready-built for Windows.

Each task's files sit inside your project, under `.claude\worktrees\<name>\`, so in a deep repository their paths can pass Windows' 260-character limit. To let git use longer paths, run this once:

```sh
git config --global core.longpaths true
```

**On Linux**, `npm install` compiles node-pty, so it needs a C++ compiler, `make` and Python 3 (`sudo apt install build-essential python3` on Ubuntu and Debian).

Ubuntu 24.04 and later block what Chromium's sandbox needs. There `npm start` (and `npm run dev`) starts Mainframe without the sandbox and says so. To keep the sandbox, run the two lines below in the `mainframe` folder after the first `npm start`: that start downloads Electron, and the `chrome-sandbox` file with it. Run them again whenever `npm start` says it started without the sandbox, as it will after an `npm install` that reinstalls Electron:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Run it

The same four commands on every system, in a terminal (PowerShell on Windows):

```sh
git clone <this repo's URL> mainframe
cd mainframe
npm install
npm start
```

On Windows, if PowerShell says `npm.ps1 cannot be loaded because running scripts is disabled on this system`, its execution policy is blocking npm's launcher script: allow locally created scripts for your user once with `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`, or type `npm.cmd` wherever this README says `npm`.

At the first start, Mainframe opens a setup screen. It looks for `git` and `claude`, says what it found, and for anything it couldn't find it gives you a button: **Find claude…** (**Find claude.exe…** on Windows) to point it at a Claude Code it missed, **How to install** to open the install page, and **Look again** once you've fixed it. When both work, it asks which project to start with: any folder that is a git repository.

Mainframe remembers the `claude` it found in `settings.json` in its data folder. At every start it checks `git` and `claude` again, and shows the setup screen only when one of them has moved or stopped working.

To open more projects, use **File → Open Project…** (⌘O) on a Mac. Windows and Linux have the system's own title bar and no menu bar: there, use the **Open project** button at the bottom of the project list, or Ctrl+Shift+O. Mainframe remembers which projects are open.

## Keys

The Mac has Cmd keys. Windows and Linux have Ctrl keys, as Windows Terminal and VS Code do.

| What it does | Mac | Windows and Linux |
|---|---|---|
| Jump to project 1–9 | Cmd+1…9 | Ctrl+1…9 |
| Take the focused pane off screen | Cmd+W | Ctrl+Shift+W (plain Ctrl+W deletes a word in a terminal) |
| Open Project… | Cmd+O | Ctrl+Shift+O (plain Ctrl+O is Claude Code's) |
| Next / previous session that needs you | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Start a task from the New task box | Cmd+Enter | Ctrl+Enter |
| Open a link in a terminal | Cmd+click | Ctrl+click |
| Copy in a terminal | Cmd+C | Ctrl+C when text is selected (otherwise it interrupts, as usual), or Ctrl+Shift+C |
| Paste in a terminal (text, files, images) | Cmd+V | Ctrl+V or Ctrl+Shift+V |
| Right-click in a terminal | nothing | a Copy / Paste menu |
| Start / end of the line | Cmd+← / Cmd+→ | Home / End |
| Delete the previous word | Option+Delete | Ctrl+Backspace |
| Scroll a line | Cmd+Shift+↑ / ↓ | Ctrl+Shift+↑ / ↓ |
| Scroll a page | Cmd+Shift+PgUp / PgDn | Shift+PgUp / PgDn |

On Windows and Linux no key shortcut takes AltGr, which Windows reports as Ctrl+Alt, so it types `@`, `{`, `[` and the rest as usual.

## Set up the Todo panel

1. In Claude Code, add a connector (an MCP server) for your tracker, and check that a normal `claude` session in your project can read your board.
2. In your project's `CLAUDE.md`, say which list is the to-do list. You can also say which cards are yours rather than an agent's, and which come first, for example: "Cards labelled *You* are mine; cards labelled *Urgent* come first."
3. Press **Sync** in the Todo panel. The first sync names the connector's tools it wants to read with. Allow them only if none of them can change your board.

Each sync is a short background `claude` run. It may use only the read tools you allowed, and it keeps no chat history.

## Settings

Set these as environment variables before `npm start`. In bash and zsh, put them in front of the command: `MAINFRAME_LOG_OSC=1 npm start`. In PowerShell, set them first: `$env:MAINFRAME_LOG_OSC = '1'; npm start` (the variable then stays set in that window; if PowerShell won't run `npm`, see "Run it").

| Variable | What it does |
|---|---|
| `MAINFRAME_DATA_DIR` | Where Mainframe keeps its state. By default `~/Library/Application Support/mainframe` on a Mac, `%APPDATA%\mainframe` on Windows, and `~/.config/mainframe` on Linux (`$XDG_CONFIG_HOME/mainframe` when that is set) |
| `MAINFRAME_CLAUDE_BIN` | The `claude` file to run. Checked at every start, wins over the saved path, and is never saved. When it can't run, the setup screen says so and looks nowhere else |
| `MAINFRAME_OPENCODE_BIN` | The `opencode` file to run. Checked at every start, and when it is set Mainframe looks nowhere else for OpenCode |
| `MAINFRAME_LOG_OSC=1` | Prints the sessions' status reports to the terminal |

## Develop

```sh
npm run dev         # run with hot reload
npm test            # unit tests
npm run typecheck
npm run test:e2e    # builds, then runs the end-to-end tests (Playwright + Electron)
```

DevTools open from the View menu on a Mac, and with Ctrl+Shift+I on Windows and Linux.

On Windows the end-to-end tests need [Git for Windows](https://gitforwindows.org/), because their stand-in for `claude` opens Git Bash. They find its `bash.exe` from the `git` on PATH; if that finds none, for a Git that isn't laid out like Git for Windows' own, set `FAKE_CLAUDE_SHELL` to the full path of a `bash.exe`.

Mainframe adapts some code from Parallel Code; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
