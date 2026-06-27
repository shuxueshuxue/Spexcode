#!/usr/bin/env bash
# @@@ mark-active - the SINGLE freshness hook, wired to BOTH UserPromptSubmit and PreToolUse. It branches
# on ONE structured field read straight from the hook payload (stdin JSON), so the state is HARD — never
# text-sniffed from the TUI:
#   tool_name == AskUserQuestion → the agent is pausing to ask the HUMAN → status: asking, with the
#                                  first question's text as the note (the deterministic capture of a question).
#   any other tool, or a prompt submit (no tool_name) → the agent is working → status: active (drop a now-
#                                  stale proposal/note).
# Fires BEFORE the tool runs, so a `spex session done` declaration (itself a tool) lands AFTER this and wins;
# the next real tool flips back to active, forcing a fresh Stop-gate declaration. Pure shell (no node/tsx) so
# it stays cheap on every tool call — it value-replaces status/proposal/note in session.json with sed, never jq.
# @@@ global store - state lives NOT in the worktree but in the per-session GLOBAL record session.json, keyed
# by the harness session_id from the payload, grouped per-project (mirrors spec-cli/src/layout.ts — keep in
# lockstep). GATED on `governed`: a user-self-launched (non-governed) session has no board to feed, so this
# no-ops on it. cwd = the session worktree (used only to resolve the project key).
payload=$(cat 2>/dev/null)
# resolve this session's global record: <SPEXCODE_HOME:-~/.spexcode>/projects/<enc(main-root)>/sessions/<id>/.
# main-root = dirname(ABSOLUTE git-common-dir) — the same answer from main or any worktree (NOT --show-toplevel,
# which in a worktree is the worktree). Resolve to ABSOLUTE first (never dirname a relative `.git`).
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
[ -n "$gcd" ] || exit 0
enc=$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')
rec="${SPEXCODE_HOME:-$HOME/.spexcode}/projects/$enc/sessions/$sid/session.json"
# board-lifecycle gate: only a GOVERNED (dashboard-launched) session has a board state to maintain.
grep -q '"governed"[[:space:]]*:[[:space:]]*true' "$rec" 2>/dev/null || exit 0

jget() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$rec" 2>/dev/null | head -1; }
# the value of the "tool_name" field (empty on UserPromptSubmit). Keyed on the field name, not a blind
# substring, so another tool's input mentioning the word can't trip it.
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ "$tool" = AskUserQuestion ]; then
  status=asking
  # first question's text → the note (best-effort; a question with embedded quotes may truncate).
  note=$(printf '%s' "$payload" | grep -o '"question"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
    | sed 's/^"question"[[:space:]]*:[[:space:]]*"//; s/"$//')
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
