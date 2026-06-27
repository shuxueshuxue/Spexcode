#!/usr/bin/env bash
# @@@ mark-active - the SINGLE freshness hook, wired to BOTH UserPromptSubmit and PreToolUse. It branches
# on ONE structured field read straight from the hook payload (stdin JSON), so the state is HARD — never
# text-sniffed from the TUI:
#   tool_name == AskUserQuestion → the agent is pausing to ask the HUMAN → status: asking, with the
#                                  first question's text as the note. This is the deterministic capture of
#                                  a question (the agent need not also call `spex session ask`).
#   any other tool, or a prompt submit (which carries no tool_name) → the agent is working → status: active
#                                  (and drop the now-stale proposal/note).
# Fires BEFORE the tool runs, so a `spex session done` declaration (itself a tool) lands AFTER this and
# wins; the next real tool after a declaration flips back to active, forcing a fresh Stop-gate declaration.
# That same next-tool rule clears asking back to active once the agent resumes work. Pure shell (no
# node/tsx) so it stays cheap firing on every tool call. cwd = the session worktree.
# @@@ runtime dir - state lives at `.session/state` (the runtime-dir layout); a legacy in-flight worktree
# still has the flat `.session` FILE. Resolve to whichever exists so the hook spans the migration.
if [ -d .session ]; then f=.session/state; else f=.session; fi
[ -f "$f" ] || exit 0
payload=$(cat 2>/dev/null)
# the value of the "tool_name" field (empty on UserPromptSubmit, which carries no tool). Keyed on the
# field name, not a blind substring, so another tool's input mentioning the word can't trip it.
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
[ "$status" = active ] && grep -q '^status: active$' "$f" 2>/dev/null && exit 0

tmp=$(mktemp) || exit 0
awk -v st="$status" -v note="$note" '
  /^status:/   { print "status: " st; seen=1; next }
  /^proposal:/ { next }   # stale once the agent resumes work / asks
  /^note:/     { next }
  { print }
  END {
    if (!seen) print "status: " st
    if (note != "") print "note: " note
  }
' "$f" > "$tmp" && mv "$tmp" "$f"
exit 0
