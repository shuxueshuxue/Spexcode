#!/usr/bin/env bash
# Mark the session errored when a turn ends on an API failure (StopFailure). The canonical lifecycle writer owns
# the governed-session boundary and active-only compare-and-set; this hook only decodes the native event and
# passes its acting session id.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
# an IN-PROCESS SUBAGENT's failed turn (Claude's Task tool) fires the parent's hooks with the PARENT's
# session_id, so without this the parent's own record would be flipped to `error` by a helper it spawned —
# the same defect already fixed for mark-active, and the same discriminator fixes it: the payload's own
# top-level agent_id stamp. A subagent's turn dying is not THIS session's turn dying.
[ -n "$(hp_is_subagent "$payload")" ] && exit 0
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
exec ${SPEX:-spex} internal session-fail --session "$sid"
