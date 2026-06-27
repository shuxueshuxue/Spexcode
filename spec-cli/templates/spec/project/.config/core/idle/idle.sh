#!/usr/bin/env bash
# On an idle_prompt notification, mark the session idle (the active-only guard in `session idle` keeps a
# deliberate awaiting/asking/parked/error declaration from being clobbered). GATED on `governed`: only a
# dashboard-launched session has board state to mark — a self-launched agent's idle is none of our business.
# State lives in the per-session GLOBAL record session.json (keyed by the harness session_id from the payload,
# grouped per-project — mirrors spec-cli/src/layout.ts); the id is passed to the cli via `--session` so it
# writes the right record without depending on the worktree (which no longer holds any session file).
payload=$(cat 2>/dev/null)
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
[ -n "$gcd" ] || exit 0
enc=$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')
rec="${SPEXCODE_HOME:-$HOME/.spexcode}/projects/$enc/sessions/$sid/session.json"
grep -q '"governed"[[:space:]]*:[[:space:]]*true' "$rec" 2>/dev/null || exit 0
case "$payload" in *'"notification_type":"idle_prompt"'*) exec ${SPEX:-spex} session idle --session "$sid" ;; esac
