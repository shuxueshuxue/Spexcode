#!/usr/bin/env bash
set -u

# A self-launch project opts in only by configuring the adopter database. No configured database means no listener.
if [ -z "${SPEX_SESSION_DATABASE_PATH+x}" ] && [ -z "${SPEX_SESSION_CONFIG+x}" ]; then
  exit 0
fi

# The explicit command is one executable path; an invalid explicit value must not silently fall through to PATH.
cli="${SPEX_SESSION_CLI:-}"
if [ -z "$cli" ]; then
  cli=$(command -v spex-session 2>/dev/null || true)
fi
if [ -z "$cli" ] || [ ! -x "$cli" ]; then
  printf '%s\n' 'session-listen: spex-session CLI not found; install @spexcode/session-selflaunch (npm install) or set SPEX_SESSION_CLI to its executable path' >&2
  exit 2
fi

for tool in awk base64 iconv od grep tail sed mktemp cat tr rm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf "session-listen: required delivery tool '%s' is missing; install it or repair PATH before retrying\n" "$tool" >&2
    exit 2
  fi
done

. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null || true)
sid=$(hp_field "$payload" session_id)
[ -n "$sid" ] || exit 0
event=$(hp_field "$payload" hook_event_name)

case "$event" in
  SessionStart)
    "$cli" initialize --session-id "$sid" >/dev/null || exit 2
    ;;
  UserPromptSubmit)
    decoded=$(mktemp "${TMPDIR:-/tmp}/spex-session-listen.XXXXXX") || {
      printf '%s\n' 'session-listen: could not allocate a temporary body file; repair TMPDIR and retry' >&2
      exit 2
    }
    escaped_file="$decoded.escaped"
    output_file="$decoded.output"
    if ! : >"$escaped_file" || ! : >"$output_file"; then
      rm -f "$decoded"
      rm -f "$escaped_file" "$output_file"
      printf '%s\n' 'session-listen: could not prepare temporary delivery files; repair TMPDIR and retry' >&2
      exit 2
    fi
    cleanup() { rm -f "$decoded" "$escaped_file" "$output_file"; }
    trap cleanup EXIT
    raw=$("$cli" dequeue --session-id "$sid") || exit 2
    [ "$raw" = 'null' ] && exit 0
    body64=$(printf '%s' "$raw" | sed -n 's/.*"bodyBase64":"\([^"]*\)".*/\1/p')
    message_id=$(printf '%s' "$raw" | sed -n 's/.*"messageId":"\([^"]*\)".*/\1/p')
    [ -n "$body64" ] || {
      printf '%s\n' 'session-listen: spex-session dequeue returned invalid JSON (missing bodyBase64)' >&2
      exit 2
    }
    if ! printf '%s' "$body64" | base64 --decode >"$decoded" 2>/dev/null; then
      printf '%s\n' 'session-listen: spex-session dequeue returned invalid bodyBase64' >&2
      exit 2
    fi
    if ! iconv -f UTF-8 -t UTF-8 "$decoded" >/dev/null 2>/dev/null; then
      printf 'session-listen: refusing non-UTF-8 body; messageId=%s bodyBase64=%s\n' "$message_id" "$body64" >&2
      exit 2
    fi
    if od -An -v -tx1 "$decoded" | grep -Eq '(^|[[:space:]])(00|01|02|03|04|05|06|07|08|0b|0c|0e|0f|1[0-9a-f])([[:space:]]|$)'; then
      printf 'session-listen: refusing control-byte body; messageId=%s bodyBase64=%s\n' "$message_id" "$body64" >&2
      exit 2
    fi
    if ! awk '
      BEGIN { ORS = "" }
      NR > 1 { printf "\\n" }
      {
        for (i = 1; i <= length($0); i++) {
          c = substr($0, i, 1)
          if (c == "\\") printf "\\\\"
          else if (c == "\"") printf "\\\""
          else if (c == "\t") printf "\\t"
          else if (c == "\r") printf "\\r"
          else if (c == "\b") printf "\\b"
          else if (c == "\f") printf "\\f"
          else printf "%s", c
        }
      }
    ' "$decoded" >"$escaped_file"; then
      printf 'session-listen: could not encode body for harness input; messageId=%s bodyBase64=%s\n' "$message_id" "$body64" >&2
      exit 2
    fi
    if [ -s "$decoded" ] && [ ! -s "$escaped_file" ]; then
      printf 'session-listen: non-empty body encoded to empty additionalContext; messageId=%s bodyBase64=%s\n' "$message_id" "$body64" >&2
      exit 2
    fi
    last_byte=$(tail -c 1 "$decoded" | od -An -tx1 | tr -d '[:space:]')
    if ! {
      printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"'
      cat "$escaped_file"
      [ "$last_byte" = 0a ] && printf '\\n'
      printf '"}}\n'
    } >"$output_file"; then
      printf 'session-listen: could not assemble harness input; messageId=%s bodyBase64=%s\n' "$message_id" "$body64" >&2
      exit 2
    fi
    if ! cat "$output_file"; then
      printf 'session-listen: could not emit harness input; messageId=%s bodyBase64=%s\n' "$message_id" "$body64" >&2
      exit 2
    fi
    ;;
esac
