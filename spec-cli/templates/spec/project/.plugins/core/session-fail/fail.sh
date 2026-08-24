#!/usr/bin/env bash
# Mark the session errored when a turn ends on an API failure (StopFailure). The canonical lifecycle writer owns
# the governed-session boundary and active-only compare-and-set; this hook only decodes the native event and
# passes its acting session id.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
exec ${SPEX:-spex} internal session-fail --session "$sid"
