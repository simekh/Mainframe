# Findings: Codex CLI tried by hand

Checks on 2026-11-17, worktree `codex-agent`, with Codex CLI 0.169.0 (`npm i -g @openai/codex`), the release of that day. They answer the "to try by hand" list in `2026-11-12-other-agent-clis.md`.

## How it was run

The owner has no Codex account, and the ChatGPT login left in `~/.codex` from March had expired (Codex opened on its sign-in screen). So Codex ran against a fake model: a small local server that speaks the OpenAI Responses API and sends canned answers. The real Codex TUI ran unchanged, in a pseudo-terminal, with a throwaway `CODEX_HOME`:

```
codex -c model_provider=fake -c 'model_providers.fake.name="fake"' \
  -c 'model_providers.fake.base_url="http://127.0.0.1:<port>/v1"' \
  -c 'model_providers.fake.wire_api="responses"' -c model=fake-model "<prompt>"
```

The fake answers each `POST /v1/responses` with server-sent events: `response.created`, one `response.output_item.done` (an assistant `message`, or a `function_call` to `exec_command` or `request_user_input`), then `response.completed`. A 400 answer makes the turn fail. This needs no account, so it also serves for a hand check of Mainframe with Codex.

## What Codex does

**Status (OSC 7501).** Payloads look like `state=working:app=codex`. Codex sends them with no query from the terminal.

| What happened | Reports |
|---|---|
| Start with a prompt | `idle`, then `working` at once |
| The turn ends | `done` |
| It asks to run a command outside its sandbox | `blocked:kind=permission`. Approving it sends `working` |
| The model call fails | `error` |
| The "Trust this folder?" prompt, or the sign-in screen | nothing, until it is answered |
| `request_user_input` (a question) | not shown: Codex answers the model "request_user_input is unavailable in Default mode". Questions exist only in its plan mode |

**Trust.** The first launch in an untrusted repo asks "Trust this folder?" before anything else. The answer is saved under `[projects."<repo root>"]` in `$CODEX_HOME/config.toml`. A launch in one of the repo's git worktrees counts as the repo: answering in worktree `.mainframe/worktrees/w1` saved the repo root, and worktree `w2` was not asked. So the question comes once per project.

**Sessions.**
- Each session is a file `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl`. Its first line (`session_meta`) holds `id` and `cwd`. Codex also has `migrate-rollouts` and `thread_history_*.sqlite`, so the files look like a store on its way out: Mainframe should not read them.
- `codex resume [SESSION_ID] [PROMPT]`: a resume takes a prompt, which is sent as the first message. Checked by id and with `--last`.
- `codex resume --last` takes the newest session whose folder is exactly the current one (`--all` drops that filter). From worktree `t1` it took `t1`'s session while the repo root had five newer ones.
- After `/new` in the TUI (it first asks "Where should the new conversation run?": current worktree or a new one), `--last` takes the new chat. A stored id would go back to the old one.
- No flag names a session or sets its id at launch.

**Hooks.** The `hooks` feature is stable and on. A hook needs the owner's trust, or `--dangerously-bypass-hook-trust`, which skips trust for every enabled hook, the repo's own included. Not used.

**Ending a session.** A hang-up (SIGHUP, as Mainframe sends), SIGTERM or SIGINT to the TUI ends its turn: no further model request was made, while the same run left alone carried on once the command finished. But a command Codex was running stays alive: `sleep 61` survived each signal, in its own process group with no terminal, its parent gone (PPID 1). A dev server or a long test run Codex started would outlive its session.

**Git in its sandbox.** Codex's default sandbox (`CODEX_SANDBOX=seatbelt` on macOS, profile `:workspace`) keeps every `.git` read-only, in a repo's root as much as in a worktree, even with `--add-dir <repo>/.git`: `git commit` fails with "Unable to create '…/index.lock': Operation not permitted". So a commit needs the user's approval, which the board shows as `blocked:kind=permission`. A Mainframe worktree changes nothing here.

**What its shells inherit.** A command Codex runs sees `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_TOOL_CALL_ID`, `CODEX_CI`, `CODEX_PERMISSION_PROFILE`, `CODEX_VERSION`, `CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS`, and (from the npm launcher) `CODEX_MANAGED_BY_NPM` and `CODEX_MANAGED_PACKAGE_ROOT`, besides the user's own `CODEX_HOME`. `CODEX_SESSION_ID` and `CODEX_THREAD_ID` are the session's id.

**The daemon.** Codex 0.169 starts `codex app-server ... --managed-daemon` from `~/.codex/packages/app-server-daemon` (seen on the first run, with the real `~/.codex`). It stays after the session ends. Turns don't run in it: the turn ended with the TUI. `--no-daemon` exists.

**Where `codex` is.**
- Codex's install script: `~/.local/bin/codex` on macOS and Linux (`CODEX_INSTALL_DIR` moves it); `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` on Windows.
- Homebrew: `brew install --cask codex`.
- npm: `codex` is a node launcher (`bin/codex.js`) that runs the native binary from `@openai/codex-<platform>/vendor/<triple>/bin/codex` and puts its `codex-path` folder (with `rg`) on PATH. On Windows npm makes a `codex.cmd`, the kind of launcher Mainframe never runs.
- `codex --version` prints `codex-cli 0.169.0`.

**Instructions file.** Codex reads `AGENTS.md`; `project_doc_fallback_filenames` adds other names, such as `CLAUDE.md`. Tried in a repo with a `CLAUDE.md` and an `OTHER.md` and no `AGENTS.md`, with `project_doc_fallback_filenames = ["OTHER.md"]` in the user's config:
- with no `-c`, Codex sent `OTHER.md`;
- with `-c 'project_doc_fallback_filenames=["CLAUDE.md"]'`, it sent only `CLAUDE.md`: a `-c` replaces the user's list, it doesn't add to it.

`codex debug prompt-input`, run in a folder, prints as JSON what the model would be sent, offline and in under half a second. A loaded file is a user message starting `# AGENTS.md instructions for <folder>`, with the file inside `<INSTRUCTIONS>`. The heading says AGENTS.md even when the file is `CLAUDE.md`.

**A resume with no session.** `codex resume --last "<prompt>"` in a worktree with no session of its own starts a new chat there with that prompt.

## Not checked

- A real model: nothing went to OpenAI.
- Windows and Linux.
- The manager's and the sync's flags (`-c mcp_servers...`, `developer_instructions`, `exec --output-schema`): left for the second branch.
