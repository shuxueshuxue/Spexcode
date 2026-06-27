#!/usr/bin/env bash
# Mark the session errored when a turn ends on an API failure (StopFailure). GATED on `governed`: only a
# dashboard-launched session has board state to mark. State lives in the per-session GLOBAL record (keyed by
# the harness session_id, grouped per-project — see hp_store_dir); the id is passed to the cli via `--session`
# so it writes the right record without depending on the worktree.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
rec="$sdir/session.json"
grep -q '"governed"[[:space:]]*:[[:space:]]*true' "$rec" 2>/dev/null || exit 0
exec ${SPEX:-spex} session fail --session "$sid"
