#!/usr/bin/env bash
# On an idle_prompt notification, mark the session idle (the active-only guard in `session idle` keeps a
# deliberate awaiting/asking/parked/error declaration from being clobbered). GATED on `governed`: only a
# dashboard-launched session has board state to mark — a self-launched agent's idle is none of our business.
# State lives in the per-session GLOBAL record session.json (keyed by the harness session_id, grouped per-
# project — see hp_store_dir); the id is passed to the cli via `--session` so it writes the right record
# without depending on the worktree (which no longer holds any session file). NOTE the Notification event is
# Claude-only ([[harness-adapter]]: Codex fires no Notification), so this never runs under Codex.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
rec="$sdir/session.json"
grep -q '"governed"[[:space:]]*:[[:space:]]*true' "$rec" 2>/dev/null || exit 0
[ "$(hp_notification_type "$payload")" = idle_prompt ] && exec ${SPEX:-spex} session idle --session "$sid"
