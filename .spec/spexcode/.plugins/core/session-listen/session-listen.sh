#!/usr/bin/env bash
set -u
SPEX_PROFILE_VALUE="${SPEX_PROFILE:-full}"
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
hp_profile_hook_enabled session-listen
profile_status=$?
[ "$profile_status" -eq 1 ] && exit 0
[ "$profile_status" -ne 0 ] && exit "$profile_status"

# Registration only. Message receipt is owned by backend push or by the caller's explicit dequeue.
if [ -z "${SPEX_SESSION_DATABASE_PATH+x}" ] && [ -z "${SPEX_SESSION_CONFIG+x}" ]; then
  exit 0
fi

cli="${SPEX_SESSION_CLI:-}"
if [ -z "$cli" ]; then
  cli=$(command -v spex-session 2>/dev/null || true)
fi
if [ -z "$cli" ] || [ ! -x "$cli" ]; then
  printf '%s\n' 'session-listen: spex-session CLI not found; install @spexcode/session-selflaunch (npm install) or set SPEX_SESSION_CLI to its executable path' >&2
  exit 2
fi

. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null || true)
sid=$(hp_field "$payload" session_id)
[ -n "$sid" ] || exit 0
event=$(hp_field "$payload" hook_event_name)

case "$event" in
  SessionStart)
    "$cli" initialize --session-id "$sid" >/dev/null || exit 2
    ;;
esac
