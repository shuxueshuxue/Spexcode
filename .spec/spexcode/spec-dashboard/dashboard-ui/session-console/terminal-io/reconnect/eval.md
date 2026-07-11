---
scenarios:
  - name: reopen-backoff-reset-and-intentional-close
    tags: [frontend-e2e, desktop]
    description: >-
      Drive the real `createResilientSocket` HEADLESSLY (the spec's own promise: the state machine is
      verifiable with no browser and no network), wiring in a fake WebSocket impl and fake setTimeout/
      clearTimeout so the backoff schedule is observable. Exercise four cases against the same helper:
      (a) a healthy open then an UNEXPECTED close; (b) a server that FLAPS (open → immediate close) several
      times in a row; (c) a connection that stays open past `stableMs`; (d) an explicit `close()` while a
      reopen is pending. Watch the `onState` transitions and the delay each reopen is scheduled with.
    expected: >-
      An unexpected close schedules a reopen with the capped, escalating backoff (500,1000,2000,4000,8000,
      then it stays at the 8000 cap) — never hammering. A flapping server (open→immediate close) keeps
      ESCALATING toward the cap because a short-lived open does not reset `attempt`. A connection that
      survives `stableMs` resets `attempt` to base, so the next drop starts again at 500. State moves
      connecting → open → reconnecting (and back to open on a successful reopen), so recovery is LOUD, never
      a silently dead pane. An intentional `close()` cancels any pending reopen and suppresses all further
      reopens — no resurrection.
    code: spec-dashboard/src/resilientSocket.js
---
# eval.md — reconnect

The reconnect is a thin TRANSPORT concern, and the node's own contract makes the loss headlessly measurable:
the WebSocket impl and the timers are INJECTABLE, so the whole state machine — escalating-vs-capped backoff,
stable-open reset, flapping escalation, intentional-close suppression, the connecting/open/reconnecting health
caption — is driven directly with a fake socket and fake clock, no browser and no real network. The loss
watched is a pane that needs a manual refresh after a backend restart: the socket must reopen ITSELF, loudly,
and only on a genuine drop.
