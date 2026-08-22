---
scenarios:
  - name: backend-parent-child-replay-and-fenced-notification
    tags: [backend-api, cli]
    description: >
      Start the real Spex backend with an explicit local database path, create a parent and child through
      /api/sessions, attach a watcher, transition child state, restart the backend, replay the event, bind and
      rebind an explicit native identity, reject a stale generation, publish a notification, and dequeue it.
    expected: >
      Parent/child state changes append session.state.changed.v1 events atomically; replay after restart returns the
      active child; the stale binding is HTTP 409; and the watching parent receives the exact durable notification
      once through the runtime dequeue boundary.
    test:
      path: spec-cli/src/session-runtime-production.yatu.test.ts
      name: "YATU: CLI-created parent/child state survives backend restart and delivers a fenced watcher notification"
    code: spec-cli/src/session-runtime-production.yatu.test.ts
---
# session runtime production cut-in yatu loss

The measurement is the spawned Spex HTTP backend and its real SQLite database. Package tests are supporting evidence;
this scenario is the product-level proof for the configured production composition.
