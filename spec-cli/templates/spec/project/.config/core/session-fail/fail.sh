#!/usr/bin/env bash
# Mark the session errored when a turn ends on an API failure (StopFailure). GATED on `governed`: only a
# dashboard-launched session has board state to mark. State lives in the per-session GLOBAL record (keyed by
# the harness session_id from the payload, grouped per-project — mirrors spec-cli/src/layout.ts); the id is
# passed to the cli via `--session` so it writes the right record without depending on the worktree.
payload=$(cat 2>/dev/null)
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
[ -n "$gcd" ] || exit 0
enc=$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')
rec="${SPEXCODE_HOME:-$HOME/.spexcode}/projects/$enc/sessions/$sid/session.json"
grep -q '"governed"[[:space:]]*:[[:space:]]*true' "$rec" 2>/dev/null || exit 0
exec ${SPEX:-spex} session fail --session "$sid"
