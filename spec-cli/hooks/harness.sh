#!/usr/bin/env bash
# @@@ harness.sh - the SHELL face of the [[harness-adapter]] (spec-cli/src/harness.ts). The hook scripts run
# as pure shell, so they cannot import the TS adapter; this sourced library is its mirror. dispatch.sh sources
# it and exports SPEXCODE_HARNESS (claude|codex) — baked into the shim by each adapter, so a hook learns its
# harness deterministically, never by sniffing the payload shape. EVERY harness-divergent payload-parse lives
# HERE; the hook scripts stay harness-agnostic and just call hp_* (the one place Claude's tool names appear in
# shell, plus codex's Bash-command mapping). The session-id + global-store resolution is harness-agnostic and
# lives here too, so the six hooks no longer each repeat the git-common-dir → project-key dance.
# SPEXCODE_HARNESS is claude|codex|plugin: `plugin` is the bundle form ([[plugin-harness]]) and its host (z-code/
# Claude) shares Claude's payload shape, so every `case "$SPEXCODE_HARNESS"` below routes it through the claude
# branch via the default case — there is no separate `plugin)` arm to maintain.

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
# Codex hooks run inside ONE shared per-project app-server. That process can inherit the FIRST launched
# session's SPEXCODE_SESSION_ID, so on codex the payload session_id (the acting thread id) must win and then
# hp_store_dir aliases it to the governed record. Claude's payload id equals its governed record id, so the
# PAYLOAD is the acting identity; the inherited env is only a fallback for payload-less events. Env-first was
# a live bug: a nested subagent (Task tool) inherits the parent's SPEXCODE_SESSION_ID, so with env winning,
# every child tool call fired mark-active against the PARENT's record — the parent read `working` forever and
# every park/done declaration was clobbered within seconds (measured). Same staleness class the codex branch
# already guards against (payload-first below); claude now follows the same rule.
hp_session_id() {
  local pid
  case "$SPEXCODE_HARNESS" in
    codex) hp_field "$1" session_id ;;
    *)     pid=$(hp_field "$1" session_id); printf '%s' "${pid:-$SPEXCODE_SESSION_ID}" ;;
  esac
}

# the per-PROJECT GLOBAL runtime dir (mirrors spec-cli/src/layout.ts `runtimeRoot`): <store>/projects/<enc>,
# keyed by the project (dirname of the ABSOLUTE git-common-dir, so the answer is identical from main or any
# worktree). The per-session dirs and the per-tree materialize slots (hp_tree_dir) live under it.
# Echoes the dir; returns non-zero (echoing nothing) when git can't resolve, so a caller can `|| exit 0`.
hp_runtime_dir() {
  local gcd
  gcd=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || gcd=$(realpath "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
  [ -n "$gcd" ] || return 1
  printf '%s/projects/%s' "${SPEXCODE_HOME:-$HOME/.spexcode}" "$(printf '%s' "$(dirname "$gcd")" | sed 's#[/.]#-#g')"
}

# the per-WORKTREE materialize slot (mirrors layout.ts `treeSlotDir`): <runtime>/trees/<enc(worktree-toplevel)> —
# where THIS tree's materialized hook manifest + content-hash marker live. Keyed by the cwd's own
# `rev-parse --show-toplevel` through the same enc transform, so a dispatch can only ever read the manifest
# of the tree it fires in ([[hook-dispatch]] — the old single global file let the last-materialized tree's
# hook set reach every other tree's sessions). Echoes the dir; returns non-zero when git can't resolve.
hp_tree_dir() {
  local rd top
  rd=$(hp_runtime_dir) || return 1
  top=$(git rev-parse --show-toplevel 2>/dev/null)
  [ -n "$top" ] || return 1
  printf '%s/trees/%s' "$rd" "$(printf '%s' "$top" | sed 's#[/.]#-#g')"
}

# the per-session GLOBAL store dir for a session id — <runtime>/sessions/<id> (sibling of the per-project
# runtime above). Echoes the dir; returns non-zero (echoing nothing) when git can't resolve.
# ALIAS resolution: a codex hook fires from the shared per-PROJECT app-server process, whose env may carry a
# stale SPEXCODE_SESSION_ID from the first launched codex session. hp_session_id therefore returns the acting
# payload session_id on codex: the codex THREAD id, NOT the SpexCode record id the dir is keyed by. So when no
# record sits at <id> directly, find the one record that captured this id as `harness_session_id` (the backend
# stored it at thread/start, before the first tool turn).
# A grep over the few session.json files — no jq on the hot path; the trailing quote anchors the value so a
# thread id can't match a longer one as a prefix. Direct hit wins; a miss with no alias echoes the direct path
# unchanged, so the caller's `[ -e "$rec" ]` still no-ops gracefully. Mirrors layout.ts `readAliasedRawRecord`.
hp_store_dir() {
  local rd; rd=$(hp_runtime_dir) || return 1
  local direct="$rd/sessions/$1"
  if [ -e "$direct/session.json" ]; then printf '%s' "$direct"; return 0; fi
  local hit
  hit=$(grep -lF "\"harness_session_id\": \"$1\"" "$rd"/sessions/*/session.json 2>/dev/null | head -1)
  [ -n "$hit" ] && { printf '%s' "${hit%/session.json}"; return 0; }
  printf '%s' "$direct"
}

# the TOOLCHAIN's own version fingerprint — the toolchain side of the content key. The materialized artifacts
# are a function of (config content, toolchain), so a TOOLCHAIN update must move the key too, or an updated
# deploy never self-heals its stale contract/shims/manifest until someone happens to edit .plugins (the field
# lesson: a toolchain update does NOT self-heal). A source checkout answers with the git TREE hash of the
# package dir (moves exactly when the toolchain's content moves, not on every repo commit); an npm install
# (no .git) answers with the package.json hash (npm bumps the version). env-stripped git — a git hook's
# exported GIT_DIR must not misdirect repo discovery (same rule as git.ts's git()).
SPEXCODE_HP_PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
hp_toolchain_version() {
  ( cd "$SPEXCODE_HP_PKG" 2>/dev/null && env -u GIT_DIR -u GIT_INDEX_FILE git rev-parse 'HEAD:./' 2>/dev/null ) \
    || sha256sum "$SPEXCODE_HP_PKG/package.json" 2>/dev/null | cut -d' ' -f1 \
    || echo unversioned
}

# the deterministic content fingerprint of EVERYTHING the materialize is a function of: the EDITABLE config
# roots (.plugins + plugin-system md/sh), the PERSISTED POLICY files (the MAIN checkout's spexcode.json +
# spexcode.local.json — the `harnesses` set materialize reads via readConfig(mainCheckout)), and the
# toolchain version above. Since the dispatch-gate retired ([[commit-surgery]] — materialize anchors on
# git-native events only), this is a FRESHNESS STAMP materialize records after each pass, a diagnostic
# (is the last materialize current?) rather than a trigger. Run with cwd = the project. ONE definition:
# materialize.ts shells to it. env-stripped git, same rule as hp_toolchain_version.
hp_config_hash() {
  local gcd
  gcd=$(env -u GIT_DIR -u GIT_INDEX_FILE git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || gcd=$(realpath "$(env -u GIT_DIR -u GIT_INDEX_FILE git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
  { hp_toolchain_version
    find .spec/*/.plugins .spec/*/plugin-system \( -name '*.md' -o -name '*.sh' \) -type f -print0 2>/dev/null \
      | sort -z | xargs -0 cat 2>/dev/null
    [ -n "$gcd" ] && cat "$(dirname "$gcd")/spexcode.json" "$(dirname "$gcd")/spexcode.local.json" 2>/dev/null
  } | sha256sum | cut -d' ' -f1
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
