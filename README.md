# Mainframe

Mainframe is a desktop app that runs several [Claude Code](https://code.claude.com/docs), [OpenCode](https://opencode.ai) and [Codex](https://learn.chatgpt.com/docs/codex/cli) sessions side by side, across your projects, in one window.

- **A board of tasks.** Each task is a Claude Code, OpenCode or Codex session in its own git worktree (Claude Code's in `.claude/worktrees/<name>`, OpenCode's and Codex's in `.mainframe/worktrees/<name>`, in your project; Mainframe puts a `.gitignore` in the latter so it stays out of `git status`). The board's lanes, **Needs you**, **Working** and **Paused**, show which sessions need you, which are working, and which tasks have no session running. A fourth lane, **Done**, shows while there are running tasks whose work Mainframe found merged.
- **A manager.** Each project has one agent session you can talk to. It can list the tasks, start new ones, and sync your to-do list.
- **A Todo panel.** It reads a Trello list directly, once you connect Trello in Settings. For any other tracker (Linear, GitHub Issues and others) it reads your to-do list through a connector set up in your agent. You start a task from a card.
- **Several projects at once.** Show them one at a time, side by side, or in a grid. Quit ends every session, and the next start brings them back.

Every session is a real `claude`, `opencode` or `codex` process. It runs with your own login, settings and permissions.

## What you need

Mainframe runs on macOS, Windows 11 and Linux. It is built for current versions: a current system, the newest Node.js LTS and a current Claude Code, OpenCode or Codex.

| | macOS | Windows | Linux |
|---|---|---|---|
| [Node.js](https://nodejs.org/), the newest LTS (Claude Code's hooks run on it) | yes | yes | yes |
| git on your PATH | yes | [Git for Windows](https://gitforwindows.org/), or any `git.exe` on PATH | yes |
| [Claude Code](https://code.claude.com/docs/en/setup), installed and logged in, **or** [OpenCode](https://opencode.ai/) 2.1 or later, from its installer (`~/.opencode/bin`) or on PATH, **or** [Codex](https://learn.chatgpt.com/docs/codex/cli) 0.169 or later, logged in, from its installer or on PATH. At least one is needed, and you can have more than one | Claude Code: native installer, Homebrew or npm. OpenCode: `opencode`. Codex: its installer (`~/.local/bin`), Homebrew's cask or PATH | Claude Code: native installer or WinGet; npm, see below. OpenCode: `opencode.exe`. Codex: its installer (`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`) or PATH; not npm, see below | Claude Code: native installer or npm. OpenCode: `opencode`. Codex: its installer (`~/.local/bin`) or PATH |
| A compiler, to install the packages | no | no | yes, see below |

Each project you open must be a git repository.

The manager, new tasks and the Todo sync run on the default agent (a Trello list that Mainframe reads itself needs no agent). The New task box starts on it and offers the other ticked agents as a choice for that task. An OpenCode task runs in the same kind of worktree and follows the repo's `AGENTS.md` (or `CLAUDE.md`). To use a particular `opencode`, set `MAINFRAME_OPENCODE_BIN` to its path.

A Codex task runs in the same kind of worktree too. On a project's first Codex task, Codex asks once whether you trust the folder. Codex follows the repo's `AGENTS.md`. To have it read `CLAUDE.md` when there is no `AGENTS.md`, add this line at the top of Codex's config, `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`):

```toml
project_doc_fallback_filenames = ["CLAUDE.md"]
```

The New task box shows a note with that line when Codex wouldn't read your project's `CLAUDE.md`. To use a particular `codex`, set `MAINFRAME_CODEX_BIN` to its path.

A manager on Codex comes back in the chat where it last used one of Mainframe's tools. It asks you before it starts a task, so if you set Codex never to ask, it can't start one. Its role replaces your own `developer_instructions` in the manager; your tasks keep yours.

On macOS and Linux, any Claude Code whose `claude` runs in your terminal works, and so does the native installer's `~/.local/bin/claude` when that folder isn't on your PATH.

**On Windows**, Mainframe finds the native installer's `claude.exe` in `%USERPROFILE%\.local\bin`, even when that folder isn't on your PATH (the installer doesn't add it). Claude Code installed with npm puts a `claude.cmd` on your PATH, which Mainframe never runs: it uses the `claude.exe` in npm's package instead, once npm has put the real one in place. When it hasn't, the setup screen says so and suggests the native installer. Codex installed with npm puts a `codex.cmd` on your PATH, which Mainframe doesn't run either: use Codex's own installer, which puts `codex.exe` in `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`. No compiler is needed: node-pty comes ready-built for Windows.

Each task's files sit inside your project, under `.claude\worktrees\<name>\` (Claude Code) or `.mainframe\worktrees\<name>\` (OpenCode and Codex), so in a deep repository their paths can pass Windows' 260-character limit. To let git use longer paths, run this once:

```sh
git config --global core.longpaths true
```

**On Linux**, installing the packages compiles node-pty, so it needs a C++ compiler, `make` and Python 3 (`sudo apt install build-essential python3` on Ubuntu and Debian).

Ubuntu 24.04 and later block what Chromium's sandbox needs. There `npm start` (and `npm run dev`) starts Mainframe without the sandbox and says so. To keep the sandbox, run the two lines below in the `mainframe` folder after the first `npm start`: that start downloads Electron, and the `chrome-sandbox` file with it. Run them again whenever `npm start` says it started without the sandbox, as it will after a `git pull` brings a new Electron:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Run it

The same three commands on every system, in a terminal (PowerShell on Windows):

```sh
git clone <this repo's URL> mainframe
cd mainframe
npm start
```

Each `npm start` (and `npm run dev`) runs `npm install` first: the first one installs Mainframe's packages, and later ones bring them up to date after a `git pull`, or take a moment when nothing changed.

On Windows, if PowerShell says `npm.ps1 cannot be loaded because running scripts is disabled on this system`, its execution policy is blocking npm's launcher script: allow locally created scripts for your user once with `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`, or type `npm.cmd` wherever this README says `npm`.

At the first start, Mainframe opens a setup screen. It looks for `git`, `claude`, `opencode` and `codex`, says what it found, and for anything it couldn't find it gives you a button: **Find claude…**, **Find opencode…** or **Find codex…** (**Find claude.exe…**, **Find opencode.exe…** or **Find codex.exe…** on Windows) to point it at a program it missed, **How to install** to open the install page, and **Look again** once you've fixed it. It asks which agents to use and which one is the default, then which project to start with: any folder that is a git repository.

Mainframe remembers what it found in `settings.json` in its data folder. At every start it checks `git` and the ticked agents again. It shows the setup screen only when `git` or every ticked agent has moved or stopped working; when only the default agent has, another ticked agent stands in and a notice says so. An agent you install after setup is ticked by itself once Mainframe finds it: it shows up as a choice in the New task box, and the default agent stays as it was.

To open more projects, use **File → Open Project…** (⌘O) on a Mac. Windows and Linux have the system's own title bar and no menu bar: there, use the **Open project** button at the bottom of the project list, or Ctrl+Shift+O. Mainframe remembers which projects are open.

## Updating

Mainframe looks for new releases on the remote you cloned it from. When there is one, an **Update available** pill shows in the window; click it to see what's new and update. Updating restarts Mainframe: your sessions stop and come back, as after Quit. To look right away, use **Mainframe → Check for Updates…** on a Mac, or the **Check for Updates…** button in Settings on any system.

One click works when Mainframe was started with `npm start` and your clone has no changes or commits of its own. Otherwise the dialog says why and shows the commands to run instead, with your remote and the release filled in. Quit Mainframe first, then run them in its folder; a second `npm start` while it runs only brings the open window forward. They look like this:

```sh
git fetch <remote> tag v<version>
git merge --ff-only v<version>
npm install
npm start
```

Cloned before updates came in? Run `git pull` once.

## Keys

The Mac has Cmd keys. Windows and Linux have Ctrl keys, as Windows Terminal and VS Code do.

| What it does | Mac | Windows and Linux |
|---|---|---|
| Jump to project 1–9 | Cmd+1…9 | Ctrl+1…9 |
| Take the focused pane off screen | Cmd+W | Ctrl+Shift+W (plain Ctrl+W deletes a word in a terminal) |
| Open Project… | Cmd+O | Ctrl+Shift+O (plain Ctrl+O is Claude Code's) |
| Settings | Cmd+, | Ctrl+, |
| Zoom in / out / back to normal (both windows; remembered) | Cmd++ / Cmd+− / Cmd+0 | Ctrl++ / Ctrl+− / Ctrl+0 (in a terminal, undo is Ctrl+Shift+−) |
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

Copy also works on text selected inside Claude Code's fullscreen mode, which selects with the mouse itself: with nothing selected in the terminal, Mainframe sends Claude Code its own copy key.

On Windows and Linux no key shortcut takes AltGr, which Windows reports as Ctrl+Alt, so it types `@`, `{`, `[` and the rest as usual.

## Paused and finished tasks

A task whose session you close, or whose session ends, goes to **Paused** on the board. Its worktree, branch and conversation stay as they are, and **Reopen** continues that conversation. A Paused card's menu (**⋯**) holds two more choices:

- **Put back** returns the task to the to-do list for later, and takes it off the board. A task you started from a note becomes a note again. For a task you started from a tracker card, its own agent moves the card back to your to-do list, the way your project's instructions say; if the card is not on the list at the next sync, the task stays Paused and its card says so. The worktree and branch stay as they are.
- **Discard** gives the attempt up. A dialog first lists what would be lost: uncommitted and untracked files, and commits that are on neither the base nor any remote branch. On confirm, Mainframe removes the worktree and deletes the branch. A tracker card is left alone, so starting it again starts a fresh task.

A task whose work is all merged leaves the board by itself for the **Finished** tab. Every few minutes, and whenever a session ends or finishes its turn, Mainframe checks each Paused and put-back task: when its conversation began, its worktree has nothing uncommitted and its branch has commits of its own that are all in the base (the remote's default branch, or the main checkout's current branch when there is no remote), it removes the worktree and the branch and moves the task to Finished. Anything it can't prove safe stays put. A task whose session is still running moves to the **Done** lane once its turn is over, marked **Merged**, with a **Finish** button that closes it and moves it the same way. You can also ask the manager to close sessions for you, the Done ones or any you name: it closes a session as **Close session** does, so only merged work goes to Finished, and it leaves alone a session that is working or waiting for your answer.

The Todo panel has two tabs, **To do** and **Finished**. Finished lists the project's finished and discarded tasks, newest first, with a search on the title and the card number.

**Continue** brings a task back to the board:

- from the Finished tab, for a finished or discarded task: it runs in a fresh worktree on the task's branch name, from today's base, and resumes its conversation if your agent still has it (Claude Code deletes chats after 30 days by default); otherwise it starts a new one that says what it continues;
- from the to-do list, for a put-back task: its note or card offers Continue in place of Start, and the task goes on in its own worktree and branch. Deleting a put-back task's note sends the task back to Paused, so it never goes missing;
- from the to-do list, for a card whose task is finished (you moved the card back for more work): the card offers Continue, which continues that task as the Finished tab does. A card whose task was discarded offers Start, which starts a fresh task. Continue on a discarded task whose card has since been started again is refused: continue the newer task instead.

## Set up the Todo panel

**Trello.** In Settings, press **Connect Trello** and allow Mainframe in your browser. Then, in the project's Todo panel, choose **Trello** (on a project that already has a to-do list, press **Set up again** first), and pick the board and the to-do list. You can also pick the list for cards in progress (a coming update moves cards there), the labels that mark your own cards (**Mine**) and the ones that go first (**Comes first**). Mainframe reads the list itself, about once a minute while the panel is open and the window is in front, and **Refresh** reads it at once. No agent runs for this, and a card's text goes into its task's opening prompt, so the task needs no Trello connector.

**Another tracker** (or Trello through your agent's own connector): choose **Another tracker (AI connector)** in the Todo panel, then:

1. In your agent (Claude Code, OpenCode or Codex), add a connector (an MCP server) for your tracker, and check that a normal session of it in your project can read your board. For OpenCode, set the connector up in OpenCode's own config. For Codex, set it up with `codex mcp add`.
2. In your project's instructions file (`CLAUDE.md` for Claude Code; `AGENTS.md` for OpenCode, which reads `CLAUDE.md` when there is no `AGENTS.md`; `AGENTS.md` for Codex, or `CLAUDE.md` with the config line above), say which list is the to-do list. You can also say which cards are yours rather than an agent's, and which come first, for example: "Cards labelled *You* are mine; cards labelled *Urgent* come first."
3. Press **Sync** in the Todo panel. The first sync names the connector's tools it wants to read with. Allow them only if none of them can change your board.

Each sync is a short background run of the default agent. It may use only the read tools you allowed, and it keeps no chat history. An OpenCode sync asks which model to run on the first time, and is never given a shell or the right to edit. A Codex sync runs on your own Codex model, in Codex's read-only mode. It gets no shell, no web and no subagents, and can call only the tools you allowed. One gap: while the first sync looks for its tools, it can't stop a tool you set to `approve` in your own Codex config, as no tool is meant to run then. If the sync used one anyway, Mainframe rejects that sync and names the tool. A sync that runs over 2 minutes asks whether to go on, because large syncs can use a lot of tokens.

## Settings

Settings opens from the cog at the top right, with ⌘, on a Mac and Ctrl+, on Windows and Linux. There you tick the agents, pick the default, connect Trello, and for OpenCode choose the manager's agent and the sync's model.

## Environment variables

Set these as environment variables before `npm start`. In bash and zsh, put them in front of the command: `MAINFRAME_LOG_OSC=1 npm start`. In PowerShell, set them first: `$env:MAINFRAME_LOG_OSC = '1'; npm start` (the variable then stays set in that window; if PowerShell won't run `npm`, see "Run it").

| Variable | What it does |
|---|---|
| `MAINFRAME_DATA_DIR` | Where Mainframe keeps its state. By default `~/Library/Application Support/mainframe` on a Mac, `%APPDATA%\mainframe` on Windows, and `~/.config/mainframe` on Linux (`$XDG_CONFIG_HOME/mainframe` when that is set) |
| `MAINFRAME_CLAUDE_BIN` | The `claude` file to run. Checked at every start, wins over the saved path, and is never saved. When it can't run, the setup screen says so and looks nowhere else |
| `MAINFRAME_OPENCODE_BIN` | The `opencode` file to run. Checked at every start, and when it is set Mainframe looks nowhere else for OpenCode |
| `MAINFRAME_CODEX_BIN` | The `codex` file to run. Checked at every start, and when it is set Mainframe looks nowhere else for Codex |
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

### Releasing

Users hear about a new version when its `v<x.y.z>` tag reaches the remote they cloned from, and read its notes in the update dialog. If you maintain a fork, add one `New:` or `Fixed:` line to `CHANGELOG.md` directly under the `## Unreleased` heading, above any lines already there, for each change users would notice, as it merges. Then, from a clean branch that matches its upstream:

```sh
npm run release            # picks the version: a minor bump if there is a New: line, else a patch bump
npm run release -- 1.0.0   # or name the version yourself
```

It refuses when the notes are empty, when there are uncommitted changes, or when the branch is behind or ahead of its upstream (it only ever pushes its own commit and tag). It then shows the version and the notes and asks before it moves the notes to a `## <version> · <date>` section, commits `Release <version>`, tags it and pushes both to the branch's remote. When the remote is on GitHub and the [GitHub CLI](https://cli.github.com/) (`gh`) is installed, it also creates a GitHub Release with the same notes; otherwise it says it skipped that.

Never move or delete a tag once it is pushed: clones may already have it. Fix a bad release with a new patch release.
