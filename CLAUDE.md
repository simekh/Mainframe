# Mainframe: project rules

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
- The registration has `"onFailure": "block"`: a gate that crashes or times out blocks the command.
- This file and `.claude/hooks` are in git (re-included in `.gitignore` past the owner's global ignore). `.claude/settings.local.json` stays local: it registers the gate, which needs this machine's `.git/claude-*` records. Another machine registers it the same way, as a PreToolUse hook on `Bash` that runs the script with `"onFailure": "block"`.
- When this folder is on a branch without the script, the registration blocks the Bash commands that mention push, merge or pull. A merge that brings the script in runs as one command from a branch that has it: `git -C <repo> checkout main && git -C <repo> merge <branch>`.
- The script is an identical copy of Damela's, Word²'s and SmasHit's: change all four together. Tests: `bash .claude/hooks/code-review-gate.test.sh` (throwaway repo); run them after any change.
