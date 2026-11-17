# Telling users about new releases, and updating in one click (design)

Brainstormed with the owner on 2026-11-17.

## Intent

Mainframe has more and more users, and the owner adds features quickly. The owner wants users to know when a newer
version exists, so they get the latest features and fixes, and wants updating to be easy enough that they do it.

Users run Mainframe from a git clone (`git clone`, `npm install`, `npm start`; see the README). There are no packaged
builds, no GitHub Releases and no version number yet (`package.json` says `0.0.0`). Today a user learns of a new
version only by looking at GitHub.

What the owner said:

- **An update is a release the owner makes, not every push to `main`.** The owner bundles several features into a
  release and writes a short note for it. Half-finished work on `main` must not prompt anyone.
- **The version number goes up by itself.** The owner does not want to pick one each time, but can.
- **A "Check for Updates…" item forces a check**, with the common wording.

## Goals

1. When a newer release than the one a user runs exists, Mainframe shows it without being asked, within a few hours
   of the release.
2. The user sees the owner's notes for every release they have missed, and can update with one click: Mainframe
   quits, takes the release, installs its packages, and starts again with every session back.
3. **Check for Updates…** checks at once and says the result.
4. The owner makes a release with one command, from notes gathered as the work merged.

## Non-goals

- Packaged, signed builds that update themselves (an installer, `electron-updater`). That needs paid code signing on
  macOS and Windows and is its own project.
- Rolling back to an older release from inside Mainframe.
- Forcing an update, or blocking an old version from running.
- Updates while running `npm run dev`: that is someone working on Mainframe itself.
- Choosing among several remotes, or updating from a fork's own releases in any special way (see "Known limits").

## Anti-goals (a failure even if it works)

- An update loses a user's own edits to Mainframe's files, or leaves them with a Mainframe that will not start and no
  word of how to recover.
- Every push to `main` prompts users.
- A check hangs, asks for a password, or opens a credential dialog. It must fail quietly and say so only on a manual
  check.
- Anything in the product names the owner's repo, GitHub account or branch. The release source is the clone's own
  remote, so a friend's fork works the same way.

## Approaches considered

- **A. Git tags plus `CHANGELOG.md` (picked).** A release is a `v<semver>` tag. Its notes are a section of
  `CHANGELOG.md` in the repo. Mainframe asks its own remote for tags with `git`, which every user already has.
- **B. GitHub's Releases API.** Same notice and button, but versions and notes come from `api.github.com`. Notes can be
  edited on the web after release. Ties Mainframe to GitHub (a fork on GitLab gets nothing), and unauthenticated calls
  are rate-limited.
- **C. A notice only.** A banner with the notes and the commands to run. Smallest, but every update is a trip to the
  terminal, which works against the reason for the feature.

The owner picked A: it needs nothing users don't already have, and the one-click update removes the reason to put an
update off.

## Design

### Versions

- The running version is the newest `v<semver>` tag reachable from the clone's `HEAD` (`git describe --tags --match
  'v[0-9]*' --abbrev=0`, or an equivalent). No tag means "no release yet" (version shown as "unreleased").
- A clone between releases (cloned from `main` after a release) runs that release plus later commits, and counts as up
  to date for that release.
- `package.json`'s `version` is not used and not changed. That keeps a release commit Markdown-only (see "Releases").
- The Mac's About box shows the version (`app.setAboutPanelOptions`).
- Only plain `MAJOR.MINOR.PATCH` tags count. Pre-release tags (`v1.0.0-beta.1`) are ignored.

### Checking

- **Where from:** the remote of the Mainframe clone's own folder: the current branch's upstream remote, else `origin`.
  No URL is built into the product.
- **How:** list the remote's tags (`git ls-remote --tags`). If the newest release tag is newer than the running
  version, fetch that tag and read `CHANGELOG.md` at it (`git show <tag>:CHANGELOG.md`), keeping the sections newer
  than the running version.
- **Never interactive:** the git calls run with no terminal prompt and no credential helper dialogs, and with a
  timeout. `src/main/git.ts` already does this for the task fetch, so reuse that. Any failure means "couldn't check".
- **When:** shortly after start, then every 6 hours while Mainframe runs (builder's call: one interval, no setting).
  Not in `npm run dev`, and not in e2e runs unless a test asks for it.
- **Can't check:** the clone isn't a git repo, has no remote, or the remote can't be reached. An automatic check says
  nothing. A manual check says why.

### What the user sees

A pill in the top row, next to the settings cog, appears when a newer release is known. It stays until the user
updates (there's no "skip this version"):

```
 ┌──────────────────────────────────────────────── ⬆ Update available ─ ⚙ ┐
```

Clicking it opens a dialog:

```
 ┌─ Mainframe 0.5.0 is available ─────────────────────────┐
 │  You have 0.4.0.                                       │
 │                                                        │
 │  0.5.0 · 17 Nov                                        │
 │   New: reorder projects in the list                    │
 │   Fixed: Continue on a task that ended early           │
 │                                                        │
 │  Updating restarts Mainframe. Your sessions stop and   │
 │  come back, as after Quit.                             │
 │                              [ Later ]  [ Update ]     │
 └────────────────────────────────────────────────────────┘
```

- The notes are the `CHANGELOG.md` sections for every missed release, newest first, rendered as Markdown (`marked` is
  already a dependency; render it the way the app already renders Markdown, with the same sanitising).
- **Later** closes the dialog. The pill stays.
- With several projects open, there is one pill for the window, not one per pane. Updates are about the app, not a
  project.

**Check for Updates…**

- On the Mac it is in the app menu, under About.
- On every system, Settings gets a line with the version and a **Check for Updates…** button. Windows and Linux have
  no menu bar, so this is their way in.
- A manual check opens the dialog above when there is a newer release, says "Mainframe is up to date (0.4.0)" when
  there isn't, or says why it couldn't check.

### Updating

One click works only when all of these hold. Otherwise the dialog shows the commands to run by hand in place of the
Update button, with a line saying why:

- Mainframe was started by `npm start`, so `scripts/start.mjs` is there to restart it. `start.mjs` tells the app so,
  for example with an environment variable.
- The clone has no uncommitted changes to tracked files. Untracked files are fine. **A change to `package-lock.json`
  alone, with `package.json` unchanged, doesn't count** (designer's call): `npm install` can rewrite the lockfile on its
  own, for example under another npm version, and counting that as the user's edit would turn off one click for good
  after one such rewrite. The update restores that file (`git checkout -- package-lock.json`) before the fast-forward.
  A user who really changes dependencies changes `package.json` too, and that still counts.
- The current branch can fast-forward to the release tag: `HEAD` is an ancestor of the tag.

The hand-run commands depend on why one click can't work (designer's call):

- **Uncommitted changes, or not started by `npm start`:** `git fetch --tags`, `git merge --ff-only v<version>`,
  `npm install` and `npm start`, written with the user's actual remote and tag. With uncommitted changes, the dialog
  says to commit or set them aside first.
- **The branch has commits of its own** (a customised clone or a fork): a fast-forward can't work, so the dialog says
  so and suggests `git merge v<version>` (a real merge, which may need conflicts resolved), then `npm install` and
  `npm start`.

**The click:**

1. The dialog confirms the restart.
2. The app quits the normal way, so sessions are recorded and come back at the next start, as after Quit. It exits
   with a code that means "update to `v<version>`". The tag can travel in the exit code plus a small file in the data
   folder, or similar (builder's call).
3. `start.mjs` sees that code. With Mainframe closed, so Windows has no files locked, it fetches the tag, fast-forwards
   to it and runs `npm install`.
4. It then starts the updated Mainframe by running the updated `scripts/start.mjs preview` again, which builds and
   launches it, and exits with that run's code.

**When it fails:**

- **The fast-forward fails:** nothing has changed. `start.mjs` starts the same version again, and Mainframe says the
  update failed and shows the commands.
- **`npm install` fails after the fast-forward:** `start.mjs` prints what failed and the commands to finish by hand,
  then tries to start Mainframe anyway. If that start fails too, the terminal output is where the user finds out what
  to do, so the message must be plain.

### Releases (the owner's side)

**Notes:** `CHANGELOG.md` at the repo root, starting with an `## Unreleased` section. Each change users would notice
adds one line there as it merges, starting with `New:` or `Fixed:` (other lines are allowed). This repo's `CLAUDE.md`
gets a rule asking sessions to add that line as part of merging. That rule is the owner's workflow, not the product.

**`npm run release`** (`scripts/release.mjs`):

1. Refuses when `## Unreleased` is empty, the folder has uncommitted changes, or the branch is behind **or ahead of**
   its upstream (designer's call). The review gate (`.claude/hooks/code-review-gate.sh`) reads command text, so it
   never sees a push made inside `npm run release`. Refusing when ahead means the script only ever pushes its own
   Markdown commit and tag; any code goes up first through a normal, gated `git push`.
2. Picks the next version from the newest release tag: a minor bump when any Unreleased line starts with `New:`,
   otherwise a patch bump. With no tag yet, `0.1.0`. `npm run release -- <x.y.z>` sets it explicitly, and must be
   higher than the newest tag.
3. Prints the version and the notes, and asks to confirm. `--yes` skips the question, for a session running it.
4. Renames `## Unreleased` to `## <version> · <date>` and puts a fresh empty `## Unreleased` above it. Commits that
   change alone (Markdown only), tags it `v<version>` (annotated), and pushes the branch and the tag to the upstream
   remote.
5. If `gh` is installed and the remote is on GitHub, creates a GitHub Release for the tag with the same notes.
   Otherwise it skips this step and says so.

The script names no branch or remote. It works on the current branch and its upstream.

### README

- A short "Updating" section: the pill, Check for Updates…, and the commands for a hand update.
- One line for people who cloned before this feature: `git pull` once to get it.
- A "Releasing" note under "Develop" for whoever maintains a fork.

## Known limits

- A user on a fork gets releases from their fork's remote, not from the original repo. That's deliberate: the clone's
  own remote is the source.
- A user whose branch has commits of its own can't fast-forward, and is told to merge the release themselves.
- Parallel branches each adding a line under `## Unreleased` will conflict in `CHANGELOG.md`. A `merge=union` entry in
  `.gitattributes` for that file avoids it (builder's call).
- Electron's own download on `npm install` after an Electron bump can take a while. `start.mjs` should say it's
  updating so the terminal doesn't look stuck.

## Left to the builder

- The exact exit code and how the tag reaches `start.mjs`.
- The check interval (about 6 hours) and the first check's delay.
- Where the update logic lives in `src/main`, its IPC names, and how the renderer store holds the state.
- The pill's and dialog's look, within the sketches above and the app's existing style.
- The wording of messages, in the README's plain style.
