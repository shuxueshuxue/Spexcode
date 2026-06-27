---
title: session-fail
surface: hook
status: active
hue: 200
events:
- StopFailure
order: 10
block: false
---
When a turn ends not because the agent declared but because the API itself failed, this hook structurally marks the session `error`. A failed turn is a real outcome the board must show, and without this signal the session would freeze under whatever state it last held — reading as "active" or "awaiting" long after it actually died.

It is non-blocking and unconditional on the failure event: the failure already happened, so the only job is to record it truthfully. By turning an API error into a declared `error` state it keeps the [[stop-gate]] family's invariant intact — a session's displayed state always reflects what is really true of its last turn — for the one stop path the agent cannot narrate itself.
