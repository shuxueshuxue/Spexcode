#!/usr/bin/env bash
# @@@ harness.sh - the SHELL face of the [[harness-adapter]] (spec-cli/src/harness.ts). The hook scripts run
# as pure shell, so they cannot import the TS adapter; this sourced library is its mirror. dispatch.sh sources
# it and exports SPEXCODE_HARNESS (claude|codex) — baked into the shim by each adapter, so a hook learns its
# harness deterministically, never by sniffing the payload shape. EVERY harness-divergent payload-parse lives
# HERE; the hook scripts stay harness-agnostic and just call hp_* (the one place Claude's tool names appear in
# shell, plus codex's Bash-command mapping). The session-id + global-store resolution is harness-agnostic and
# lives here too, so the six hooks no longer each repeat the git-common-dir → project-key dance.

# the string value of a top-level JSON string field (first match). Harness-agnostic — both harnesses' payloads
# carry session_id / tool_name as plain string fields. $1 = payload, $2 = field name. The value is scanned as a
# real JSON string: the closing quote is the first UNESCAPED `"`, so a value containing `\"` (a quoted literal
# inside a codex Bash/apply_patch command — extremely common) is captured WHOLE, not truncated at the inner
# quote. The standard escapes are decoded (`\"` `\\` `\/` `\n` `\t` `\r` `\b` `\f`), so a patch envelope's `\n`
# arrives as a real newline here (the downstream codex decode then no-ops). Pure awk, no jq on the hot path.
hp_field() {
  printf '%s' "$1" | awk -v field="$2" '
    BEGIN { s = ""; while ((getline line) > 0) s = s (s == "" ? "" : "\n") line }
    END {
      key = "\"" field "\""
      n = length(s); i = 1
      while (i <= n) {
        p = index(substr(s, i), key)
        if (p == 0) exit
        i += p + length(key) - 1
        # skip whitespace, require a colon, skip whitespace, require an opening quote
        while (i <= n && substr(s, i, 1) ~ /[ \t\n]/) i++
        if (substr(s, i, 1) != ":") continue
        i++
        while (i <= n && substr(s, i, 1) ~ /[ \t\n]/) i++
        if (substr(s, i, 1) != "\"") continue
        i++
        out = ""
        while (i <= n) {
          c = substr(s, i, 1)
          if (c == "\\") {
            e = substr(s, i + 1, 1)
            if      (e == "n") out = out "\n"
            else if (e == "t") out = out "\t"
            else if (e == "r") out = out "\r"
            else if (e == "b") out = out "\b"
            else if (e == "f") out = out "\f"
            else               out = out e   # \" \\ \/ and any other → the literal char
            i += 2
          } else if (c == "\"") {
            print out; exit
          } else {
            out = out c; i++
          }
        }
        exit
      }
    }'
}

# the session id from a payload (both harnesses use session_id).
# the GOVERNED record id the launcher baked into the session env (SPEXCODE_SESSION_ID) wins over the harness's
# own payload session_id. This is what lets a dashboard-launched CODEX session feed its governed record: codex
# mints its OWN thread id (un-pinnable), so the record can't be keyed by it — instead the launcher keys the
# record by a SpexCode id and exports it into the launch, and every hook resolves THAT. Claude's payload id is
# already the record id, so the env (= same value) is a harmless no-op there. A self-launched agent sets no
# env → falls back to the payload session_id (its own non-governed record). One resolver, both harnesses.
hp_session_id() { printf '%s' "${SPEXCODE_SESSION_ID:-$(hp_field "$1" session_id)}"; }

# the harness-native conversation/thread id when it differs from SpexCode's governed record id. Claude's
# pinned id is the record id already, so it contributes nothing. Codex mints an unpinnable thread id, but in
# app-server mode (our launch) its hook PAYLOAD does NOT carry it — the only place it lives is Codex's own
# rollout `session_meta`, which records both the thread `session_id` AND the `cwd`. So find the NEWEST rollout
# whose cwd is THIS worktree ($PWD, where Codex runs the hook) and read its id. SpexCode stores it as
# harness_session_id, which app-server delivery + liveness + resume all key on. Empty if no rollout yet (the
# capture re-runs on later events until one exists).
hp_harness_session_id() {
  case "$SPEXCODE_HARNESS" in
    codex)
      local home r cwd id
      home="${CODEX_HOME:-$HOME/.codex}"
      for r in $(ls -t "$home"/sessions/*/*/*/rollout-*.jsonl 2>/dev/null); do
        cwd=$(head -1 "$r" 2>/dev/null | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
        [ "$cwd" = "$PWD" ] || continue
        id=$(head -1 "$r" 2>/dev/null | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F][0-9a-fA-F-]\{34,\}\)".*/\1/p' | head -1)
        [ -n "$id" ] && { printf '%s' "$id"; return; }
      done
      ;;
  esac
}

# the per-PROJECT GLOBAL runtime dir (mirrors spec-cli/src/layout.ts `runtimeRoot`): <store>/projects/<enc>,
# keyed by the project (dirname of the ABSOLUTE git-common-dir, so the answer is identical from main or any
# worktree). This is where the materialized hook manifest + content-hash + gate lock live — NOT the worktree.
# Echoes the dir; returns non-zero (echoing nothing) when git can't resolve, so a caller can `|| exit 0`.
hp_runtime_dir() {
  local gcd
  gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
  [ -n "$gcd" ] || return 1
  printf '%s/projects/%s' "${SPEXCODE_HOME:-$HOME/.spexcode}" "$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')"
}

# the per-session GLOBAL store dir for a session id — <runtime>/sessions/<id> (sibling of the per-project
# runtime above). Echoes the dir; returns non-zero (echoing nothing) when git can't resolve.
hp_store_dir() {
  local rd; rd=$(hp_runtime_dir) || return 1
  printf '%s/sessions/%s' "$rd" "$1"
}

# the deterministic content fingerprint of the EDITABLE config roots (.config + config md/sh) — the gate's
# "did the .config move?" signal. Run with cwd = the project. ONE definition: the dispatch.sh gate sources this
# and materialize.ts shells to it, so the gate and the renderer can NEVER disagree on what "changed" means (the
# two used to inline this pipeline verbatim, each commenting the other "MUST match").
hp_config_hash() {
  find .spec/*/.config .spec/*/config \( -name '*.md' -o -name '*.sh' \) -type f -print0 2>/dev/null \
    | sort -z | xargs -0 cat 2>/dev/null | sha256sum | cut -d' ' -f1
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
# "question" field of the tool input — so it is just the first such JSON string value: collapse onto hp_field,
# which (unlike the old grep `[^"]*`) handles an embedded `\"` and decodes escapes instead of truncating.
hp_ask_note() { hp_field "$1" question; }

# the CODE file(s) a payload touches, mapped to the trigger the spec hooks key on. $2 = mode:
#   access  → the file being READ or edited ([[spec-first]] fires on any code touch)
#   mutate  → the file being EDITED      ([[spec-of-file]] fires only on a mutation)
# Echoes the path(s), ONE PER LINE — a codex multi-file apply_patch (several `*** Update File:` markers)
# touches several files in one tool call, so every consuming hook iterates the lines. Echoes nothing when the
# payload is not a code touch of that mode. The harness divergence:
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
# read yields nothing. A patch envelope can carry SEVERAL `*** Update File:` markers (a multi-file edit) — ALL
# of them are emitted, one per line, so the consuming hook acts on every touched file (a single-file patch
# emits one line; a plain command emits its one token). The plain-command path is the last path-like token
# (has a / or a .ext), ignoring flags — matches the verified-facts example `sed -n 1p f.ts` → `f.ts`.
# Best-effort: an exotic command may not resolve, which only means a missed nudge, never a wrong block.
_hp_codex_cmd_path() {
  local mode="$2" cmd
  # the command arrives as a JSON STRING value; hp_field already decodes JSON escapes (so a patch File: line
  # already ends at a real newline). This gsub is a no-op safety net for any caller that bypassed hp_field.
  cmd=$(printf '%s' "$1" | awk '{gsub(/\\n/,"\n"); gsub(/\\t/,"\t")}1')
  case "$cmd" in
    *apply_patch*|*applypatch*|*'*** Add File:'*|*'*** Update File:'*|*'*** Delete File:'*)
      printf '%s\n' "$cmd" | sed -n 's/^\*\*\* \(Add\|Update\|Delete\) File: \(.*\)$/\2/p' | sed 's/[[:space:]]*$//'
      return 0 ;;
  esac
  local is_mutate=0
  case "$cmd" in *' >> '*|*' > '*|*' >>'*|*' >'*|*' tee '*|*'sed -i'*|*' dd '*) is_mutate=1 ;; esac
  [ "$mode" = mutate ] && [ "$is_mutate" = 0 ] && return 0
  printf '%s\n' "$cmd" | tr ' \t' '\n\n' | grep -E '^[^-].*[/.][A-Za-z0-9_]+' | grep -vE '^(apply_patch|applypatch)$' | tail -1
}

# the notification type of a Notification payload (Claude only — Codex fires no Notification event).
hp_notification_type() { hp_field "$1" notification_type; }
