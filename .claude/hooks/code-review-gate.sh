#!/usr/bin/env bash
# PreToolUse(Bash) gate, registered in this project's .claude/settings.local.json:
# Claude may not push, merge or pull into a protected branch, or merge a PR into
# one with gh, commits that /simplify and /code-review have not both covered. Each
# run keeps its own record in <git-common-dir>: claude-simplified for /simplify,
# claude-reviewed for /code-review. A commit is covered by a run when a tip recorded
# in its file reaches it, or when it is the commit of a squash merge that run
# covered: the -trees file next to it (claude-reviewed-trees ...) holds the tree that
# commit gets, and the patch-id of its change, which stays the same when the commit
# is rebased onto newer work without a conflict to resolve.
#
# What passes without a record: commits that only touch Markdown; a merge commit
# that adds nothing beyond what merging its parents gives (git merge-tree); commits
# already in the target branch; commits on a protected branch of origin (live or
# shared already, even when they got there without this hook: a cloud session's
# push, a PR merged on GitHub); and, for a push to a branch that is not protected,
# commits already on any remote.
#
# The check runs before the command does, on refs as they are now. It reads every
# step of the command (lines, ;, &&, |, $( ), if ...). Within one command it follows
# checkouts (git checkout, switch, "-", @{-1}), but it denies a push, or a merge of
# anything but a protected branch of origin, that comes after a step that moves refs
# (commit, merge, pull, fetch, rebase, reset, branch -f, fetch x:y, ...), and a push
# or merge of a branch or tag that does not exist yet. It also denies git it cannot
# see: a repo path it cannot find ($VAR, ~), git run through bash -c, eval, xargs or
# a command it does not know (sudo, repeat ...), or a command it cannot follow (an
# unclosed quote, a case inside $( ), $( ) in an unquoted here-document).
# Tests: code-review-gate.test.sh.
# Kept bash 3.2 compatible.

protected=(main master stage)

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
dir=$(jq -r '.cwd // empty' <<<"$input")
[[ ($cmd == *git* || $cmd == *gh*) && ($cmd == *push* || $cmd == *merge* || $cmd == *pull*) ]] || exit 0

abs() { if [[ $1 == /* ]]; then printf '%s' "$1"; else printf '%s/%s' "$2" "$1"; fi; }
resolves() { git -C "$1" rev-parse --verify --quiet "$2^{commit}" >/dev/null; }
is_protected() {
  local b
  for b in "${protected[@]}"; do [[ $1 == "$b" ]] && return 0; done
  return 1
}
protected_remote_refs() {
  local b
  for b in "${protected[@]}"; do printf 'refs/remotes/origin/%s\n' "$b"; done
}
# Does $2 name a protected branch of origin? origin/stage, remotes/origin/stage,
# refs/remotes/origin/stage, or an upstream (@{u}, stage@{upstream}) that is one.
trusted_source() {
  local n=$2
  if [[ $n == *@\{u\} || $n == *@\{upstream\} ]]; then
    [[ $n == @* ]] && n=$current$n
    n=$(git -C "$1" rev-parse --symbolic-full-name "$n" 2>/dev/null)
  fi
  n=${n#refs/}
  n=${n#remotes/}
  [[ $n == origin/* ]] && is_protected "${n#origin/}"
}

# One simple command per line, words separated by \x1f, split the way the shell will run them:
# newlines and ; & | ( ) end a command; quotes ('', "", $''), backslashes and # comments as in
# the shell; the commands inside $( ), ` ` and <( ) come out before the command that uses them,
# between a \x1e( line and a \x1e) line, as do those of a ( ) subshell, so a cd inside stays
# inside; quoted here-document bodies are skipped; a redirection is dropped with its target
# (2>&1). It exits 1 where it cannot follow the shell: an unclosed quote or $(, a case inside
# $( ), or $( ) or ` ` in an unquoted here-document body, which the shell runs.
IFS= read -r -d '' split <<'PY'
import sys

s = sys.argv[1]
n = len(s)
OPEN, CLOSE = "\x1e(", "\x1e)"


class Unsure(Exception):
    pass


def skip_here_docs(i, docs):
    # i starts the line after the one that opened them; each body ends at its delimiter line.
    for delim, tabs, expands in docs:
        while i < n:
            j = s.find("\n", i)
            j = n if j < 0 else j
            line = s[i:j]
            i = j + 1
            if (line.lstrip("\t") if tabs else line) == delim:
                break
            if expands and ("$(" in line or "`" in line):
                raise Unsure  # the shell runs these while it expands the body
    del docs[:]
    return i


def double_quoted(i):
    text = ""
    while i < n and s[i] != '"':
        c = s[i]
        i += 1
        if c == "\\" and i < n and s[i] in '$`"\\\n':
            if s[i] != "\n":
                text += s[i]
            i += 1
        elif c == "`" or (c == "$" and i < n and s[i] == "("):
            i = commands(i, "`") if c == "`" else commands(i + 1, ")")
            text += c + "()"
        else:
            text += c
    if i >= n:
        raise Unsure
    return text, i + 1


def commands(i, close):
    """Print the commands from s[i] up to close (")" or "`"; None for the end), return the index after it."""
    words, word, quoted = [], "", False
    docs, target, depth = [], None, 0

    def end_word():
        nonlocal word, quoted, target
        if word or quoted:
            if target in ("<<", "<<-"):
                docs.append((word, target == "<<-", not quoted))
            elif target is None:
                if close == ")" and word == "case" and not quoted:
                    raise Unsure  # its pattern's ) would end the $( ) early
                words.append(word.replace("\n", " "))
            target = None
        word, quoted = "", False

    def end_command():
        nonlocal words, target
        end_word()
        if words:
            print("\x1f".join(words))
        words, target = [], None

    if close:
        print(OPEN)
    while i < n:
        c = s[i]
        i += 1
        if c == "\\":
            if i < n and s[i] != "\n":
                word += s[i]
                quoted = True
            i += 1
        elif c == "'":
            j = s.find("'", i)
            if j < 0:
                raise Unsure
            word += s[i:j]
            quoted = True
            i = j + 1
        elif c == "$" and i < n and s[i] == "'":
            j = i + 1  # $'...': a backslash escapes the next character, \' included
            while j < n and s[j] != "'":
                j += 2 if s[j] == "\\" else 1
            if j >= n:
                raise Unsure
            word += s[i + 1:j]
            quoted = True
            i = j + 1
        elif c == '"':
            text, i = double_quoted(i)
            word += text
            quoted = True
        elif c == "`" and close == "`":
            end_command()
            print(CLOSE)
            return i
        elif c == "`" or (c in "$<>" and i < n and s[i] == "("):
            i = commands(i, "`") if c == "`" else commands(i + 1, ")")
            word += c + "()"
        elif c in "<>" or (c == "&" and i < n and s[i] == ">"):
            if word.isdigit() and not quoted:
                word = ""  # the file descriptor in 2>&1
            end_word()
            op = c
            while i < n and s[i] in "<>&|":
                op += s[i]
                i += 1
            if op == "<<" and i < n and s[i] == "-":
                op, i = "<<-", i + 1
            target = op if op in ("<<", "<<-") else ">"
        elif c in ";&|\n()":
            if c == ")" and close == ")" and depth == 0:
                end_command()
                print(CLOSE)
                return i
            end_command()
            if c == "(":
                depth += 1
                print(OPEN)
            elif c == ")" and depth > 0:
                depth -= 1
                print(CLOSE)
            elif c == "\n":
                i = skip_here_docs(i, docs)
        elif c == "#" and not word and not quoted:
            j = s.find("\n", i)
            i = n if j < 0 else j
        elif c in " \t\r":
            end_word()
        else:
            word += c
    if close:
        raise Unsure
    end_command()
    return i


try:
    commands(0, None)
except Unsure:
    sys.exit(1)
PY
report=""
runs="simplified:/simplify reviewed:/code-review" # each run's record (claude-<name>), in the order they run
missing=""                                        # the runs the report lists commits for
segments=$(/usr/bin/python3 -I -c "$split" "$cmd" 2>/dev/null) ||
  report+="The gate could not follow this command (an unclosed quote, a case inside \$( ), or \$( ) or \` \` in an unquoted here-document), so it cannot check it: run the git step as a plain command of its own."$'\n\n'

# The branch each step runs on, and the one before it ("-", @{-1}), as git will see them once
# the earlier steps have run. Loaded from a repo's git dir the first time it is used.
state_key=""
current=""
previous=""
track() {
  local key
  key=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)
  [[ $state_key == "$key" ]] && return
  state_key=$key
  current=$(git -C "$1" symbolic-ref --quiet --short HEAD || git -C "$1" rev-parse --quiet --verify HEAD)
  previous=$(git -C "$1" rev-parse --abbrev-ref '@{-1}' 2>/dev/null)
}

moved=""   # the first earlier step that moves a branch ref, e.g. "git commit"
fetched=0  # an earlier step moved remote refs or FETCH_HEAD
switched=0 # an earlier step changed the checked-out branch
dirs=()    # the folder to go back to when a ( ) subshell or $( ) ends: a cd inside one stays there
while IFS= read -r segment; do
  if [[ $segment == $'\x1e(' ]]; then dirs+=("$dir"); continue; fi
  if [[ $segment == $'\x1e)' ]]; then
    k=$((${#dirs[@]} - 1))
    ((k >= 0)) && { dir=${dirs[k]}; unset "dirs[k]"; }
    continue
  fi
  IFS=$'\x1f' read -ra w <<<"$segment"
  [[ ${#w[@]} -gt 0 ]] || continue

  # Prefixes that run the next word as the command: VAR=value, command, env, nice, timeout, if ...
  sdir=$dir
  i=0
  while [[ $i -lt ${#w[@]} ]]; do
    case ${w[i]} in
      -*) break ;;
      *=*) ((i++)) ;;
      command | builtin | exec | nohup | time)
        ((i++))
        while [[ ${w[i]} == -* ]]; do [[ ${w[i]} == -a ]] && ((i++)); ((i++)); done # time -p, exec -a NAME
        ;;
      if | then | elif | else | do | while | until | '!' | '{') ((i++)) ;;
      env)
        ((i++))
        while [[ ${w[i]} == -* || (${w[i]} == *=* && ${w[i]} != -*) ]]; do
          case ${w[i]} in
            -C | --chdir) sdir=$(abs "${w[i+1]}" "$dir"); ((i += 2)) ;;
            --chdir=*) sdir=$(abs "${w[i]#--chdir=}" "$dir"); ((i++)) ;;
            -u | --unset) ((i += 2)) ;;
            -S* | --split-string*) w[i]=sh; break ;;
            *) ((i++)) ;;
          esac
        done
        [[ ${w[i]} == sh ]] && break
        ;;
      nice) ((i++)); [[ ${w[i]} == -n ]] && ((i += 2)); [[ ${w[i]} == -[0-9]* ]] && ((i++)) ;;
      timeout | gtimeout)
        ((i++))
        while [[ ${w[i]} == -* ]]; do
          case ${w[i]} in -s | -k | --signal | --kill-after) ((i += 2)) ;; *) ((i++)) ;; esac
        done
        ((i++))
        ;;
      *) break ;;
    esac
  done
  word=${w[i]##*/}

  case $word in
    cd | pushd)
      dir=$(abs "${w[i+1]:-~}" "$dir") # no folder (home) stays unknown, so a later push is denied
      continue
      ;;
    bash | sh | zsh | dash | ksh | eval | xargs | source | .)
      if [[ $segment == *git* && ($segment == *push* || $segment == *merge* || $segment == *pull*) ]]; then
        report+="$word runs git where the gate cannot read it: run the git command directly."$'\n\n'
      fi
      continue
      ;;
    gh)
      [[ ${w[i+1]} == pr && ${w[i+2]} == merge ]] || continue
      repo=$sdir
      sel=""
      opt=""
      ghrepo=() # -R: the PR is looked up in that GitHub repo, not the folder's
      for a in "${w[@]:i+3}"; do
        if [[ -n $opt ]]; then [[ $opt == -R || $opt == --repo ]] && ghrepo=(-R "$a"); opt=""; continue; fi
        case $a in
          -t | --subject | -b | --body | -F | --body-file | --match-head-commit | -A | --author-email | -R | --repo) opt=$a ;;
          --repo=*) ghrepo=(-R "${a#--repo=}") ;;
          -R?*) ghrepo=(-R "${a#-R}") ;;
          -*) ;;
          *) [[ -z $sel ]] && sel=$a ;;
        esac
      done
      info=$(cd "$repo" 2>/dev/null && gh pr view $sel "${ghrepo[@]}" --json headRefOid,baseRefName,headRefName \
        --jq '"\(.headRefOid) \(.baseRefName) \(.headRefName)"' 2>/dev/null)
      read -r sha base head <<<"$info"
      if [[ -z $sha ]]; then
        report+="gh pr merge ${sel:-(current branch)}: the gate could not look up the pull request, so it cannot check its commits."$'\n\n'
        continue
      fi
      is_protected "$base" || continue
      if ! resolves "$repo" "$sha"; then
        report+="gh pr merge ${sel:-(current branch)} into $base: its head $sha is not in the repo at $repo. Run git fetch origin $head there as its own command (or run gh from the PR's own repo), then retry."$'\n\n'
        continue
      fi
      sub="pr merge"
      tips=("$sha")
      exclude=()
      while read -r ref; do exclude+=("$ref"); done < <(protected_remote_refs)
      squash=0
      branch=$base
      ;;
    git)
      repo=$sdir
      ((i++))
      while [[ ${w[i]} == -* ]]; do
        case ${w[i]} in
          -C) repo=$(abs "${w[i+1]}" "$repo"); ((i += 2)) ;;
          --git-dir) repo=$(abs "${w[i+1]}" "$repo"); ((i += 2)) ;;
          --git-dir=*) repo=$(abs "${w[i]#--git-dir=}" "$repo"); ((i++)) ;;
          -c | --work-tree | --namespace) ((i += 2)) ;;
          *) ((i++)) ;;
        esac
      done
      sub=${w[i]}
      args=("${w[@]:i+1}")
      if [[ ! -d $repo ]]; then
        # The command text is checked before the shell expands it, so a variable or ~ hides the repo.
        case $sub in push | merge | pull)
          report+="git $sub: the gate cannot find the repo at '$repo' (a shell variable or ~ in the path?), so it cannot check the commits: write the literal absolute path."$'\n\n' ;;
        esac
        continue
      fi
      track "$repo"

      tips=()
      exclude=(--remotes)
      squash=0
      branch=""
      case $sub in
        checkout | switch)
          # The branch left checked out: a create/reset flag's value, "-" or @{-1} for the previous branch,
          # else the first non-option word if it is a branch or commit. A path, a ref that does not
          # exist, or anything after "--" leaves the branch as it is.
          target=""
          create=0
          for ((j = 0; j < ${#args[@]}; j++)); do
            case ${args[j]} in
              -b | -c | --orphan) target=${args[j + 1]}; create=1; break ;;
              -B | -C) target=${args[j + 1]}; create=1; moved=${moved:-git $sub ${args[j]}}; break ;;
              -t | --track) [[ ${args[j + 1]} != -* ]] && target=${args[j + 1]#*/} && create=1; break ;;
              --) break ;;
              - | @{-1}) target=$previous; break ;;
              -*) ;;
              *) target=${args[j]}; break ;;
            esac
          done
          if [[ -n $target ]] && ((!create)); then
            git -C "$repo" show-ref --verify --quiet "refs/heads/$target" ||
              git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$target" ||
              { [[ $sub == checkout ]] && resolves "$repo" "$target"; } ||
              target=""
          fi
          [[ -n $target ]] && { previous=$current; current=$target; switched=1; }
          continue
          ;;
        fetch | remote)
          [[ $sub == fetch || ${args[0]} == update ]] && fetched=1
          if [[ $sub == fetch ]]; then
            # A refspec after the remote (cloud-branch:x) can move a local branch too.
            seen=0
            for a in "${args[@]}"; do
              [[ $a == -* ]] && continue
              ((seen++)) && [[ $a == *:* ]] && moved=${moved:-git fetch $a}
            done
          fi
          continue
          ;;
        branch)
          # Listing and showing move nothing; creating, forcing, renaming or deleting does.
          for a in "${args[@]}"; do
            case $a in
              -l | --list | --contains* | --no-contains* | --merged* | --no-merged* | --points-at*) break ;; # what follows are patterns or commits
              -a | --all | -r | --remotes | -v | -vv | --verbose | --show-current | --sort=* | --format=* | --color* | --no-color | --column*) ;;
              *) moved=${moved:-git branch $a}; break ;;
            esac
          done
          continue
          ;;
        commit | rebase | reset | cherry-pick | revert | am | update-ref)
          moved=${moved:-git $sub}
          continue
          ;;
        push)
          if [[ -n $moved ]]; then
            report+="git push after $moved in the same command: the gate checks commits before the command runs, so it cannot see what that step makes. Run the push as its own command."$'\n\n'
            continue
          fi
          skip=0
          all=0
          remote=""
          specs=()
          skipval=0
          for a in "${args[@]}"; do
            if ((skipval)); then skipval=0; continue; fi
            case $a in
              --delete | -d | --dry-run | -n) skip=1 ;;
              --all | --mirror | --branches) all=1 ;;
              --tags) tips+=(--tags) ;;
              -o | --push-option | --repo | --receive-pack | --exec) skipval=1 ;;
              -*) ;;
              *) if [[ -z $remote ]]; then remote=$a; else specs+=("$a"); fi ;;
            esac
          done
          ((skip)) && continue
          if [[ ${#specs[@]} -eq 0 ]]; then
            # No refspec: push.default=matching, or a configured remote.<name>.push, can send any branch.
            mode=$(git -C "$repo" config push.default)
            [[ $mode == matching || -n $(git -C "$repo" config --get-all "remote.${remote:-origin}.push") ]] && all=1
            specs=(HEAD)
          fi
          dsts=()
          for spec in "${specs[@]}"; do
            [[ $spec == tag ]] && continue # "tag v1" pushes the tag v1
            spec=${spec#+}
            src=${spec%%:*}
            dst=${spec#*:}
            [[ $spec == *:* ]] || dst=$src
            [[ -z $src ]] && continue
            if [[ $src == *'*'* ]]; then all=1; continue; fi
            [[ $src == HEAD || $src == @ ]] && src=$current
            [[ $dst == HEAD || $dst == @ ]] && dst=$current
            dsts+=("${dst#refs/heads/}")
            if ! resolves "$repo" "$src"; then
              report+="git push $src: it does not exist yet (made earlier in this command?), so the gate cannot check what it sends. Run the push as its own command."$'\n\n'
            elif ((fetched)) && ! git -C "$repo" show-ref --verify --quiet "refs/heads/${src#refs/heads/}" && ! trusted_source "$repo" "$src"; then
              report+="git push $src after a fetch in the same command: the fetch can move it past what the gate sees. Run the push as its own command."$'\n\n'
            else
              tips+=("$src")
            fi
          done
          ((all)) && tips+=(--branches)
          [[ ${#tips[@]} -gt 0 ]] || continue
          # Into a protected branch of origin only what origin's protected branches already have is
          # trusted; anywhere else, what any remote already has.
          to_protected=$all
          for d in "${dsts[@]}"; do is_protected "$d" && to_protected=1; done
          [[ -n $remote && $remote != origin ]] && to_protected=0
          if ((to_protected)); then
            exclude=()
            while read -r ref; do exclude+=("$ref"); done < <(protected_remote_refs)
          fi
          ;;
        merge | pull)
          branch=$current
          if [[ $sub == pull ]]; then
            # A pull fetches, then merges or rebases the named branches of a remote, else the upstream.
            remote=""
            sources=()
            skipval=0
            for a in "${args[@]}"; do
              if ((skipval)); then skipval=0; continue; fi
              case $a in
                -X | --strategy-option | -s | --strategy | --depth | --deepen | --shallow-since | --shallow-exclude | -o | --server-option | -j | --jobs | --upload-pack | --negotiation-tip) skipval=1 ;;
                -*) ;;
                *)
                  if [[ -z $remote ]]; then
                    remote=$a
                  else
                    a=${a#+}
                    a=${a%%:*}
                    sources+=("$remote/${a#refs/heads/}")
                  fi
                  ;;
              esac
            done
            if [[ ${#sources[@]} -eq 0 ]]; then
              up=$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name "$current@{upstream}" 2>/dev/null)
              [[ -n $remote && $up != "$remote"/* ]] && up=""
              sources=("${up:-the upstream it cannot find}")
            fi
            if is_protected "$branch"; then
              for s in "${sources[@]}"; do
                trusted_source "$repo" "$s" && continue
                report+="git pull would bring $s into $branch, fetched in the same step, so the gate cannot check it: fetch it, then merge it as separate commands."$'\n\n'
              done
            fi
            fetched=1
            moved=${moved:-git pull}
            continue
          fi
          if ! is_protected "$branch"; then
            moved=${moved:-git merge}
            continue
          fi
          # Only the branch being brought in needs a review: the target, and commits on a protected
          # branch of origin (an urgent fix merged back into stage, a local fast-forward release),
          # are reviewed or live. Exact refs: a --remotes glob's * also matches "/".
          exclude=("$branch")
          while read -r ref; do exclude+=("$ref"); done < <(protected_remote_refs)
          skip=0
          takes_value=0
          for a in "${args[@]}"; do
            if ((takes_value)); then takes_value=0; continue; fi
            case $a in
              --abort | --continue | --quit) skip=1; continue ;;
              --squash) squash=1; continue ;;
              -m | -s | -X | -F | --strategy | --strategy-option | --file) takes_value=1; continue ;;
              - | @{-1}) a=$previous ;;
              @{-*}) if ((switched)); then report+="git merge $a after a checkout in the same command: name the branch instead."$'\n\n'; continue; fi ;;
              -*) continue ;;
            esac
            if [[ -n $moved || $fetched -eq 1 ]] && ! trusted_source "$repo" "$a"; then
              report+="git merge brings ${a:--} into $branch after ${moved:-a fetch} in the same command, so the gate cannot see what it brings: run that step as its own command first."$'\n\n'
            elif ! resolves "$repo" "$a"; then
              report+="git merge ${a:--} into $branch: it does not exist yet (made earlier in this command?), so the gate cannot check what it brings. Run the merge as its own command."$'\n\n'
            else
              tips+=("$a")
            fi
          done
          moved=${moved:-git merge}
          ((skip)) && continue
          [[ ${#tips[@]} -gt 0 ]] || continue
          ;;
        *) continue ;;
      esac
      ;;
    *)
      # git behind a command the gate does not follow (sudo, repeat, caffeinate ...) is denied, not skipped.
      for ((j = i + 1; j < ${#w[@]}; j++)); do
        [[ ${w[j]##*/} == git || ${w[j]##*/} == gh ]] || continue
        for a in "${w[@]:j+1}"; do
          case $a in
            push | merge | pull) report+="${w[j]##*/} after $word: the gate cannot tell how $word runs it, so it cannot check it. Run the git command directly."$'\n\n'; break 2 ;;
          esac
        done
      done
      continue
      ;;
  esac

  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
  covered=1
  code=""  # commits that change more than Markdown: each commit is looked at once for both runs
  docs=""  # commits that change only Markdown, or nothing
  shown="" # the commit list the report already has for this step
  for pair in $runs; do
    run=${pair%%:*}
    skill=${pair#*:}
    ledger=$common/claude-$run
    tree_ledger=$ledger-trees
    recorded=""
    [[ -f $ledger ]] && recorded=$(cat "$ledger")
    trees=""
    [[ -f $tree_ledger ]] && trees=$(cat "$tree_ledger")

    # $recorded is unquoted on purpose: empty, or whitespace-separated shas.
    range=(--ignore-missing "${tips[@]}" --not "${exclude[@]}" $recorded)
    # Commits that make the change of a recorded squash merge: its commit, rebased onto newer work.
    rebased=""
    if [[ -n $trees ]]; then
      rebased=$(git -C "$repo" rev-list --no-merges "${range[@]}" | git -C "$repo" diff-tree --stdin -p -r |
        git -C "$repo" patch-id --verbatim | awk 'NR == FNR { ok[$1] = 1; next } ok[$1] { print $2 }' <(printf '%s\n' "$trees") -)
    fi
    pending=""
    count=0
    while read -r c parents; do
      [[ -n $c && $docs != *"$c"* ]] || continue
      if [[ $code != *"$c"* ]]; then
        if [[ $parents == *' '* ]]; then
          # A merge commit's own changes: its tree against what merging its parents gives. Clean
          # merges add none; a conflict resolution or an edit made during the merge shows here.
          # Octopus merges, or a merge-tree that fails, count everything against the first parent.
          merged=""
          [[ $parents != *' '*' '* ]] && merged=$(git -C "$repo" merge-tree --write-tree $parents 2>/dev/null | head -1)
          changed=$(git -C "$repo" diff --name-only "${merged:-$c^1}" "$c" 2>/dev/null)
        else
          changed=$(git -C "$repo" diff-tree --root --no-commit-id --name-only -r "$c")
        fi
        if [[ -n $changed ]] && grep -qv '\.md$' <<<"$changed"; then code+=" $c"; else docs+=" $c"; continue; fi
      fi
      [[ $rebased == *"$c"* ]] && continue
      [[ -n $trees ]] && grep -qxF "$(git -C "$repo" rev-parse "$c^{tree}")" <<<"$trees" && continue
      ((count++ < 15)) && pending+="  $(git -C "$repo" log -1 --format='%h %s' "$c")"$'\n'
    done < <(git -C "$repo" rev-list --parents "${range[@]}")
    ((count > 15)) && pending+="  ... and $((count - 15)) more"$'\n'

    if [[ -n $pending ]]; then
      missing+=" $run"
      covered=0
      # The review's fix commits count for the /simplify run before it, so they go in both records.
      record=">> \"$ledger\""
      [[ $run == reviewed ]] && record="| tee -a \"$common/claude-simplified\" $record"
      step="$([[ $sub == "pr merge" ]] && echo gh || echo git) $sub in $repo would bring in"
      if [[ $pending == "$shown" ]]; then
        report+="$step the same $count commit(s), which $skill has not covered either."$'\n'
      else
        report+="$step $count commit(s) $skill has not covered:"$'\n'"$pending"
        shown=$pending
      fi
      report+="After the $skill run, record the tip with: git -C \"$repo\" rev-parse ${tips[*]} $record"$'\n\n'
    fi
  done
  # The squash commit will be new, so once both runs cover the merge, remember the tree it will have,
  # and the patch-id of its change (line numbers left out, whitespace counted; empty when it changes
  # nothing), made the same way as the check above makes it.
  if ((covered && squash)) && [[ ${#tips[@]} -eq 1 ]] && tree=$(git -C "$repo" merge-tree --write-tree "$branch" "${tips[0]}" 2>/dev/null); then
    tree=$(head -1 <<<"$tree")
    pid=$(git -C "$repo" diff-tree -p -r "$branch" "$tree" | git -C "$repo" patch-id --verbatim | cut -d' ' -f1)
    for pair in $runs; do
      echo "$tree" >>"$common/claude-${pair%%:*}-trees"
      [[ -n $pid ]] && echo "$pid" >>"$common/claude-${pair%%:*}-trees"
    done
  fi
done <<<"$segments"

[[ -n $report ]] || exit 0

reason="Code-review gate: the user wants /simplify, then /code-review, before every push and every merge into ${protected[*]}.

${report}"
[[ $missing == *simplified* ]] && reason+="Run the simplify skill on the commits it has not covered (Skill tool, skill \"simplify\", args the branch or range), check its edits, run the tests and commit them. Commits that only fix the findings of a /code-review run made after a /simplify run need no new run: that run covers them, and the review's record line puts their tip in both files. "
[[ $missing == *simplified* && $missing != *reviewed* ]] && reason+="If /simplify changed anything, run the code-review skill at high effort on its edits next. "
[[ $missing == *reviewed* ]] && reason+="Run the code-review skill at high effort on the branch (Skill tool, skill \"code-review\", args \"high\" plus the branch or range), after /simplify, fix what it finds and commit the fixes. "
[[ -n $missing ]] && reason+="Record each tip as shown above and retry. Record a tip only after its run, or when the user explicitly says to skip it."

jq -n --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
