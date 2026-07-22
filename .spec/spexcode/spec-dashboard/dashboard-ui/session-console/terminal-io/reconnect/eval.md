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
  - name: heartbeat-detects-silent-half-open
    tags: [frontend-e2e, desktop]
    description: >-
      Drive the real `createResilientSocket` HEADLESSLY with an injected fake WebSocket, fake timers, and a
      fake clock. The fake socket OPENS, delivers a frame or two, then goes silent FOREVER without ever
      firing a close event and with `readyState` stuck at OPEN — the half-open link a NAT / tunnel /
      reverse-proxy leaves behind when it tears an idle connection down without notifying the browser
      (the terminal-frozen-until-manual-refresh bug). Advance the virtual clock well past the dead window
      (2.5× the server's 10s ping cadence = 25s) and watch: whether a new socket is constructed, what
      `onState` reports, whether each inbound terminal ping emits pong, and (control case) that a link kept
      alive by periodic inbound pings within the window is NEVER dropped by the watchdog. Against a live
      backend, also hold open one previous-bundle-shaped browser client that does not answer the text ping
      but does automatically answer WebSocket protocol ping, beside a true ghost with protocol auto-pong
      disabled.
    expected: >-
      An OPEN socket silent past the 25s dead window is PRESUMED DEAD: the helper force-drops it and
      constructs a replacement through the normal backoff/reopen machinery, with `onState` surfacing
      'reconnecting' — recovery is loud and automatic, no manual page refresh. Late events from the zombie
      socket are ignored (superseded-socket guard). Inbound traffic of ANY kind — a real frame or the
      server's keep-alive ping — resets the silence measurement, so a healthy-but-quiet link inside the
      window is never falsely dropped. Every terminal ping receives one transport-level pong so the server's
      immediately previous generation remains compatible. Server-side, the old client stays attached beyond
      the dead window on its browser-native protocol pong, while the true ghost is detached and closed at the
      deadline. An intentional close() still suppresses every reopen. The old
      behaviour (60s of total silence produced zero reconnect attempts, sockets-created stayed 1) is gone.
    code: spec-dashboard/src/resilientSocket.js
    related: spec-dashboard/src/resilientSocket.test.mjs, spec-cli/src/index.ts
---
# eval.md — reconnect

The reconnect is a thin TRANSPORT concern, and the node's own contract makes the loss headlessly measurable:
the WebSocket impl and the timers are INJECTABLE, so the whole state machine — escalating-vs-capped backoff,
stable-open reset, flapping escalation, intentional-close suppression, the connecting/open/reconnecting health
caption — is driven directly with a fake socket and fake clock, no browser and no real network. The loss
watched is a pane that needs a manual refresh after a backend restart: the socket must reopen ITSELF, loudly,
and only on a genuine drop.
