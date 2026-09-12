#!/usr/bin/env bash
set -u
SPEX_PROFILE_VALUE="${SPEX_PROFILE:-full}"
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
hp_profile_hook_enabled session-listen
profile_status=$?
[ "$profile_status" -eq 1 ] && exit 0
[ "$profile_status" -ne 0 ] && exit "$profile_status"

# Registration only. On SessionStart the product CLI gives this harness's native session id a protocol address in
# the project's canonical store — only where that store already exists and is ready (the CLI decides and says
# `skipped: …` otherwise). Message receipt is the caller's own act (`spex session dequeue | wait-dequeue |
# stream-dequeue`) or the backend's push for a governed session; this hook never reads mail.
S="${SPEX:-spex}"
payload=$(cat 2>/dev/null || true)
sid=$(hp_field "$payload" session_id)
[ -n "$sid" ] || exit 0
event=$(hp_field "$payload" hook_event_name)

case "$event" in
  SessionStart)
    "$S" internal session-register "$sid" >/dev/null || exit 2
    ;;
esac
