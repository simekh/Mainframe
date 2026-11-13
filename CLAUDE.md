# Mainframe: project rules

## Mainframe is project-agnostic: built for other people's projects (since 2026-11-07)

Mainframe runs several Claude Code sessions across whatever project the user points it at. It is meant to be published on GitHub, so friends can run it on their own projects. Build the product for them, not for the owner's machine or the owner's projects.

- **The product knows no particular project.** Code, prompts, defaults, UI copy and user-facing docs name no project, path, branch (`main`), language, test command or folder layout. What is specific to a project comes from that project's folder (its `CLAUDE.md`, its git, its `.claude/`) or from a setting, never from Mainframe.
- **No default is the owner's value.** A setting that is missing is an error, or a question to the user, never a path or name from the owner's machine.
- **Don't assume the owner's tooling.** Superpowers, GSD, the `/simplify` and `/code-review` gate and the `docs/superpowers/` layout are how Mainframe itself is developed. A prompt Mainframe sends (the manager's role, a task's opening prompt) must work in a project with none of them: it defers to "this repo's `CLAUDE.md`" and names no skill or plugin.
- **The owner's setup lives in the repo's workflow files, not the product.** This `CLAUDE.md`, `.claude/` and `docs/` may be the owner's. `src/` and `e2e/` may not, and neither may anything a user's machine ends up running or showing.
- **One question for every change:** would this work unchanged for a friend whose project is in another language, has a `master` branch, and has none of these plugins installed? Task reviews ask it, and a no is an Important finding.

**Why:** the owner decided 2026-11-07 to publish Mainframe for friends to use on their own projects. A value that works only on the owner's machine is a bug the owner cannot see, because it works for them. Fixing each one after a friend hits it costs more than not writing it.

## Mainframe runs several projects at once, in one window (since 2026-11-07)

One Mainframe, one window, several projects open at the same time (Damela and Word², say), each with its own board, tasks and manager. The owner switches between them from a list of projects, or shows several at once: side by side with dividers they drag to resize, or as smaller panes in a grid. Not one copy of Mainframe per project, and not one window per project.

- **How the code does it.** `projects.json` in the data folder lists the open projects; Open Project… adds one without a restart, and closing one ends its sessions as Quit does. Main keeps one `TaskService`, `ManagerService` and MCP server per project in a `ProjectRegistry`, all sharing one `state.json` through `TaskRecords`. Every task and manager IPC call and event names its project by its folder; the renderer keeps each project's store apart and gives each pane its project through `ProjectContext`.
- **No change adds a one-project assumption.** No single global "the project" that code reaches for instead of being handed its project; no file in the data folder that only one project can use; no menu item, shortcut or IPC message that only makes sense with one project on screen; no MCP tool or session that can't tell which project it belongs to; no width taken from the window where a pane's is meant.
- **One question for every change:** would this still work with Damela and Word² both open, side by side? Task reviews ask it, and a no is an Important finding.

**Why:** the owner wants to work on several projects at once without juggling apps. On 2026-11-07 they chose one Mainframe with all projects in one window over a copy per project: one Dock icon, one Quit that ends and later restores every session, and one place that can show what every project needs from them. Each one-project assumption added now is one the multi-project branch has to find and take out.

## Keep code in proportion to what it does

- **Task reviews judge proportion.** Each task review asks whether the code is the simplest thing that meets the requirement. A diff much larger than its requirement is an Important finding. The exception is when the size buys real safety, and the review then names what that safety is.
- **`/simplify` is for size, `/code-review` is for bugs.** Both run on the whole branch, at the two points below. Don't add extra `/code-review high` runs to catch oversized code.

## When `/simplify` and `/code-review high` run (since 2026-11-07)

1. **`/simplify` before the final review.** After a plan's last code task, before its final whole-branch review: Skill tool, skill `simplify`, args `main...HEAD` (with no target it may only see uncommitted changes). Check its edits: undo any that change behaviour or reach outside the lines the branch changed (dead code elsewhere is pointed out, not removed). Run the unit tests, the typecheck and the e2e suite, commit, then record the tip in `.git/claude-simplified`.
2. **`/code-review high` before the owner's acceptance.** After the final review's fixes, and before any push: Skill tool, skill `code-review`, args `high main...HEAD`. Fix what it finds, run the three suites, commit, then record the tip in both `.git/claude-reviewed` and `.git/claude-simplified`. The owner then tries the code that will merge.
3. **Acceptance fixes are new work.** Run `/simplify`, then `/code-review high`, on the branch again, and have the owner re-check what those fixes and runs touched, before the merge/PR menu in `superpowers:finishing-a-development-branch`.

A branch without a plan (a fix, a config tweak) gets both once its work is done and its tests pass, `/simplify` first, before the owner tries it and before the menu.

- **One run of each per branch.** Commits that only fix the `/code-review` run's findings count as covered by both runs. Don't re-run after each round of fixes: every high run finds something new, so that never ends. Run both again, `/simplify` first, only when the branch gets new work beyond those fixes.
- **No skipping small diffs.** A config tweak or dependency bump gets both runs; they find nothing quickly. Record a tip without a run only when the owner says to skip it. Markdown-only commits need neither.
- **Never add a project skill named `simplify`:** Claude Code then runs it before every commit.

**Why:** the superpowers reviewers grade each diff against the plan, scoped to the task, on a cheaper model. `/code-review` hunts correctness bugs without the plan and finds issues they pass. `/simplify` before the final review lets that review judge proportion on the simplified code; `/code-review` before acceptance means the owner's hands-on checks run on the code that merges, as both tools change code. Same rule as Damela, Word² and SmasHit (decided there 2026-10-28 and 2026-11-06).

### The gate

`.claude/hooks/code-review-gate.sh`, registered in `.claude/settings.local.json`, is the backstop. It denies Claude's `git push`, and `git merge` or `pull` into `main`, while non-Markdown commits are not covered by a tip recorded in both files. Record a tip only after its run, or after the fixes for that review's findings (and nothing else) have landed on top of it.

- It reads the command text before the shell runs it. Write literal absolute paths (no `$VAR`, no `~`), run `git commit` and `git push` as separate commands, and run git directly (not through `bash -c`, `eval`, `xargs` or `sudo`).
- A merge commit with changes of its own (a conflict resolution) needs a review. For a merge, commits already on `origin/main` pass.
- It covers a `diag-*` branch's push too: its commits need both runs, or the owner's waiver for that branch.
- The registration has `"onFailure": "block"`: a gate that crashes or times out blocks the command.
- This file and `.claude/hooks` are in git (re-included in `.gitignore` past the owner's global ignore). `.claude/settings.local.json` stays local: it registers the gate, which needs this machine's `.git/claude-*` records. Another machine registers it the same way, as a PreToolUse hook on `Bash` that runs the script with `"onFailure": "block"`.
- When this folder is on a branch without the script, the registration blocks the Bash commands that mention push, merge or pull. A merge that brings the script in runs as one command from a branch that has it: `git -C <repo> checkout main && git -C <repo> merge <branch>`.
- The script is an identical copy of Damela's, Word²'s and SmasHit's: change all four together. Tests: `bash .claude/hooks/code-review-gate.test.sh` (throwaway repo); run them after any change.

## Troubleshooting Windows or Linux: a narrowed CI run (since 2026-11-13)

This Mac can't run Windows, so a Windows-only failure is checked on CI. Don't wait on a full run of all three systems to see one test: run only that system and those tests by hand (how: the comment at the top of `.github/workflows/test.yml`).

- Find your run with `gh run list --workflow test.yml --event workflow_dispatch --branch <branch> -L 1`, a few seconds after starting it: the run appears a moment later, and other sessions start runs too. Check its start time, then `gh run watch <id> --exit-status`.
- Put throwaway diagnostics (logging, probe tests) on a branch named `diag-*`: pushing it runs nothing, so only the narrowed run you start goes. Never open a pull request from it (that runs everything); delete it once CI has answered.

**Why:** on 2026-11-13 three Windows-only failures took a full CI run (10-12 minutes) per attempt to diagnose. The owner asked for quicker loops; a Windows VM on this Mac was weighed and left for later.
