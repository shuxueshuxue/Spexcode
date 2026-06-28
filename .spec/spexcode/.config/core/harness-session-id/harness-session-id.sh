#!/usr/bin/env bash
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
[ "$SPEXCODE_HARNESS" = codex ] || exit 0                      # only codex mints a separate native thread id
sock="$(hp_store_dir "$sid")/codex-app-server.sock"            # the PER-SESSION app-server socket (one thread)
[ -S "$sock" ] || exit 0                                       # TUI not up yet → a later event retries
hid=$(${SPEX:-spex} codex-thread "$sock" 2>/dev/null); [ -n "$hid" ] || exit 0   # thread/loaded/list → the one thread
${SPEX:-spex} session harness-id --session "$sid" --harness-session "$hid" >/dev/null 2>&1 || true
exit 0
