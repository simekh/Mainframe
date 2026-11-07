#!/usr/bin/env bash
# Tests for code-review-gate.sh. Builds a throwaway repo with a bare remote, then feeds the hook
# Bash tool calls as JSON and checks each decision. Usage: bash code-review-gate.test.sh [hook]
set -u
hook=${1:-"$(dirname "$0")/code-review-gate.sh"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
r=$tmp/repo
g() { git -C "$r" "$@"; }
commit() { printf '%s\n' "$2" >"$r/$1" && g add "$1" && g commit -q -m "$3"; }

git init -q --bare "$tmp/remote.git"
git init -q -b main "$r"
g config user.email test@example.com && g config user.name test && g config advice.detachedHead false
commit app.txt base "Base"
g remote add origin "$tmp/remote.git"
g push -q origin main
g branch stage && g push -q -u origin stage
record() { g rev-parse HEAD >>"$r/.git/claude-$1"; }
both() { record simplified && record reviewed; }

# reviewed: code, its tip recorded by /simplify and /code-review. unreviewed: code. docs: Markdown only.
g switch -q -c reviewed stage && commit app.txt reviewed "Reviewed change" && both
g push -q origin reviewed
g switch -q -c unreviewed stage && commit other.txt unreviewed "Unreviewed change"
g switch -q -c docs stage && commit README.md docs "Docs only"
# Only one of the two runs recorded; and a /code-review fix on top of a /simplify run, recorded in both.
g switch -q -c reviewonly stage && commit ro.txt ro "Reviewed, not simplified" && record reviewed
g switch -q -c simplifyonly stage && commit so.txt so "Simplified, not reviewed" && record simplified
g switch -q -c reviewfix stage && commit rf.txt rf "Simplified" && record simplified &&
  commit rf.txt fixed "Fix from the review" && both
g switch -q -c latefix reviewfix~1 && commit rf.txt late "Review fix not recorded for /simplify" && record reviewed
g switch -q -c fixpending reviewfix~1 && commit rf.txt pending "Review fix, nothing recorded yet"
# An urgent fix on the remote main that never passed the gate.
g switch -q main && commit fix.txt fix "Urgent fix" && g push -q origin main
# A nested remote branch whose name ends in /main.
g switch -q -c feature/main stage && commit nested.txt nested "Nested" && g push -q origin feature/main
# Merge commits on top of the reviewed work: clean, with an extra code edit, with an extra Markdown edit.
g switch -q -c cleanmerge stage && commit side.txt side "Side change" && both
g merge -q --no-ff -m "Clean merge" reviewed
g switch -q -c evilmerge cleanmerge~1 && g merge -q --no-ff --no-commit reviewed >/dev/null 2>&1 && printf 'sneaky\n' >>"$r/side.txt" &&
  g add side.txt && g commit -q -m "Merge with an unreviewed edit"
g switch -q -c docmerge cleanmerge~1 && g merge -q --no-ff --no-commit reviewed >/dev/null 2>&1 && printf 'note\n' >"$r/NOTES.md" &&
  g add NOTES.md && g commit -q -m "Merge with a Markdown edit"
g switch -q -c f stage
# A second clone where the push of its own branch "unreviewed" (just the remote stage) passes, to catch
# a check made in the wrong folder.
c=$tmp/clean
git clone -q -b stage "$tmp/remote.git" "$c" && git -C "$c" branch -q unreviewed origin/stage

pass=0
fail=0
hook_out() { jq -n --arg d "$1" --arg c "$2" '{tool_input: {command: $c}, cwd: $d}' | bash "$hook"; } # hook_out <dir> <command>
decide_in() {
  local out
  out=$(hook_out "$1" "$2")
  if [[ -z $out ]]; then echo allow; else jq -r '.hookSpecificOutput.permissionDecision' <<<"$out"; fi
}
decide() { decide_in "$r" "$1"; }
expect_in() { # expect_in <dir> <allow|deny> <command> <what it shows>
  local got
  got=$(decide_in "$1" "$3")
  if [[ $got == "$2" ]]; then ((pass++)); else ((fail++)); echo "FAIL: $4: expected $2, got $got ($3)"; fi
}
expect() { # expect <allow|deny> <command> <what it shows>
  local got
  got=$(decide "$2")
  if [[ $got == "$1" ]]; then ((pass++)); else ((fail++)); echo "FAIL: $3: expected $1, got $got ($2)"; fi
}
on() { g switch -q "$@"; }
expect_reason() { # expect_reason <command> <text the reason holds> <what it shows>
  local out
  out=$(hook_out "$r" "$1" | jq -r '.hookSpecificOutput.permissionDecisionReason')
  if [[ $out == *"$2"* ]]; then ((pass++)); else ((fail++)); echo "FAIL: $3: the reason lacks '$2' ($1)"; fi
}

# Both /simplify and /code-review have to cover the work.
on stage
expect deny "git push origin reviewonly" "pushing work /simplify has not covered"
expect deny "git push origin simplifyonly" "pushing work /code-review has not covered"
expect deny "git merge reviewonly" "merging work /simplify has not covered"
expect deny "git merge simplifyonly" "merging work /code-review has not covered"
expect allow "git push origin reviewfix" "a /code-review fix recorded in both, on top of a /simplify run"
expect deny "git push origin latefix" "a /code-review fix recorded for /code-review only"
expect_reason "git push origin reviewonly" "/simplify has not covered" "the reason names the missing /simplify run"
expect_reason "git push origin reviewonly" "claude-simplified" "the reason shows where to record a /simplify run"
expect_reason "git push origin simplifyonly" "/code-review has not covered" "the reason names the missing /code-review run"
expect_reason "git push origin simplifyonly" "/claude-simplified\" >> \"" "a review's fixes are recorded for /simplify too"
expect_reason "git push origin unreviewed" "Run the simplify skill" "the reason says to run /simplify"
expect_reason "git push origin unreviewed" "code-review skill at high effort on the branch" "the reason says to run /code-review on the branch after it"
expect_reason "git push origin unreviewed" "the same 1 commit(s), which /code-review has not covered either" "the reason lists the commits once"
expect deny "git push origin fixpending" "a review's fix with neither record yet"
expect_reason "git push origin fixpending" "/code-review has not covered" "a review's fix: the reason names the review too"
expect_reason "git push origin fixpending" "/claude-simplified\" >> \"" "a review's fix: its record line fills both files"

on stage
expect allow "git merge reviewed" "merging reviewed work into stage"
expect deny "git merge unreviewed" "merging unreviewed work into stage"
expect allow "git merge docs" "merging Markdown-only work"
expect deny "git merge -m 'Merge it' unreviewed" "a merge message does not hide the branch"
expect allow "git merge origin/main" "merging the remote main back into stage"
expect deny "git merge origin/feature/main" "a nested remote branch ending in /main is not trusted"
expect allow "git merge --squash reviewed" "a squash merge of reviewed work"
expect deny "git checkout master && git merge unreviewed" "master is protected too"

on f
expect allow "git merge unreviewed" "merging into a branch that is not protected"
expect allow "git switch -c newb && git merge unreviewed" "merging into a new branch"
expect deny "git checkout stage && git merge unreviewed" "checking out stage first"

on unreviewed
expect deny "git checkout stage && git merge -" "git merge - brings in the previous branch"
on stage && on f
expect deny "git checkout - && git merge unreviewed" "git checkout - goes back to stage"

on stage
expect deny "git fetch origin && git merge origin/reviewed" "a fetch before a merge can move the branch past what was reviewed"
expect deny "git fetch origin x && git merge FETCH_HEAD" "FETCH_HEAD after a fetch"
expect allow "git pull --ff-only && git merge origin/main" "after a fetch, merging the remote main is still trusted"
expect allow "git pull --ff-only" "pulling stage's own upstream"
expect deny "git pull origin unreviewed" "pulling another branch into stage"
expect allow "git pull origin main" "pulling the remote main into stage"
expect allow "git fetch origin && git push origin stage" "a fetch before a push is fine"
expect allow "git remote -v && git merge reviewed" "git remote without update fetches nothing"
expect deny "git -C \$REPO push origin reviewed" "a repo path in a shell variable is not checked blind"
expect deny "cd ~/repo && git merge reviewed" "a ~ path is not checked blind"
expect allow "git -C $r push origin reviewed" "a literal repo path"

expect deny "git push origin unreviewed" "pushing unreviewed work"
expect allow "git push origin docs" "pushing Markdown-only work"
expect allow "git push origin reviewed" "pushing reviewed work"
expect allow "git push origin cleanmerge" "pushing a clean merge of reviewed work"
expect deny "git push origin evilmerge" "pushing a merge commit that adds an unreviewed edit"
expect allow "git push origin docmerge" "pushing a merge commit that adds only Markdown"

# Steps earlier in the same command that move refs the check has already read.
on reviewed
expect deny "git add z.txt && git commit -q -m code && git push origin reviewed" "a commit before a push"
expect deny "git commit -qam code && git push" "a commit before a bare push"
on stage
expect deny "git branch -f reviewed unreviewed && git merge reviewed" "a branch moved before a merge"
expect deny "git reset --hard origin/feature/main && git push origin stage" "a reset before a push"
expect deny "git switch stage && git pull --ff-only && git merge origin/main && git push origin stage" "a push after a merge in the same command"
expect allow "git switch stage && git pull --ff-only && git merge origin/main" "the urgent-fix merge back, without the push"

# What a checkout really leaves checked out.
on stage
expect deny "git checkout app.txt && git merge unreviewed" "checking out a file keeps the branch"
expect deny "git checkout nonexistent; git merge unreviewed" "a checkout that fails keeps the branch"
on f
expect deny "git checkout -t origin/main; git merge unreviewed" "checkout -t origin/main lands on main"
expect deny "git checkout stage && git -C $r/ merge unreviewed" "the same repo written another way"
on unreviewed
expect deny "git checkout stage && git merge @{-1}" "@{-1} is the previous branch"
on stage
expect deny "git checkout unreviewed && git push origin HEAD" "pushing HEAD after a checkout"
expect deny "git switch unreviewed && git push -u origin HEAD" "pushing HEAD after a switch"

# What a push sends.
on stage
expect deny "git push --all origin" "pushing every branch"
expect deny "git push --mirror origin" "mirroring every ref"
expect deny "git push origin 'refs/heads/*:refs/heads/*'" "a glob refspec"
expect deny "git push origin feature/main:stage" "work on another remote branch pushed into stage"
expect allow "git push origin origin/stage:main" "the release: main fast-forwards to stage"
expect allow "git fetch origin && git push origin origin/stage:main" "the release after a fetch"

# What a pull brings in.
on stage
expect deny "git pull fork main" "main from another remote"
expect deny "git pull https://example.com/x.git main" "main from a URL"
expect deny "git pull . main" "the local main"
expect allow "git pull origin refs/heads/main" "the remote main by its full name"
expect allow "git pull -X theirs --depth 1 origin main" "options with values"
expect allow "git fetch origin && git merge --ff-only @{u}" "the upstream after a fetch"

# Git hidden behind another command, or pointed at another repo.
on stage
expect deny "bash -c 'git push origin unreviewed'" "git inside bash -c"
expect deny "command git push origin unreviewed" "git behind command"
expect deny "env GIT_TRACE=0 git push origin unreviewed" "git behind env"
expect_in "$tmp" deny "git --git-dir=$r/.git push origin unreviewed" "git pointed at a repo with --git-dir"
expect deny "gh pr merge 5 --squash" "a PR the gate cannot look up"

# How the command is split into steps.
on stage
expect deny $'git status\ngit push origin unreviewed' "a push on the second line"
expect deny $'git fetch origin  # update\ngit push origin unreviewed' "a push after a comment"
expect deny $'git commit -F - <<\'EOF\'\nDon\'t panic\nEOF\ngit push origin unreviewed' "a push after a here-document"
expect deny "git log --format=%h#%s && git push origin unreviewed" "a # inside a word is not a comment"
expect deny "if git merge unreviewed; then echo ok; fi" "git after if"
expect deny "{ git merge unreviewed; }" "git in braces"
expect deny "echo \"\$(git push origin unreviewed)\"" "git in a quoted \$( )"
expect deny "echo \`git push origin unreviewed\`" "git in backticks"
expect deny "echo 'unclosed && git push origin reviewed" "a command the gate cannot follow"
expect allow "git push origin reviewed 2>&1 | tail -3" "a redirection is not a refspec"
expect allow "git commit -m \"\$(cat <<'EOF'
Merge the \"push\" fix, don't wait
EOF
)\"" "a commit message that mentions push and merge"
expect allow "git branch --contains HEAD && git push origin reviewed" "listing branches moves nothing"

# Refs made, moved or named another way earlier in the same command.
on unreviewed
expect deny "git checkout -b fresh && git push -u origin fresh" "pushing a branch made in the same command"
on stage
expect deny "git tag t1 unreviewed && git push origin t1" "pushing a tag made in the same command"
expect deny "git tag t2 unreviewed && git merge t2" "merging a tag made in the same command"
expect deny "git fetch origin && git push origin FETCH_HEAD:stage" "pushing FETCH_HEAD after a fetch"
on unreviewed && on stage && on f
expect deny "git checkout @{-1} && git merge unreviewed" "checkout @{-1} goes back to stage"
on stage && on f
expect deny "git switch @{-1} && git merge unreviewed" "switch @{-1} goes back to stage"
on unreviewed && on f && on stage
expect deny "git merge @{-2}" "@{-2} without a checkout"

# Shell forms that hide a step or move it to another folder.
on stage
expect deny "echo \$'\\'' ; git push origin unreviewed ; echo \\'" "a push after \$'...' quoting"
expect deny $'cat <<EOF\n$(git push origin unreviewed)\nEOF' "\$( ) in an unquoted here-document"
expect allow $'cat <<\'EOF\'\n$(git push origin unreviewed)\nEOF' "a quoted here-document body is not run"
expect deny "echo \"\$(case x in a) echo hi;; esac)\"; git push origin reviewed" "a case inside \$( )"
expect_in "$c" allow "git push origin unreviewed" "the second clone's push passes"
expect_in "$c" deny "if cd $r; then git push origin unreviewed; fi" "cd after if"
expect_in "$c" deny "{ cd $r; git push origin unreviewed; }" "cd in braces"
expect deny "(cd $c); git push origin unreviewed" "a cd in a subshell stays there"
expect deny "R=\$(cd $c && pwd); git push origin unreviewed" "a cd in \$( ) stays there"
expect deny "time -p git push origin unreviewed" "git after time -p"
expect deny "command -p git merge unreviewed" "git after command -p"
expect deny "sudo git push origin reviewed" "git after a command the gate does not know"
expect deny "git fetch origin reviewed:docs && git push origin docs" "a fetch that moves a local branch"

# A squash commit stays covered when it is rebased onto newer work on the remote stage, not once it
# gets an edit of its own.
on stage
decide "git merge --squash reviewed" >/dev/null # records what the squash commit will hold
g merge -q --squash reviewed >/dev/null && g commit -q -m "Squash reviewed"
git clone -q -b stage "$tmp/remote.git" "$tmp/other"
printf 'late\n' >"$tmp/other/late.txt" && git -C "$tmp/other" add late.txt &&
  git -C "$tmp/other" -c user.email=o@example.com -c user.name=o commit -q -m "Late change" &&
  git -C "$tmp/other" push -q origin stage
g fetch -q origin && g rebase -q origin/stage
expect allow "git push origin stage" "a reviewed squash commit rebased onto newer work"
printf 'edit\n' >>"$r/app.txt" && g commit -q -a --amend --no-edit
expect deny "git push origin stage" "a rebased squash commit with an edit of its own"

# A squash of work only /code-review covered records nothing and is still stopped; once /simplify is
# recorded too, the same squash is covered.
g reset -q --hard origin/stage
squash_records() { cat "$r/.git/claude-reviewed-trees" "$r/.git/claude-simplified-trees"; }
before=$(squash_records)
decide "git merge --squash reviewonly" >/dev/null
if [[ $(squash_records) == "$before" ]]; then ((pass++)); else ((fail++)); echo "FAIL: a denied squash merge records nothing"; fi
g merge -q --squash reviewonly >/dev/null 2>&1 && g commit -q -m "Squash reviewonly"
expect deny "git push origin stage" "a squash commit of work /simplify has not covered"
g reset -q --hard origin/stage && g rev-parse reviewonly >>"$r/.git/claude-simplified"
decide "git merge --squash reviewonly" >/dev/null
g merge -q --squash reviewonly >/dev/null 2>&1 && g commit -q -m "Squash reviewonly again"
expect allow "git push origin stage" "a squash commit of work both runs covered"

echo "$pass passed, $fail failed"
((fail == 0))
