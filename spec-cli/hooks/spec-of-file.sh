#!/usr/bin/env bash
# @@@ spec-of-file - a PostToolUse ANNOTATE hook: the FIRST time a session edits a given file, it tells the
# agent which spec node GOVERNS it — and, when a file has many owners, flags it as a shared hub to split —
# so the contract is in view AT THE MOMENT OF THE EDIT, not just at the first-access nudge (spec-first) or
# at commit (lint/drift). NON-BLOCKING (additionalContext only — never a verdict) and dedup'd PER FILE via a
# .session ledger, so a 50-edit refactor annotates each file ONCE, never per write: the once-per-file
# discipline that keeps a pervasive signal from decaying into the noise it is meant to cure. Uses MAIN's
# tsx+cli ($SPEX) for the file→spec resolve (`spex owner`); cwd = the session worktree.
S="${SPEX:-spex}"
[ -f .session/state ] || exit 0
payload=$(cat 2>/dev/null)
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$tool" in Edit|Write|NotebookEdit) ;; *) exit 0 ;; esac
path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || exit 0
# editing the spec itself or runtime state is not a governed-code edit → nothing to annotate.
case "$path" in */.spec/*|.spec/*|*/spec.md|spec.md|*/.session/*|.session/*) exit 0 ;; esac
# dedupe: once per session per file. The ledger lists already-annotated paths.
led=.session/spec-of-file-seen
[ -f "$led" ] && grep -qxF -- "$path" "$led" && exit 0
echo "$path" >> "$led"
msg=$($S owner "$path" 2>/dev/null)
[ -n "$msg" ] || exit 0
esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$esc"
exit 0
