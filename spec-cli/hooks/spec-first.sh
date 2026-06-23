#!/usr/bin/env bash
# @@@ spec-first - a ONE-SHOT PreToolUse nudge, wired alongside mark-active. The FIRST time a session reaches
# for a code-mutating tool WITHOUT having touched its spec, it blocks once to remind: read the node's spec
# first, and reconcile against it (change the spec, or make code honor it) — never silently diverge. The
# sentinel makes it fire at most once per session; the re-issued tool call passes. An agent whose first edit
# IS its spec is blessed silently — doing it right never earns a nag. Pure shell (no node/tsx), cwd = the
# session worktree. Only ever wired into post-runtime-dir sessions, so it assumes the `.session/` layout.
sent=.session/spec-checked
[ -f .session/state ] || exit 0    # not a session worktree (no folder-layout state) → nothing to nudge
[ -f "$sent" ] && exit 0           # already reminded or blessed this session → silent, every later edit passes

payload=$(cat 2>/dev/null)
# the tool about to run; keyed on the field name, not a blind substring (an input mentioning "Edit" can't trip it).
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$tool" in Edit|Write|NotebookEdit) ;; *) exit 0 ;; esac   # only the code-mutating tools

# the target path: file_path (Edit/Write) or notebook_path (NotebookEdit). Two separate seds — BSD sed has no \| alternation.
path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$path" ] || path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# editing the spec itself IS spec-first → bless silently (set the sentinel, allow).
case "$path" in */.spec/*|.spec/*|*/spec.md|spec.md) : > "$sent"; exit 0 ;; esac

# first code write without having touched the spec → set the sentinel (so this fires exactly once), nudge once.
: > "$sent"
node=$(sed -n 's/^node:[[:space:]]*//p' .session/state 2>/dev/null | head -1)
if [ -n "$node" ]; then
  sp=$(find .spec -path "*/$node/spec.md" 2>/dev/null | head -1)
  where="your node's spec (${sp:-.spec/.../$node/spec.md})"
else
  where="the spec node that governs this area (run: spex board)"
fi
printf '{"decision":"block","reason":"Before writing code here, read %s — it is the current contract. Then act deliberately: changing the intent? edit the spec first so spec and code land together. implementing existing intent? make the code honor the spec. The one forbidden move is code that silently diverges from its spec. (This reminder fires once per session.)"}\n' "$where"
exit 0
