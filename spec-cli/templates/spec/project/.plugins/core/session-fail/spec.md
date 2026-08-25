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
- .spec/project/.plugins/core/session-fail/fail.sh
---
When a turn ends not because the agent declared but because the API itself failed, this hook structurally marks the session `error`. A failed turn is a real outcome the board must show, and without this signal the session would freeze under whatever state it last held — reading as "active" or "awaiting" long after it actually died.

It is non-blocking on the failure event: the failure already happened, so the only job is to report it truthfully. As a board-lifecycle hook it passes the payload's acting `session_id` to `spex internal session-fail --session <id>`; the canonical writer, not shell parsing of `runtime.json`, resolves the governed record and owns the live-active compare-and-set. Only an undeclared, non-stopped `active` record becomes `error`. A declaration, explicit stop, or archive that landed first remains authoritative; a late native failure never rewrites it. This one writer keeps the [[stop-gate]] family's invariant intact for every harness while each adapter retains only its native failure signal.
