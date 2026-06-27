#!/usr/bin/env bash
# On an idle_prompt notification, mark the session idle (the active-only guard in `session idle`
# keeps a deliberate awaiting/asking/parked/error declaration from being clobbered).
p=$(cat 2>/dev/null)
case "$p" in *'"notification_type":"idle_prompt"'*) exec ${SPEX:-spex} session idle ;; esac
