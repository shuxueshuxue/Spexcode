#!/usr/bin/env bash
# @@@ mark-active - PreToolUse freshness hook. "About to use a tool" == the agent is actively working,
# so flip this worktree's .session to `active` (and drop the now-stale proposal/note). Fires BEFORE the
# tool runs, so a `spex session done` declaration — itself a tool — lands AFTER this and wins; the next
# real tool after a declaration flips back to active, making the Stop gate force a fresh re-declaration.
# Robust to ANY resume path (no turn-start hook needed). Cheapest path: no-op when already active.
# Pure shell (no node/tsx) so it's fast even firing on every tool call. cwd = the session worktree.
f=.session
[ -f "$f" ] || exit 0
grep -q '^status: active$' "$f" 2>/dev/null && exit 0   # already active → nothing to do (cheap)
tmp=$(mktemp) || exit 0
awk '
  /^status:/   { print "status: active"; seen=1; next }
  /^proposal:/ { next }   # stale once the agent resumes work
  /^note:/     { next }
  { print }
  END { if (!seen) print "status: active" }
' "$f" > "$tmp" && mv "$tmp" "$f"
exit 0
