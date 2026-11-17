# App updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mainframe tells users when the owner has made a newer release, shows its notes, and updates in one click; the owner makes a release with `npm run release`.

**Architecture:** A release is a `v<x.y.z>` git tag plus a `CHANGELOG.md` section. Main's `UpdateService` reads the
clone's own tags and remote with `git` (never interactive) and sends an `UpdateView` to the renderer, which shows a
pill by the settings cog and a dialog. An update makes the app quit with exit code 75 after writing the tag to a file
`scripts/start.mjs` named; `start.mjs` then fast-forwards, runs `npm install` and starts the new version.

**Tech Stack:** Electron 44, TypeScript, Solid, vitest, Playwright, plain Node `.mjs` scripts.

**Spec:** `docs/superpowers/specs/2026-11-17-mainframe-app-updates-design.md`

## Global Constraints

- Only plain `MAJOR.MINOR.PATCH` tags prefixed `v` count as releases; pre-release tags are ignored.
- `package.json`'s `version` is never read or changed.
- The release source is the clone's own remote: the current branch's upstream remote, else `origin`. No URL, account,
  branch name or remote name other than that fallback appears in `src/`, `scripts/` or `e2e/`.
- Every git call that talks to a remote runs with `-c credential.interactive=false`, the `NO_PROMPTS` env from
  `src/main/git.ts` and a 30 s timeout. A failure is "couldn't check", never a prompt.
- Automatic checks: the first 10 s after the projects start, then every 6 h. None when `ELECTRON_RENDERER_URL` is set
  (`npm run dev`), and none in e2e unless `MAINFRAME_E2E_UPDATE_DIR` is set.
- Exit code `75` means "update"; the tag travels in the file named by `MAINFRAME_UPDATE_FILE`, which only
  `start.mjs` sets. Its presence is also what makes one click possible.
- A diff of `package-lock.json` alone (with `package.json` unchanged) is not an uncommitted change; the update restores
  that file before fast-forwarding.
- Copy, exactly: menu and button **Check for Updates…**; pill **Update available**; dialog title
  **Mainframe <latest> is available**; up to date **Mainframe is up to date (<version>)**; restart line **Updating
  restarts Mainframe. Your sessions stop and come back, as after Quit.**; buttons **Later** and **Update**. A clone
  with no release tag shows its version as **unreleased**.
- Multi-project: one pill and one dialog for the window, never per pane.

## Review Focus

1. **A user who cloned between releases** (`HEAD` ahead of the newest tag): up to date, no pill. Test in Task 2.
2. **A remote that can't be reached or asks for a password** (no network, SSH key with passphrase): an automatic check
   is silent, a manual one says "couldn't check", nothing hangs. Test in Task 2 (unreachable remote rejects within the
   timeout) and Task 3 (failure leaves `available` unchanged and returns `failed`).
3. **`npm install` rewrote only `package-lock.json`**: still one click, and the update restores the file. Tests in
   Task 2 and Task 5.
4. **The fast-forward fails at restart** (e.g. a commit made after the dialog opened): nothing changes, the old version
   starts, and the app shows the failure with the commands. Tests in Task 5 and Task 3.
5. **A release tag whose `CHANGELOG.md` lacks a section for it** (or has none at all): the dialog still offers the
   update, with notes reading "No notes for this release." Test in Task 1.

---

### Task 1: Versions and changelog sections

**Files:**
- Create: `src/main/updates/versions.ts`
- Test: `src/main/updates/versions.test.ts`

**Interfaces:**
- Produces:
  - `type Version = [number, number, number]`
  - `parseTag(tag: string): Version | null` — `'v1.2.3'` → `[1,2,3]`; anything else (`'v1.2'`, `'v1.2.3-beta.1'`, `'1.2.3'`) → null
  - `compareVersions(a: Version, b: Version): number`
  - `formatVersion(v: Version): string` — `'1.2.3'`
  - `newestRelease(tags: string[]): Version | null`
  - `notesSince(changelog: string | null, current: Version | null, latest: Version): string` — the Markdown of every
    `## <x.y.z> · <date>` section with `current < x.y.z <= latest`, newest first, each keeping its heading; `'No notes for this release.'` when none match

- [ ] **Step 1: Write the failing tests** in `versions.test.ts`:
  - `parseTag` accepts `v0.1.0`, `v10.20.30`; rejects `v1.2`, `v1.2.3-beta.1`, `1.2.3`, `vx.y.z`.
  - `newestRelease(['v0.9.0','v0.10.0','v1.0.0-rc.1','junk'])` → `[0,10,0]`; `newestRelease([])` → null.
  - `notesSince` with a changelog holding `## Unreleased`, `## 0.5.0 · 17 Nov 2026`, `## 0.4.1 · 10 Nov 2026`,
    `## 0.4.0 · 1 Nov 2026`, current `[0,4,0]`, latest `[0,5,0]` → contains the 0.5.0 and 0.4.1 sections in that order,
    and neither `Unreleased` nor `0.4.0`.
  - `notesSince(null, null, [0,1,0])` and a changelog with no matching section → `'No notes for this release.'`
  - `notesSince` with current null → every section up to latest.

- [ ] **Step 2: Run** `npx vitest run src/main/updates/versions.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `versions.ts`. Split the changelog on lines starting `## `; a heading's version is its first
  `\d+\.\d+\.\d+`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(updates): versions and changelog sections`.

### Task 2: Git queries for updates

**Files:**
- Modify: `src/main/git.ts` (export the existing `git` helper as `runGit` and `NO_PROMPTS`; no behaviour change)
- Create: `src/main/updates/updateGit.ts`
- Test: `src/main/updates/updateGit.test.ts` (uses `src/main/testing/makeRepo.ts`)

**Interfaces:**
- Consumes: Task 1's `parseTag`, `newestRelease`, `formatVersion`, `Version`.
- Produces (all take the Mainframe clone's folder `dir`):
  - `runningVersion(dir): Promise<Version | null>` — newest release tag merged into `HEAD` (`git tag --merged HEAD --list 'v*'`)
  - `releaseRemote(dir): Promise<string | null>` — `branch.<current>.remote`, else `origin` if it exists, else null
  - `remoteNewest(dir, remote): Promise<Version | null>` — from `git ls-remote --tags --refs <remote>`; rejects on failure
  - `changelogAt(dir, remote, tag): Promise<string | null>` — fetches `refs/tags/<tag>:refs/tags/<tag>`, then `git show <tag>:CHANGELOG.md`; null when the file isn't there; rejects when the fetch fails
  - `type ByHandWhy = 'not-launcher' | 'uncommitted' | 'own-commits'`
  - `type UpdateHow = { kind: 'one-click' } | { kind: 'by-hand'; why: ByHandWhy; commands: string[] }` (put both in `src/shared/types.ts`, Task 3 needs them there)
  - `howToUpdate(dir, remote, tag, launcher: boolean): Promise<UpdateHow>`
  - `onlyLockfileChanged(porcelain: string): boolean` — true when the only line of `git status --porcelain --untracked-files=no` is `package-lock.json` (Task 5 has its own `.mjs` copy; scripts can't import `src/`)

- [ ] **Step 1: Write the failing tests.** Build a clone with `makeRepo`, tag and push from it, and a second clone as "the user":
  - `runningVersion`: no tags → null; tags `v0.1.0`, `v0.2.0`, `v0.3.0-beta.1` reachable → `[0,2,0]`; a commit after `v0.2.0` → still `[0,2,0]` (Review Focus 1).
  - `releaseRemote`: a clone tracking `origin` → `'origin'`; a repo with no remotes → null.
  - `remoteNewest`: sees `v0.3.0` pushed after the user cloned; rejects within the timeout for a remote set to a path that doesn't exist (Review Focus 2).
  - `changelogAt`: returns the file's text at the tag; null when the tag has no `CHANGELOG.md`.
  - `howToUpdate`:
    - clean, behind → `{kind:'one-click'}` when `launcher`, `{kind:'by-hand', why:'not-launcher'}` when not;
    - `README.md` edited → `why:'uncommitted'`;
    - only `package-lock.json` edited → one-click (Review Focus 3); `package.json` and lock edited → `uncommitted`;
    - a local commit not on the tag → `why:'own-commits'`, whose commands contain `git merge v0.3.0` and not `--ff-only`;
    - `not-launcher`/`uncommitted` commands are exactly `git fetch <remote> tag v0.3.0`, `git merge --ff-only v0.3.0`, `npm install`, `npm start`.
- [ ] **Step 2: Run** `npx vitest run src/main/updates/updateGit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remote-talking calls follow Global Constraints. `howToUpdate` order: own commits
  (`git merge-base --is-ancestor HEAD <tag>` false, after the tag is fetched) → uncommitted
  (`git status --porcelain --untracked-files=no` minus a lone lockfile) → launcher → one-click.
- [ ] **Step 4: Run** the test file and `npx vitest run src/main/git.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(updates): git queries for the running version, the remote's releases and how to update`.

### Task 3: UpdateService, IPC and main wiring

**Files:**
- Create: `src/main/updates/updateService.ts`, `src/main/updates/updateService.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/config.ts`
  (+ its test), `src/main/menu.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: Task 2's functions, Task 1's `formatVersion`/`notesSince`.
- Produces, in `src/shared/types.ts`:
  ```ts
  export interface UpdateAvailable { latest: string; notes: string; how: UpdateHow }
  export interface UpdateView { current: string | null; available: UpdateAvailable | null; failure: string | null }
  export type CheckResult = { kind: 'available' } | { kind: 'up-to-date' } | { kind: 'failed'; why: string };
  ```
- IPC (`IPC` keys / `MainframeApi`): `getUpdate(): Promise<UpdateView>`, `onUpdate(cb)`, `checkForUpdates(): Promise<CheckResult>`,
  `installUpdate(): Promise<void>`, `onCheckForUpdates(cb)` (main → page, the Mac menu item).
- `class UpdateService` with `constructor(deps: { dir: string; launcherFile: string | undefined; failure: string | undefined; onChange(view: UpdateView): void; requestQuit(): void })`,
  `view(): UpdateView`, `check(): Promise<CheckResult>`, `install(): Promise<void>`, `start(): void` (timers), `stop(): void`.
- `AppConfig` gains `updateDir?: string` (from `MAINFRAME_E2E_UPDATE_DIR`, only when `e2e`), `launcherFile?: string`
  (`MAINFRAME_UPDATE_FILE`), `updateFailure?: string` (`MAINFRAME_UPDATE_FAILED`).
- `UPDATE_EXIT_CODE = 75` exported from `updateService.ts`.

- [ ] **Step 1: Write the failing tests** in `updateService.test.ts`, with `vi.mock('./updateGit')`:
  - `check()` with remote newest > running → `{kind:'available'}`, `view().available.latest === '0.5.0'`, notes from `notesSince`, `onChange` called once.
  - remote newest == running, or running ahead → `{kind:'up-to-date'}`, `available` null.
  - `remoteNewest` rejects → `{kind:'failed', why}`; a previously known `available` stays (Review Focus 2). No remote → `failed` with why `"This copy of Mainframe has no git remote to check."`.
  - `install()` when `how` is one-click writes `v0.5.0` to `launcherFile` and calls `requestQuit`; when by-hand it throws and writes nothing.
  - `failure` from deps shows in `view().failure` (Review Focus 4).
  - `start()` with fake timers: first check at 10 000 ms, next at 6 h; `stop()` clears them.
  - `loadConfig` test: `MAINFRAME_E2E_UPDATE_DIR` ignored without `MAINFRAME_E2E=1`.
- [ ] **Step 2: Run** `npx vitest run src/main/updates src/main/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the service, config, IPC, preload.** `install()` re-runs `howToUpdate` before writing, so a commit made after the check is caught.
- [ ] **Step 4: Wire `src/main/index.ts`:**
  - In `start()`: create the service with `dir = config.updateDir ?? app.getAppPath()`; call `start()` unless `ELECTRON_RENDERER_URL` is set or (`config.e2e` and no `updateDir`). The IPC calls still answer in those cases (Settings shows the version; a manual check works).
  - `requestQuit` sets a flag and calls `app.quit()`; the `will-quit` handler's final step calls `app.exit(UPDATE_EXIT_CODE)` in place of `app.quit()` when the flag is set, so sessions are recorded and ended as on Quit.
  - `menu.ts`: `buildMenu` takes `checkForUpdates?: () => void`; item `{ id: 'check-for-updates', label: 'Check for Updates…' }` right after `about`, disabled without it. `start()` passes `() => toWindow(IPC.checkForUpdates, null)`.
  - `app.setAboutPanelOptions({ applicationVersion: <version or 'unreleased'> })` once `runningVersion` answers.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(updates): the update check in main, its IPC and Check for Updates… in the Mac menu`.

### Task 4: The pill, the dialog and Settings' version line

**Files:**
- Create: `src/renderer/src/updates/updateStore.ts`, `src/renderer/src/updates/UpdatePill.tsx`, `src/renderer/src/updates/UpdateDialog.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/projects/ProjectPane.tsx` (pill right before each `<SettingsButton />`),
  `src/renderer/src/settings/SettingsDialog.tsx` (a row: `Version <current>` and a **Check for Updates…** button), `src/renderer/src/app.css`
- Test: `e2e/updates.e2e.ts`

**Interfaces:**
- Consumes: Task 3's `UpdateView`, `CheckResult`, IPC.
- Produces: `updateView()`, `showUpdateDialog(result?: CheckResult)`, `checkNow(): Promise<void>` (calls `checkForUpdates`, then opens the dialog with the result) in `updateStore.ts`.

The dialog has three faces: available (title, "You have <current>.", notes rendered with the existing
`src/renderer/src/todo/MarkdownView.tsx`, the restart line, **Later** / **Update**, or the by-hand commands in a `<pre>` with a
line per `why`: not-launcher "Mainframe wasn't started with `npm start`, so it can't restart itself.", uncommitted
"This copy has changes of its own. Commit or set them aside, then:", own-commits "This copy's branch has commits of
its own, so merge the release yourself:"), up to date, and failed ("Couldn't check for updates: <why>"). A non-null
`failure` opens it at start with "The update didn't finish: <failure>" and the commands. Follow
`frontend-design:frontend-design` for the look, within the spec's sketches and the app's existing dialog style
(`nt-dialog`).

- [ ] **Step 1: Write the failing e2e tests** in `e2e/updates.e2e.ts`, each launching with `MAINFRAME_E2E_UPDATE_DIR` pointing at a user clone built as in Task 2 (helper in the test file):
  - behind a release `v0.2.0` whose `CHANGELOG.md` has a `## 0.2.0 · …` section with "New: thing" → the pill `update-pill` appears next to `settings-open` within 15 s; with two projects side by side there is exactly one pill; clicking it shows "Mainframe 0.2.0 is available", "New: thing" and **Update** is absent with the "wasn't started with `npm start`" line (no launcher in e2e).
  - up to date → Settings shows `Version 0.2.0`; **Check for Updates…** shows "Mainframe is up to date (0.2.0)".
  - a clone whose remote path doesn't exist → no pill; **Check for Updates…** shows "Couldn't check for updates".
  - `MAINFRAME_UPDATE_FAILED=boom` → the dialog is open at start with "The update didn't finish: boom".
- [ ] **Step 2: Run** `npx electron-vite build && npx playwright test e2e/updates.e2e.ts`. Expected: FAIL. (Ask the owner to quit their own Mainframe before any e2e run.)
- [ ] **Step 3: Implement** the store, pill, dialog and Settings row.
- [ ] **Step 4: Run** the e2e file, `e2e/top-row.e2e.ts`, `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(updates): the Update available pill, its dialog and the version in Settings`.

### Task 5: The restart in `start.mjs`

**Files:**
- Create: `scripts/applyUpdate.mjs`, `scripts/applyUpdate.test.mjs`
- Modify: `scripts/start.mjs`, `README.md` (an "Updating" section after "Run it": the pill, Check for Updates…, the
  hand-run commands, and one line: "Cloned before updates came in? Run `git pull` once.")

**Interfaces:**
- Produces: `applyUpdate(dir: string, tag: string, run: (cmd: string, args: string[]) => { status: number | null }): { ok: true } | { ok: false; stage: 'fetch' | 'merge' | 'install'; message: string }`
  - Steps: if only `package-lock.json` is modified, `git checkout -- package-lock.json`; `git fetch <remote> refs/tags/<tag>:refs/tags/<tag>` (remote as in Task 2); `git merge --ff-only <tag>`; `npm install`.

- [ ] **Step 1: Write the failing tests** with real temp repos and a `run` that runs git for real but records `npm`:
  - behind `v0.2.0` → `{ok:true}`, `HEAD` is the tag, `npm install` was run once.
  - lockfile-only change → restored and fast-forwarded (Review Focus 3).
  - a local commit → `{ok:false, stage:'merge'}`, `HEAD` unchanged, npm not run (Review Focus 4).
  - npm fails → `{ok:false, stage:'install'}`, `HEAD` is the tag.
- [ ] **Step 2: Run** `npx vitest run scripts/applyUpdate.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `applyUpdate.mjs`, and in `start.mjs` for `preview` only:
  - make a file path in `os.tmpdir()` and pass it as `MAINFRAME_UPDATE_FILE` to the child;
  - on exit code 75: read the tag, print `Updating Mainframe to <tag>…`, call `applyUpdate`, then re-run `node scripts/start.mjs preview ...passOn` with `spawnSync` (stdio inherit) and exit with its status. On any failure, first print the message (and at `install`, the commands `npm install` then `npm start`), and pass `MAINFRAME_UPDATE_FAILED=<message>` to the re-run so the app shows it;
  - on Windows run `npm.cmd` with `shell: true` (as npm requires there).
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then by hand on this Mac: a throwaway clone with a local bare remote, `npm start`, tag a newer release in the remote, Check for Updates…, Update; Mainframe comes back on the new tag.
- [ ] **Step 5: Commit** `feat(updates): npm start applies an update and restarts Mainframe`.

### Task 6: `npm run release`, the changelog and the notes rule

**Files:**
- Create: `scripts/release.mjs`, `scripts/release.test.mjs`, `CHANGELOG.md` (`# Changelog`, then `## Unreleased` with a
  `New: Mainframe tells you when there's a new release, and updates in one click.` line), `.gitattributes`
  (`CHANGELOG.md merge=union`)
- Modify: `package.json` (`"release": "node scripts/release.mjs"`), `README.md` ("Releasing" under "Develop", for whoever
  maintains a fork), `CLAUDE.md` (a section: each change users would notice adds one `New:` or `Fixed:` line under
  `## Unreleased` in `CHANGELOG.md` as it merges)

**Interfaces:**
- Produces (pure, exported for tests): `nextVersion(newestTag: string | null, unreleased: string, explicit?: string): string`,
  `cutRelease(changelog: string, version: string, date: string): { changelog: string; notes: string }`, `unreleasedNotes(changelog: string): string`.
  Its own small `v<x.y.z>` parser (scripts can't import `src/`).

- [ ] **Step 1: Write the failing tests:**
  - `nextVersion(null, 'Fixed: x')` → `'0.1.0'`; `('v0.4.0', 'New: x\nFixed: y')` → `'0.5.0'`; `('v0.4.0', 'Fixed: y')` → `'0.4.1'`; `('v0.4.0', 'Fixed: y', '1.0.0')` → `'1.0.0'`; explicit `'0.3.0'` or `'1.0'` throws.
  - `cutRelease` renames `## Unreleased` to `## 0.5.0 · 17 Nov 2026`, puts an empty `## Unreleased` above, and returns the section's lines as `notes`.
  - `unreleasedNotes` of an empty section → `''`.
  - The script end to end on temp repos (spawn `node scripts/release.mjs --yes` with `cwd` in a clone): refuses with empty Unreleased, with uncommitted changes, when behind, when ahead; otherwise creates a Markdown-only commit, an annotated tag `v0.1.0`, and both are on the remote. `gh` absent from `PATH` → prints that it skipped the GitHub Release.
- [ ] **Step 2: Run** `npx vitest run scripts/release.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `release.mjs`: checks (`git status --porcelain`, `git rev-list --left-right --count @{upstream}...HEAD` after `git fetch`), prints version and notes, asks `Release <version>? [y/N]` unless `--yes`, writes, commits `Release <version>`, `git tag -a v<version> -m "Mainframe <version>"`, `git push <remote> HEAD v<version>`; then `gh release create v<version> --title <version> --notes-file -` when `gh` is on PATH and the remote URL contains `github.com`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(updates): npm run release, CHANGELOG.md and the notes rule`.
