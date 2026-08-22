---
title: session runtime production cut-in yatu
status: active
hue: 280
desc: Real backend proof for the configured Spex session runtime composition.
code:
  - spec-cli/src/session-runtime-production.yatu.test.ts
related:
  - .spec/spexcode/session-runtime/production-cutin/spec.md
---
# session runtime production cut-in yatu

The fixture starts the actual Spex backend with an explicit local database path, creates a parent and child through
`/api/sessions`, changes child state, reads its typed event, restarts the backend, replays the event, binds an explicit
native identity, rejects a stale generation, publishes a notification, and dequeues it through the watching session.
