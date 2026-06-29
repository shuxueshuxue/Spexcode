#!/usr/bin/env bash
# @@@ spec-of-file - a PostToolUse ANNOTATE hook: the FIRST time a session edits a given file, it tells the
# agent which spec node(s) GOVERN it — and, when a file is OVER-owned (> maxOwners), flags it as doing too
# much and points at the split — so the contract is in view AT THE MOMENT OF THE EDIT, not just later at
# commit (lint/drift). NON-BLOCKING (additionalContext only — never a verdict) and dedup'd PER FILE via a
# ledger, so a 50-edit refactor annotates each file ONCE. Uses MAIN's tsx+cli ($SPEX) for the file→spec
# resolve (`spex owner`); cwd = the session worktree.
# @@@ harness-agnostic - WHICH tool/path counts as a code MUTATION is the [[harness-adapter]]'s call, read via
# hp_code_path … mutate (Claude Edit/Write/NotebookEdit + file_path; Codex tool_name:Bash + an apply_patch /
# write-shape command). So this annotates edits on Claude AND Codex.
# @@@ all sessions, global ledger - like [[spec-first]], spec-awareness is UNIVERSAL so this is NOT gated on
# `governed`. The once-per-file ledger lives in the session's GLOBAL store dir (keyed by the harness
# session_id, grouped per-project — see hp_store_dir).
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
S="${SPEX:-spex}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
repo=$(cd "$repo" 2>/dev/null && pwd -P) || exit 0

hp_actionable_repo_path() {
  local raw="$1" target dir base abs rel
  case "$raw" in
    /*) target="$raw" ;;
    *)  target="$PWD/$raw" ;;
  esac
  dir=${target%/*}; base=${target##*/}
  [ "$dir" = "$target" ] && dir=.
  abs=$(cd "$dir" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$base") || return 1
  case "$abs" in
    "$repo"/*) rel=${abs#"$repo"/} ;;
    *) return 1 ;;
  esac
  [ -n "$rel" ] || return 1
  # editing the spec itself is not a governed-code edit -> nothing to annotate.
  case "$rel" in .spec/*|*/.spec/*|*/spec.md|spec.md|.git/*) return 1 ;; esac
  # Speak only for files Git would care about: tracked files, or untracked files that are not ignored.
  git -C "$repo" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1 && { printf '%s' "$rel"; return 0; }
  git -C "$repo" check-ignore -q -- "$rel" && return 1
  printf '%s' "$rel"
}

# the code file(s) just MUTATED (empty when this tool didn't mutate a file, e.g. a pure read). A codex
# multi-file apply_patch yields several paths (one per line) — annotate EACH governed code file, once.
paths=$(hp_code_path "$payload" mutate)
[ -n "$paths" ] || exit 0
led="$sdir/spec-of-file-seen"   # dedupe: once per session per file. Lists already-annotated paths.
msg=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  path=$(hp_actionable_repo_path "$path") || continue
  [ -f "$led" ] && grep -qxF -- "$path" "$led" && continue
  mkdir -p "$sdir"; echo "$path" >> "$led"
  m=$(cd "$repo" && $S owner "$path" --actionable 2>/dev/null)   # --actionable: silent on a sanely-owned file; speaks only for an OVER-owned / uncovered file
  [ -n "$m" ] || continue
  msg="${msg:+$msg
}$m"
done <<EOF
$paths
EOF
[ -n "$msg" ] || exit 0
esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}')
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$esc"
exit 0
