#!/bin/bash
# Stands in for `claude` in e2e tests: records its working directory and arguments, then becomes
# a plain shell so the terminal tests can type into it.
if [ -n "$FAKE_CLAUDE_LOG_DIR" ]; then printf '%s\0' "$PWD" "$@" > "$FAKE_CLAUDE_LOG_DIR/$$.argv"; fi
# What Mainframe's SessionStart hook does once Claude Code has begun the conversation: it writes
# session-start.json beside the --settings file, and Reopen resumes the id it holds.
settings='' session=''
while [ $# -gt 1 ]; do
  case $1 in
    --settings) settings=$2 ;;
    --session-id | --resume) session=$2 ;;
  esac
  shift
done
if [ -n "$settings" ] && [ -n "$session" ]; then
  printf '{"session_id":"%s"}' "$session" > "$(dirname "$settings")/session-start.json"
fi
exec /bin/bash --noprofile --norc
