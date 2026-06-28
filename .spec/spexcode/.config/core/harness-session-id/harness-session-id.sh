#!/usr/bin/env bash
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
hid=$(hp_harness_session_id "$payload"); [ -n "$hid" ] || exit 0
${SPEX:-spex} session harness-id --session "$sid" --harness-session "$hid" >/dev/null 2>&1 || true
exit 0
