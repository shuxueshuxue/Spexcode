---
title: session-execution
status: active
hue: 280
desc: The session-addressed REST/SSE projection of an adapter execution trace, active only while a client watches it.
code:
  - spec-cli/src/session-execution.ts
related:
  - spec-cli/src/index.ts
  - spec-cli/src/execution-trace.ts
  - spec-cli/src/session-execution.api.test.ts
---

# session-execution

`GET /api/sessions/:id/execution` and its `/stream` companion are read-only views of the resolved adapter's
[[execution-trace]]. They validate the governed session first, return 404 for an absent/non-governed id, and
return an empty trace when that adapter has no current working note.

The stream sends one compact initial projection, then only a changed `revision` and a periodic heartbeat.
Its bounded read tick exists only while the SSE connection exists and stops on abort. It persists nothing and
never appends to `timeline.ndjson`; reconnecting simply reads the current adapter projection again.
