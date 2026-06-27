#!/usr/bin/env bash
# @@@ spec-of-file - a PostToolUse ANNOTATE hook: the FIRST time a session edits a given file, it tells the
# agent which spec node(s) GOVERN it — and, when a file is OVER-owned (> maxOwners), flags it as doing too
# much and points at the split — so the contract is in view AT THE MOMENT OF THE EDIT, not just later at
# commit (lint/drift). NON-BLOCKING (additionalContext only — never a verdict) and dedup'd PER FILE via a
# ledger, so a 50-edit refactor annotates each file ONCE. Uses MAIN's tsx+cli ($SPEX) for the file→spec
# resolve (`spex owner`); cwd = the session worktree.
# @@@ all sessions, global ledger - like [[spec-first]], spec-awareness is UNIVERSAL so this is NOT gated on
# `governed`. It has no worktree state any more — the once-per-file ledger lives in the session's GLOBAL store
# dir (keyed by the harness session_id from the payload, grouped per-project — mirrors spec-cli/src/layout.ts).
S="${SPEX:-spex}"
payload=$(cat 2>/dev/null)
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
[ -n "$gcd" ] || exit 0
enc=$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')
sdir="${SPEXCODE_HOME:-$HOME/.spexcode}/projects/$enc/sessions/$sid"

tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$tool" in Edit|Write|NotebookEdit) ;; *) exit 0 ;; esac
path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || exit 0
# editing the spec itself is not a governed-code edit → nothing to annotate.
case "$path" in */.spec/*|.spec/*|*/spec.md|spec.md) exit 0 ;; esac
# dedupe: once per session per file. The ledger lists already-annotated paths.
led="$sdir/spec-of-file-seen"
[ -f "$led" ] && grep -qxF -- "$path" "$led" && exit 0
mkdir -p "$sdir"; echo "$path" >> "$led"
msg=$($S owner "$path" --actionable 2>/dev/null)   # --actionable: silent on a sanely-owned file; speaks only for an OVER-owned / uncovered file
[ -n "$msg" ] || exit 0
esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$esc"
exit 0
