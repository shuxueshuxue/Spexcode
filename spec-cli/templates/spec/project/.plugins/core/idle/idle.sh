#!/usr/bin/env bash
# On an idle_prompt notification, ask the canonical lifecycle writer to infer idle. The writer owns both the
# governed-session boundary and the active-only compare-and-set; this hook only decodes the native event and
# passes its acting session id. NOTE the Notification event is Claude-only ([[harness-adapter]]: Codex fires no
# Notification), so this never runs under Codex.
SPEX_PROFILE_VALUE="${SPEX_PROFILE:-full}"
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
hp_profile_hook_enabled idle
profile_status=$?
[ "$profile_status" -eq 1 ] && exit 0
[ "$profile_status" -ne 0 ] && exit "$profile_status"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
[ "$(hp_notification_type "$payload")" = idle_prompt ] && exec ${SPEX:-spex} internal session-idle --session "$sid"
