# Mainframe: a window for a task's changes

Design, 2026-11-12. Written after a brainstorm with the owner, who looked at how Parallel Code shows a worktree's diff and compared three layouts in mockups. It adds a window that shows what a task changed in its worktree, opened from the changed-files list in the session panel. This is a deliberately small first version; features come later. Decisions the owner made are marked **(owner)**. Decisions the designer made on the owner's behalf are marked **(designer's call)**; the owner may overturn them.

Approved mockup: `docs/superpowers/mockups/2026-11-12-diff-window.html` (layout A). Its file names and code are made up; the look is the app's current one (`src/renderer/src/app.css`).

## 1. Why

The session panel's changed-files list (`src/renderer/src/panel/ChangedFiles.tsx`) shows which files a task changed and by how many lines, but not the changes themselves. To read them, the owner has to go to a terminal or an editor. Parallel Code, which Mainframe already borrows from (`THIRD_PARTY_NOTICES.md`), opens a diff view when you click a file in its list. The owner wants the same in Mainframe **(owner)**.

The owner looks at one project's and one session's changes at a time **(owner)**, so one diff window is enough.

## 2. Goals, non-goals, anti-goals

**Goals**
- Clicking a file in a task's changed-files list opens the diff window, scrolled to that file **(owner)**.
- The diff window is its own window, above Mainframe's, and the owner can move and resize it **(owner)**.
- A snapshot: it shows the changes as they were when it opened **(owner)**. Clicking a file again reads them again **(designer's call)**.
- Layout A: the changed files listed on the left, and every file's changes in one scroll on the right. Clicking a name in the list jumps to that file **(owner)**.
- It shows the same changes the changed-files list counts, so the two never disagree **(designer's call)**.
- One diff window at a time. Clicking a file in another task, or another project, loads that task into the same window **(designer's call)**.
- It opens where the owner last left it, at the size they left it **(designer's call)**.

**Non-goals (first version)**
- Live updates while the window is open.
- A side-by-side (two-column) view.
- Colours for the code's language (syntax highlighting). It needs a new package (Parallel Code uses Shiki) and can come later **(designer's call)**.
- Showing more unchanged lines around a change ("show more lines").
- Choosing what to compare: only uncommitted changes, or a single commit.
- Comments, review notes, or asking about a line.
- Editing, staging, reverting, or opening a file in an editor from the window.
- Searching in the diff.
- Showing the branch's changes once its worktree is gone.
- A keyboard shortcut or menu item that opens the window.

**Anti-goals**
- A diff window whose files or line counts disagree with the changed-files list for the same moment.
- Taking git's index lock while a session commits in the worktree. The diff must read the way `changedFiles` does (`src/main/git.ts`), with `--no-optional-locks` and `diff.autoRefreshIndex=false`.
- A window that keeps Mainframe running after Mainframe's own window has closed, or that changes what closing Mainframe's window or Quit does.
- A window that floats above other apps (`alwaysOnTop`). It stays above Mainframe only.
- A huge diff (a lockfile, a generated file) that freezes the window or Mainframe.
- Anything that works only for some projects: a language list, a branch name, a file layout (`CLAUDE.md`: Mainframe is project-agnostic).
- A window or call that can't tell which project and task it shows (`CLAUDE.md`: several projects in one window).

## 3. Opening the window

- **Each row in the changed-files list becomes clickable.** A click opens the diff window, or brings it to the front if it is open, loads the task's changes, and scrolls to the clicked file **(owner)**.
- **The list's heading ("3 files changed") keeps folding the list**, as it does today. Clicking any file shows all of the task's files anyway, so the heading needs no second job **(designer's call)**. The brainstorm floated "the heading opens the window at the top", but that would clash with the folding the heading already does.
- **Each click reads the changes afresh.** Clicking the file already on screen refreshes the window, so it needs no refresh button **(designer's call)**.
- **Another task, or a task in another project, replaces what the window shows** **(designer's call)**.
- **Rows the window can't show still open it.** A file that is binary, too large, or whose change is only its file mode opens the window at that file's heading, which says why there are no lines (§4.3).

## 4. What the window shows

### 4.1 The frame

- **The window's title** reads `Changes · <task title> · <project name>`, where the project name is the folder's name (`ProjectView.name`) **(designer's call)**. On every system it uses the system's own title bar and buttons, so it needs none of the main window's Mac title-bar work **(designer's call)**.
- **The look is Mainframe's:** `app.css`'s colours, Inter for text and JetBrains Mono for code, dark only.
- **The window closes** with its close button, or Esc while it is focused **(designer's call)**.

### 4.2 Layout A

- **On the left, the file list.** Each row has the status letter (M, A, D, T, U), the path, and the +/− counts, styled like the changed-files list's rows. The clicked file's row is marked. Clicking a row scrolls the right side to that file. Long paths shorten the way they do in the changed-files list. The list scrolls on its own if it is long.
- **On the right, one scroll of every file in path order**, the same order as the changed-files list. Each file starts with a heading row: path and +/− counts.
- **Each change shows as git prints it:** three unchanged lines around each change (`git diff -U3`, git's default), and a thin separator row between hunks.
- **One column, two line-number gutters,** old then new, as Parallel Code and GitHub show them **(designer's call)**. A removed line is red with only an old number. An added line is green with only a new number. An unchanged line is plain with both.
- **The code is selectable and copyable.** The app turns text selection off by default (`body { user-select: none }`), so the diff turns it back on for its code and paths. Copying takes only the code, without the line numbers or the `+`/`−` markers **(designer's call)**.
- **Long lines** scroll sideways with their file rather than wrapping **(designer's call)**.

### 4.3 Files with no lines to show

These show their heading and a one-line note in place of lines:
- **Binary:** "Binary file, not shown."
- **Too large:** "Too large to show here (N lines changed)." This is a file over the per-file limit.
- **Past the whole-diff limit:** a second limit applies to the whole diff. The clicked file is served first, within its own per-file limit, so the file the owner asked for always shows its lines. The rest are then served in path order until the limit is reached. Files after that show "Not shown: this task's changes are too large to show at once. Click this file in the session panel to see it." Clicking there reads the diff again with that file served first **(designer's call)**.
- The exact limits are the builder's, chosen so that the window stays responsive with no list-virtualising library. Parallel Code collapses large diffs for the same reason.
- **Only the file mode changed** (or a type change with no text lines): "No line changes (file mode changed)."
- **Deleted files** show all their lines as removed. **New files**, committed or untracked, show all their lines as added.

### 4.4 Empty and failed

- **No changes left** (the task's changes were reset since the list last refreshed): the window says "No changes" **(designer's call)**.
- **No worktree** (it was removed): the window says the worktree is gone. The list says "Worktree removed" in this case already.
- **git fails:** the window says it couldn't read the changes, with git's message. Mainframe's window is unaffected.

## 5. Where the changes come from

- **The same comparison as `changedFiles`.** Compare the worktree, committed and uncommitted together, against `git merge-base HEAD origin/HEAD`, falling back to `HEAD`. Use the same flags: `--no-optional-locks`, `-c diff.autoRefreshIndex=false`, and `--no-renames`, so a rename is a delete plus an add in both places. No branch name is assumed. The base should come from one shared helper, so the list and the window can't drift apart.
- **The text diff** is `git diff -U3 --no-renames <base> --` in the worktree.
- **Untracked files** are not in `git diff`. They come from `git ls-files --others --exclude-standard -z`, as in `changedFiles`. Each one is read from disk and shown as a new file, all added. It is binary when its first bytes hold a NUL byte (git's own test), and too large past the per-file limit. Parallel Code builds fake diff text for these; building the parsed form directly is equally fine (builder's choice).
- **Counts come from the diff itself.** For untracked text files, the window shows +N where the changed-files list shows no count. That is extra detail, not a disagreement.
- **Paths must survive git's quoting.** Paths with spaces, non-ASCII letters (`å`, `ü`), or characters git escapes must show as they are, and must match the changed-files list's paths, so a click on any row finds its file. Parallel Code's header regex (`a/(.+?) b/(.+)`) doesn't handle quoted paths. Mainframe's parser must, for example with `-c core.quotePath=false` plus decoding of git's C-style quoted paths, or by taking paths from a `-z` listing.
- **Parsing happens in the main process** **(designer's call)**. Main runs git, parses the output into per-file hunks and lines, applies the size limits, and sends the window the structured result. The parser is plain TypeScript with no Electron import, unit-tested with vitest like `git.test.ts`. It may be adapted from Parallel Code's `src/lib/unified-diff-parser.ts` (MIT). If so, it starts with the source comment the other adapted files carry, and gets a line in `THIRD_PARTY_NOTICES.md`, naming the commit it came from if that isn't `97c3558`.
- **The parser must handle** several files and several hunks, added, deleted and modified files, binary markers, `\ No newline at end of file`, CRLF line endings (shown without the `\r`), and empty files.

## 6. The window itself

- **A second `BrowserWindow`, created on the first open, with Mainframe's window as its `parent`.** A child window always shows above its parent and not above other apps. On macOS it keeps its place relative to the parent when the parent moves; on Windows and Linux it doesn't move with it (Electron's `BrowserWindow` docs, "Parent and child windows"). Both are acceptable **(designer's call)**. It is not modal: Mainframe's window stays usable while it is open.
- **Same security settings as Mainframe's window:** `sandbox`, `contextIsolation`, no `nodeIntegration`, `window.open` denied, navigation blocked, the same Content-Security-Policy. It uses the same preload. Whether the page is a second HTML entry or the same `index.html` choosing its view at start is the builder's call.
- **Closing it destroys it** **(designer's call)**. The next click creates it again, at its remembered place and size.
- **Mainframe's window closing closes the diff window first,** so `window-all-closed` still ends the app as it does today. Electron's docs don't say whether children close with their parent, so this is done explicitly. Quit, and a Windows shutdown, behave as they do today with the diff window open.
- **Position and size are remembered across opens and restarts,** in one app-wide file in the data folder **(designer's call)**. It belongs to no project, so it is not a one-project file. Saved bounds that fall off every current display (a monitor unplugged) are dropped. The default is about 1000 × 720, centred over Mainframe's window **(designer's call)**.
- **In an e2e run it is shown or hidden as Mainframe's window is** (`show: !(e2e && onMac)`): hidden on the Mac, and shown on Windows and Linux, where a window that has never been shown gets no keyboard input, and the Esc test needs that input. Test helpers that take `BrowserWindow.getAllWindows()[0]` as Mainframe's window (`e2e/launch.ts`, `e2e/app.e2e.ts`) must keep finding Mainframe's window once a second one can exist.
- **Keys and menus:** on the Mac, the app menu's Edit → Copy and View → Toggle Developer Tools act on the diff window when it is focused. On Windows and Linux, the diff window gets the same Ctrl+Shift+I DevTools key and the same right-click Copy as Mainframe's window. Esc closes it (§4.1).

## 7. Calls between the parts

The names are the builder's; the shape is not:

- **Mainframe's page → main:** open the diff for `(projectDir, taskId, filePath)`. Like every task call, it names its project by its folder. Main finds the project in the `ProjectRegistry` and the task in that project's `TaskService`, and so gets the worktree path. An unknown project or task throws, as other task calls do.
- **Main → the diff window:** what to show. That is the project's name, the task's title, the parsed files (or the empty or failed state of §4.4), and the file to scroll to. The window may still be loading when main has the data, so it can ask for the current data once it starts as well as receive new data while open.
- **Nothing flows back** from the diff window in this version, apart from its position and size, which main reads from the window itself.

## 8. Several projects, any project

- With two projects side by side, a click in either pane's changed-files list loads that task into the one window, and the title says which project and task it is.
- A project or task that closes while the window shows it changes nothing in the window. It is a snapshot, and stays until it is closed or replaced **(designer's call)**.
- No language, branch, test command or folder layout is assumed. The diff works the same for any text file in any repository with an `origin/HEAD`, and falls back to `HEAD` without one, as `changedFiles` does.

## 9. Testing

- **Unit (vitest):**
  - The parser: every case in §5, paths with spaces and non-ASCII letters, and git-quoted paths.
  - The git reading, against a throwaway repository as `git.test.ts` does: committed, uncommitted, untracked, binary, deleted, mode-only and over-the-limit files.
  - A check that the window's files and counts match `changedFiles` for the same repository.
  - The saved-bounds check (off-screen bounds dropped).
- **e2e (Playwright):**
  - Clicking a file in the panel opens a second window titled for the task and project, listing the task's files and scrolled to the clicked one.
  - Clicking a file in another task reuses the same window.
  - Esc closes the window.
  - Closing Mainframe's window with the diff window open still ends the app.

## 10. Left to the builder

- The IPC channel names, and how the page tells which view to render.
- The exact size limits (§4.3), within "stays responsive with no virtualising library".
- The name and format of the bounds file.
- Styling details within the app's look: row heights, the separator's look, the colours' strength.
- Whether the parser is adapted from Parallel Code or written fresh.
- How a click on a row avoids taking the keyboard from the terminal, if it would, as the list's heading already does (`keepFocus`).
