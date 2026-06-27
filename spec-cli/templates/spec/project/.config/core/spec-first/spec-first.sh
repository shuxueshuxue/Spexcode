#!/usr/bin/env bash
# @@@ spec-first - a ONE-SHOT PreToolUse nudge, wired alongside mark-active. The FIRST time a session
# ACCESSES code — READS or mutates a non-spec file — WITHOUT having touched its spec, it blocks once to
# remind: read the node's spec AND its neighbors first, then reconcile against it (change the spec, or make
# the code honor it) — never silently diverge. It once fired only on code-MUTATING tools, which let a pure
# understanding/analysis session sail past it (the grounding gap): an agent reasoned straight from the code
# without ever opening the contract. Widening the trigger to any code access (read or edit) closes that. The
# sentinel makes it fire at most once per session; the re-issued tool call passes. An agent whose first code
# touch IS its spec — reading or editing it — is blessed silently. Pure shell (no node/tsx).
# @@@ harness-agnostic - WHICH tool/path counts as a code access is the [[harness-adapter]]'s call, read via
# hp_code_path (Claude Read/Edit/Write/NotebookEdit + file_path; Codex tool_name:Bash + the parsed command
# path). So this hook never names Claude's tools — it fires on Claude AND Codex alike.
# @@@ all sessions, global sentinel - spec-awareness is UNIVERSAL, so this is NOT gated on `governed`: it
# serves any agent (dashboard or user-self-launched). The once-per-session sentinel lives in the session's
# GLOBAL store dir (keyed by the harness session_id, grouped per-project — see hp_store_dir), created on
# demand. The node it points at is read from the global record when the session is bound to one (a dashboard
# session); a self-launched agent has no record, so it falls back to the generic nudge. cwd = the worktree.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
rec="$sdir/session.json"
sent="$sdir/spec-checked"
[ -f "$sent" ] && exit 0           # already reminded or blessed this session → silent, every later access passes

# the code file(s) about to be read/edited (empty when this tool is not a code access, or no path resolved) →
# don't consume the one-shot for a non-code tool. A codex multi-file apply_patch yields several paths (one per
# line); this tool is a code access if ANY resolved path is a non-spec file.
paths=$(hp_code_path "$payload" access)
[ -n "$paths" ] || exit 0

# fires if ANY touched path is code; a touch that is ALL spec files IS spec-first → bless silently (set the
# sentinel, allow). MUST come first: the nudge tells the agent to read its spec, so a spec-only access can
# never be the thing we block.
is_code=0
while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$p" in */.spec/*|.spec/*|*/spec.md|spec.md) ;; *) is_code=1 ;; esac
done <<EOF
$paths
EOF
[ "$is_code" = 1 ] || { mkdir -p "$sdir"; : > "$sent"; exit 0; }

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
