---
title: session-fail
surface: hook
status: active
hue: 200
events:
- StopFailure
order: 10
block: false
code:
- .spec/spexcode/.plugins/core/session-fail/fail.sh
---
When a turn ends not because the agent declared but because the API itself failed, this hook structurally marks the session `error`. A failed turn is a real outcome the board must show, and without this signal the session would freeze under whatever state it last held — reading as "active" or "awaiting" long after it actually died.

It is non-blocking on the failure event: the failure already happened, so the only job is to report it truthfully. As a board-lifecycle hook it acts only on a GOVERNED session — resolved in the global store from the payload's `session_id` — and writes via `spex internal session-fail --session <id>`. That machine entry reaches the same live-active compare-and-set as Codex's native failed completion and a headless turn's non-zero exit ([[harness-adapter]]): only an undeclared, non-stopped `active` record becomes `error`. A declaration, explicit stop, archive, or newer turn that won the race remains authoritative; a late native failure never rewrites it. This one writer keeps the [[stop-gate]] family's invariant intact for every harness while each adapter retains only its native failure signal.
