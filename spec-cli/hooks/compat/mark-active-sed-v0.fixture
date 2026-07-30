#!/usr/bin/env bash
# @@@ mark-active - the SINGLE freshness hook, wired to BOTH UserPromptSubmit and PreToolUse. It branches
# on ONE structured signal read straight from the hook payload (stdin JSON), so the state is HARD — never
# text-sniffed from the TUI:
#   the agent is pausing to ask the HUMAN (hp_is_ask) → status: asking, with the question text as the note
#                                  (the deterministic capture of a question).
#   any other tool, or a prompt submit → the agent is working → status: active (drop a now-stale proposal/note).
# WHAT counts as "asking" is the [[harness-adapter]]'s call (Claude: the AskUserQuestion tool; Codex: the
# request_user_input tool) — read via hp_is_ask, so this hook never names a harness tool.
# Fires BEFORE the tool runs, so a `spex session done` declaration (itself a tool) lands AFTER this and wins;
# the next real tool flips back to active, forcing a fresh Stop-gate declaration. Pure shell (no node/tsx) so
# it stays cheap on every tool call — it value-replaces status/proposal/note in session.json with sed, never jq.
# @@@ global store - state lives NOT in the worktree but in the per-session GLOBAL record session.json, keyed
# by the harness session_id, grouped per-project (see hp_store_dir). GATED on `governed`: a user-self-launched
# (non-governed) session has no board to feed, so this no-ops on it. cwd = the session worktree.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
rec="$sdir/session.json"
# board-lifecycle gate: only a GOVERNED (dashboard-launched) session has a board state to maintain.
grep -q '"governed"[[:space:]]*:[[:space:]]*true' "$rec" 2>/dev/null || exit 0

jget() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$rec" 2>/dev/null | head -1; }

if [ -n "$(hp_is_ask "$payload")" ]; then
  status=asking
  note=$(hp_ask_note "$payload")   # first question's text → the note (best-effort)
else
  status=active
  note=
fi

# cheap path: already active with nothing stale to clear → no-op (the common every-tool case).
[ "$status" = active ] && [ "$(jget status)" = active ] && [ -z "$(jget proposal)" ] && [ -z "$(jget note)" ] && exit 0

# value-replace status + clear proposal + (re)set note, in place. The record is written one-field-per-line
# with these keys ALWAYS present (sessions.ts writeRecord), so each is a single value substitution — no key
# add/remove, no JSON parser. Escape \ / & in the note for the sed REPLACEMENT (the note never contains ").
note_esc=$(printf '%s' "$note" | sed 's/[\\/&]/\\&/g')
tmp=$(mktemp) || exit 0
sed -e "s/\(\"status\"[[:space:]]*:[[:space:]]*\)\"[^\"]*\"/\1\"$status\"/" \
    -e "s/\(\"proposal\"[[:space:]]*:[[:space:]]*\)\"[^\"]*\"/\1\"\"/" \
    -e "s/\(\"note\"[[:space:]]*:[[:space:]]*\)\"[^\"]*\"/\1\"$note_esc\"/" \
    "$rec" > "$tmp" && mv "$tmp" "$rec"
exit 0
