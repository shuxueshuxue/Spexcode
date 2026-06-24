#!/usr/bin/env bash
# @@@ spec-first - a ONE-SHOT PreToolUse nudge, wired alongside mark-active. The FIRST time a session
# ACCESSES code — READS or mutates a non-spec file — WITHOUT having touched its spec, it blocks once to
# remind: read the node's spec AND its neighbors first, then reconcile against it (change the spec, or make
# the code honor it) — never silently diverge. It once fired only on code-MUTATING tools, which let a pure
# understanding/analysis session sail past it entirely (the grounding gap): an agent reasoned straight from
# the code without ever opening the contract. Widening the trigger to Read closes that — grounding should
# precede understanding, not just editing. The sentinel makes it fire at most once per session; the
# re-issued tool call passes. An agent whose first code touch IS its spec — reading or editing it — is
# blessed silently: doing it right never earns a nag. Pure shell (no node/tsx), cwd = the session worktree.
# Only ever wired into post-runtime-dir sessions, so it assumes the `.session/` layout.
sent=.session/spec-checked
[ -f .session/state ] || exit 0    # not a session worktree (no folder-layout state) → nothing to nudge
[ -f "$sent" ] && exit 0           # already reminded or blessed this session → silent, every later access passes

payload=$(cat 2>/dev/null)
# the tool about to run; keyed on the field name, not a blind substring (an input mentioning "Edit" can't trip it).
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$tool" in Read|Edit|Write|NotebookEdit) ;; *) exit 0 ;; esac   # code-ACCESS tools (read or mutate)

# the target path: file_path (Read/Edit/Write) or notebook_path (NotebookEdit). Two seds — BSD sed has no \| alternation.
path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# reading or editing the spec itself IS spec-first → bless silently (set the sentinel, allow). MUST come
# first: the nudge tells the agent to read its spec, so a spec Read can never be the thing we block.
case "$path" in */.spec/*|.spec/*|*/spec.md|spec.md) : > "$sent"; exit 0 ;; esac
# the session's own runtime state is neither code nor grounding → ignore WITHOUT consuming the one-shot.
case "$path" in */.session/*|.session/*|.session|"") exit 0 ;; esac

# first code access without having touched the spec → set the sentinel (so this fires exactly once), nudge once.
: > "$sent"
node=$(sed -n 's/^node:[[:space:]]*//p' .session/state 2>/dev/null | head -1)
if [ -n "$node" ]; then
  sp=$(find .spec -path "*/$node/spec.md" 2>/dev/null | head -1)
  where="your node's spec (${sp:-.spec/.../$node/spec.md})"
else
  where="the spec node that governs this area (run: spex board)"
fi
printf '{"decision":"block","reason":"Before working in this code, read %s FIRST — it is the current contract — and read its NEIGHBORS too (the parent that scopes it, the siblings it borders, the children that refine it), since its intent is only fully legible against the surrounding tree. Then act deliberately: changing the intent? edit the spec first so spec and code land together. implementing existing intent? make the code honor the spec. The one forbidden move is code that silently diverges from its spec. (Fires once per session, at your first code read or edit.)"}\n' "$where"
exit 0
