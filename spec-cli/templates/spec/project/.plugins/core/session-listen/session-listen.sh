#!/usr/bin/env bash
set -u
SPEX_PROFILE_VALUE="${SPEX_PROFILE:-full}"
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
hp_profile_hook_enabled session-listen
profile_status=$?
[ "$profile_status" -eq 1 ] && exit 0
[ "$profile_status" -ne 0 ] && exit "$profile_status"

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

capability_error() {
  printf "session-listen: required delivery capability '%s' is unavailable; install compatible tooling or repair PATH before retrying\n" "$1" >&2
  exit 2
}

escape_awk='
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
'
control_pattern='(^|[[:space:]])(00|01|02|03|04|05|06|07|08|0b|0c|0e|0f|1[0-9a-f])([[:space:]]|$)'
body64_sed='s/.*"bodyBase64":"\([^"]*\)".*/\1/p'

# Existence is not capability. These fixed vectors prove every non-default operation before at-most-once dequeue.
[ "$(printf ' A ' | tr -d '[:space:]')" = A ] || capability_error 'tr -d character classes'
[ "$(printf A | od -An -v -tx1 | tr -d '[:space:]')" = 41 ] || capability_error 'od hexadecimal bytes'
[ "$(printf QQ== | base64 -d 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]')" = 41 ] \
  || capability_error 'base64 -d exact decoding'
[ "$(printf '\303\251' | iconv -f UTF-8 -t UTF-8 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]')" = c3a9 ] \
  || capability_error 'iconv UTF-8 validation'
printf ' 00 ' | grep -Eq "$control_pattern" || capability_error 'grep extended quiet match'
if printf ' 0a ' | grep -Eq "$control_pattern"; then capability_error 'grep extended quiet exclusion'; fi
[ "$(printf AB | tail -c 1)" = B ] || capability_error 'tail byte selection'
[ "$(printf '%s' '{"bodyBase64":"QQ=="}' | sed -n "$body64_sed")" = QQ== ] \
  || capability_error 'sed JSON field extraction'
[ "$(printf 'A\nB\n' | awk "$escape_awk")" = 'A\nB' ] || capability_error 'awk JSON text escaping'
[ "$(printf A | cat)" = A ] || capability_error 'cat byte emission'

# @@@ a failed delivery must not eat the person's own prompt - this hook runs ON UserPromptSubmit, so exiting 2
# BLOCKS what the person just typed. Two different harms came out of that. A transient dequeue failure consumed
# nothing, yet the person lost their own unrelated prompt for it. And a failure AFTER a successful dequeue lost
# the peer message for good (the queue is at-most-once) and then took the person's prompt as a second casualty
# — blocking cannot bring the message back, it only doubles the loss. So a delivery failure reports itself
# through the SAME channel the message would have used and lets the prompt through. The notice is ASCII only
# (an id and base64), so it needs no escaping pass of its own.
notify_failure() {
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$1"
  printf '%s\n' "$1" >&2
  exit 0
}

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
    decoded=$(mktemp "${TMPDIR:-/tmp}/spex-session-listen.XXXXXX") \
      || notify_failure 'session-listen could not allocate a temporary body file, so it read nothing this turn. Repair TMPDIR. Any queued message is still queued.'
    escaped_file="$decoded.escaped"
    output_file="$decoded.output"
    if ! : >"$escaped_file" || ! : >"$output_file"; then
      rm -f "$decoded" "$escaped_file" "$output_file"
      notify_failure 'session-listen could not prepare its temporary delivery files, so it read nothing this turn. Repair TMPDIR. Any queued message is still queued.'
    fi
    cleanup() { rm -f "$decoded" "$escaped_file" "$output_file"; }
    trap cleanup EXIT
    raw=$("$cli" dequeue --session-id "$sid") || notify_failure 'session-listen could not read the message queue this turn. Nothing was consumed, so any queued message is still there and arrives on the next turn.' 
    [ "$raw" = 'null' ] && exit 0
    body64=$(printf '%s' "$raw" | sed -n "$body64_sed")
    message_id=$(printf '%s' "$raw" | sed -n 's/.*"messageId":"\([^"]*\)".*/\1/p')
    [ -n "$body64" ] || {
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "invalid-json-missing-bodyBase64" "$message_id" "$body64")"
    }
    if ! printf '%s' "$body64" | base64 -d >"$decoded" 2>/dev/null; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "invalid-bodyBase64" "$message_id" "$body64")"
    fi
    if ! iconv -f UTF-8 -t UTF-8 "$decoded" >/dev/null 2>/dev/null; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "non-utf8-body" "$message_id" "$body64")"
    fi
    if od -An -v -tx1 "$decoded" | grep -Eq "$control_pattern"; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "control-byte-body" "$message_id" "$body64")"
    fi
    if ! awk "$escape_awk" "$decoded" >"$escaped_file"; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "encode-failed" "$message_id" "$body64")"
    fi
    if [ -s "$decoded" ] && [ ! -s "$escaped_file" ]; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "encoded-to-empty" "$message_id" "$body64")"
    fi
    last_byte=$(tail -c 1 "$decoded" | od -An -tx1 | tr -d '[:space:]')
    if ! {
      printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"'
      cat "$escaped_file"
      [ "$last_byte" = 0a ] && printf '\\n'
      printf '"}}\n'
    } >"$output_file"; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "assemble-failed" "$message_id" "$body64")"
    fi
    if ! cat "$output_file"; then
      notify_failure "$(printf 'session-listen dequeued a message it could not deliver, and the queue is at-most-once, so the message is gone from it. Recover it from this line. reason=%s messageId=%s bodyBase64=%s' "emit-failed" "$message_id" "$body64")"
    fi
    ;;
esac
