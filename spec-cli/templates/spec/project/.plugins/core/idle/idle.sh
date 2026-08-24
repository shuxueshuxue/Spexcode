#!/usr/bin/env bash
# On an idle_prompt notification, ask the canonical lifecycle writer to infer idle. The writer owns both the
# governed-session boundary and the active-only compare-and-set; this hook only decodes the native event and
# passes its acting session id. NOTE the Notification event is Claude-only ([[harness-adapter]]: Codex fires no
# Notification), so this never runs under Codex.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
[ "$(hp_notification_type "$payload")" = idle_prompt ] && exec ${SPEX:-spex} internal session-idle --session "$sid"
