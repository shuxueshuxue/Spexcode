#!/usr/bin/env bash
# @@@ harness.sh - the SHELL face of the [[harness-adapter]] (spec-cli/src/harness.ts). The hook scripts run
# as pure shell, so they cannot import the TS adapter; this sourced library is its mirror. dispatch.sh sources
# it and exports SPEXCODE_HARNESS (claude|codex) — baked into the shim by each adapter, so a hook learns its
# harness deterministically, never by sniffing the payload shape. EVERY harness-divergent payload-parse lives
# HERE; the hook scripts stay harness-agnostic and just call hp_* (the one place Claude's tool names appear in
# shell, plus codex's Bash-command mapping). The session-id + global-store resolution is harness-agnostic and
# lives here too, so the six hooks no longer each repeat the git-common-dir → project-key dance.

# the string value of a top-level JSON string field (first match). Harness-agnostic — both harnesses' payloads
# carry session_id / tool_name as plain string fields. $1 = payload, $2 = field name.
hp_field() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }

# the session id from a payload (both harnesses use session_id).
hp_session_id() { hp_field "$1" session_id; }

# the per-session GLOBAL store dir for a session id (mirrors spec-cli/src/layout.ts): keyed by the project
# (dirname of the ABSOLUTE git-common-dir, so the answer is identical from main or any worktree). Echoes the
# dir; returns non-zero (echoing nothing) when git can't resolve, so a caller can `|| exit 0`.
hp_store_dir() {
  local gcd enc
  gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
  [ -n "$gcd" ] || return 1
  enc=$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')
  printf '%s/projects/%s/sessions/%s' "${SPEXCODE_HOME:-$HOME/.spexcode}" "$enc" "$1"
}

# the tool a payload is about to run / just ran (harness-agnostic field name).
hp_tool() { hp_field "$1" tool_name; }

# is THIS payload the agent pausing to ask the HUMAN a question? Claude: the AskUserQuestion tool. Codex: the
# experimental request_user_input tool (its only structured ask path). Echoes "1" when yes, else nothing.
hp_is_ask() {
  case "$SPEXCODE_HARNESS" in
    codex) [ "$(hp_tool "$1")" = request_user_input ] && printf 1 ;;
    *)     [ "$(hp_tool "$1")" = AskUserQuestion ] && printf 1 ;;
  esac
}

# the question text of an ask payload (best-effort; for the board note). Both harnesses carry it under a
# "question" field of the tool input.
hp_ask_note() {
  printf '%s' "$1" | grep -o '"question"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
    | sed 's/^"question"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

# the CODE file a payload touches, mapped to the trigger the spec hooks key on. $2 = mode:
#   access  → the file being READ or edited ([[spec-first]] fires on any code touch)
#   mutate  → the file being EDITED      ([[spec-of-file]] fires only on a mutation)
# Echoes the path, or nothing when the payload is not a code touch of that mode. The harness divergence:
#   Claude — Read/Edit/Write/NotebookEdit + tool_input.file_path|notebook_path.
#   Codex  — NO file_path. An EDIT is its own first-class tool `tool_name:"apply_patch"` whose tool_input.command
#            is the bare patch envelope (`*** Update File: <path>`); a READ/shell is `tool_name:"Bash"` +
#            tool_input.command. Both carry the touched file inside `command`, so we parse that one field.
hp_code_path() {
  local payload="$1" mode="$2" tool
  tool=$(hp_tool "$payload")
  case "$SPEXCODE_HARNESS" in
    codex)
      case "$tool" in apply_patch|Bash) ;; *) return 0 ;; esac
      _hp_codex_cmd_path "$(hp_field "$payload" command)" "$mode"
      ;;
    *)
      case "$mode" in
        mutate) case "$tool" in Edit|Write|NotebookEdit) ;; *) return 0 ;; esac ;;
        *)      case "$tool" in Read|Edit|Write|NotebookEdit) ;; *) return 0 ;; esac ;;
      esac
      local p; p=$(hp_field "$payload" file_path); [ -n "$p" ] || p=$(hp_field "$payload" notebook_path)
      printf '%s' "$p"
      ;;
  esac
}

# @@@ codex command → path - the apply_patch / sed / cat path-extractor. Codex never sends a file_path; the
# touched file lives inside `command`. Two shapes: a PATCH envelope carries `*** (Add|Update|Delete) File:
# <path>` lines (always a MUTATION) — this is what the apply_patch tool sends, the bare envelope with NO literal
# `apply_patch` token, so we detect it by the File: markers themselves (the legacy `apply_patch` token is kept
# too, for a shell-wrapped invocation); a plain command (sed/cat/head/rg/…) carries the path as a token.
# A MUTATION is a patch envelope or a write shape (a redirect, tee, `sed -i`, dd of=); in `mutate` mode a pure
# read yields nothing. The path is the last path-like token (has a / or a .ext), ignoring flags — matches the
# verified-facts example `sed -n 1p f.ts` → `f.ts`. Best-effort: an exotic command may not resolve, which only
# means a missed nudge, never a wrong block.
_hp_codex_cmd_path() {
  local mode="$2" cmd
  # the command arrives as a JSON STRING value, so its newlines are the two-character escape `\n` (and tabs
  # `\t`). Decode them to real whitespace so a patch File: line ends at a newline and tokens split.
  cmd=$(printf '%s' "$1" | awk '{gsub(/\\n/,"\n"); gsub(/\\t/,"\t")}1')
  case "$cmd" in
    *apply_patch*|*applypatch*|*'*** Add File:'*|*'*** Update File:'*|*'*** Delete File:'*)
      printf '%s\n' "$cmd" | sed -n 's/^\*\*\* \(Add\|Update\|Delete\) File: \(.*\)$/\2/p' | head -1 | sed 's/[[:space:]]*$//'
      return 0 ;;
  esac
  local is_mutate=0
  case "$cmd" in *' >> '*|*' > '*|*' >>'*|*' >'*|*' tee '*|*'sed -i'*|*' dd '*) is_mutate=1 ;; esac
  [ "$mode" = mutate ] && [ "$is_mutate" = 0 ] && return 0
  printf '%s\n' "$cmd" | tr ' \t' '\n\n' | grep -E '^[^-].*[/.][A-Za-z0-9_]+' | grep -vE '^(apply_patch|applypatch)$' | tail -1
}

# the notification type of a Notification payload (Claude only — Codex fires no Notification event).
hp_notification_type() { hp_field "$1" notification_type; }
