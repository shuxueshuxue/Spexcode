#!/usr/bin/env bash
# @@@ spec-first - a ONE-SHOT PreToolUse nudge, wired alongside mark-active. The FIRST time a session
# ACCESSES code — READS or mutates a non-spec file — WITHOUT having touched its spec, it blocks once to
# remind: read the node's spec AND its neighbors first, then reconcile against it (change the spec, or make
# the code honor it) — never silently diverge. It once fired only on code-MUTATING tools, which let a pure
# understanding/analysis session sail past it (the grounding gap): an agent reasoned straight from the code
# without ever opening the contract. Widening the trigger to Read closes that. The sentinel makes it fire at
# most once per session; the re-issued tool call passes. An agent whose first code touch IS its spec — reading
# or editing it — is blessed silently. Pure shell (no node/tsx).
# @@@ all sessions, global sentinel - spec-awareness is UNIVERSAL, so this is NOT gated on `governed`: it
# serves any agent (dashboard or user-self-launched). It has no worktree state to read any more — the
# once-per-session sentinel lives in the session's GLOBAL store dir (keyed by the harness session_id from the
# payload, grouped per-project — mirrors spec-cli/src/layout.ts), created on demand. The node it points at is
# read from the global record when the session is bound to one (a dashboard session); a self-launched agent
# has no record, so it falls back to the generic "find the governing node" nudge. cwd = the session worktree.
payload=$(cat 2>/dev/null)
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
[ -n "$gcd" ] || exit 0
enc=$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')
sdir="${SPEXCODE_HOME:-$HOME/.spexcode}/projects/$enc/sessions/$sid"
rec="$sdir/session.json"
sent="$sdir/spec-checked"
[ -f "$sent" ] && exit 0           # already reminded or blessed this session → silent, every later access passes

# the tool about to run; keyed on the field name, not a blind substring (an input mentioning "Edit" can't trip it).
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$tool" in Read|Edit|Write|NotebookEdit) ;; *) exit 0 ;; esac   # code-ACCESS tools (read or mutate)

# the target path: file_path (Read/Edit/Write) or notebook_path (NotebookEdit). Two seds — BSD sed has no \| alternation.
path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# reading or editing the spec itself IS spec-first → bless silently (set the sentinel, allow). MUST come
# first: the nudge tells the agent to read its spec, so a spec Read can never be the thing we block.
case "$path" in */.spec/*|.spec/*|*/spec.md|spec.md) mkdir -p "$sdir"; : > "$sent"; exit 0 ;; esac
case "$path" in "") exit 0 ;; esac   # no path → ignore WITHOUT consuming the one-shot.

# first code access without having touched the spec → set the sentinel (so this fires exactly once), nudge once.
mkdir -p "$sdir"; : > "$sent"
node=$(sed -n 's/.*"node"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$rec" 2>/dev/null | head -1)
if [ -n "$node" ]; then
  sp=$(find .spec -path "*/$node/spec.md" 2>/dev/null | head -1)
  where="your node's spec (${sp:-.spec/.../$node/spec.md})"
else
  where="the spec node that governs this area (run: spex search <topic>)"
fi
printf '{"decision":"block","reason":"Before working in this code, read %s FIRST — it is the current contract — and read its NEIGHBORS too (the parent that scopes it, the siblings it borders, the children that refine it), since its intent is only fully legible against the surrounding tree. Then act deliberately: changing the intent? edit the spec first so spec and code land together. implementing existing intent? make the code honor the spec. The one forbidden move is code that silently diverges from its spec. (Fires once per session, at your first code read or edit.)"}\n' "$where"
exit 0
