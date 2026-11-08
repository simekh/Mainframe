#!/bin/bash
# Stands in for `claude` in e2e tests: records its working directory and arguments, then becomes
# a plain shell so the terminal tests can type into it.
if [ -n "$FAKE_CLAUDE_LOG_DIR" ]; then printf '%s\0' "$PWD" "$@" > "$FAKE_CLAUDE_LOG_DIR/$$.argv"; fi
# A sync is a `claude -p` run: it records the prompt it reads on stdin, and prints what the test put in
# sync-reply.json as its answer (nothing without one, which Mainframe reads as a failed run). While
# sync-hold is in the folder, it waits instead of replying, and records that it waits in <pid>.holding.
# Mainframe stops a run with SIGTERM: it is recorded in <pid>.sigterm, after the run has printed its
# reply as it went, like a run that answers just as it is stopped.
if [ "$1" = "-p" ]; then
  cat > "$FAKE_CLAUDE_LOG_DIR/$$.stdin"
  reply() { if [ -f "$FAKE_CLAUDE_LOG_DIR/sync-reply.json" ]; then cat "$FAKE_CLAUDE_LOG_DIR/sync-reply.json"; fi; }
  trap 'reply; : > "$FAKE_CLAUDE_LOG_DIR/$$.sigterm"; exit 143' TERM
  if [ -f "$FAKE_CLAUDE_LOG_DIR/sync-hold" ]; then : > "$FAKE_CLAUDE_LOG_DIR/$$.holding"; fi
  # `wait` returns as soon as the signal comes, which a foreground sleep would put off.
  while [ -f "$FAKE_CLAUDE_LOG_DIR/sync-hold" ]; do sleep 0.05 & wait $!; done
  reply
  exit 0
fi
# What Mainframe's SessionStart hook does once Claude Code has begun the conversation: it writes
# session-start.json beside the --settings file, naming the conversation, how it began and its transcript.
# Reopen resumes the id it holds; the manager only if the chat was saved, when it began or was cleared. This
# one saves the chat at once, as if a message had been sent, under projects/ beside the other logs, never
# in ~/.claude.
settings='' session='' source=''
while [ $# -gt 1 ]; do
  case $1 in
    --settings) settings=$2 ;;
    --session-id) session=$2 source=startup ;;
    --resume) session=$2 source=resume ;;
  esac
  shift
done
if [ -n "$settings" ] && [ -n "$session" ] && [ -n "$FAKE_CLAUDE_LOG_DIR" ]; then
  transcript="$FAKE_CLAUDE_LOG_DIR/projects/-fake-project/$session.jsonl"
  mkdir -p "$(dirname "$transcript")"
  : > "$transcript"
  printf '{"session_id":"%s","source":"%s","transcript_path":"%s"}' "$session" "$source" "$transcript" > "$(dirname "$settings")/session-start.json"
fi
exec /bin/bash --noprofile --norc
