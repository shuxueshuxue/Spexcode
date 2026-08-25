---
title: session-timeline-projection
status: active
hue: 280
desc: SpexCode's HTTP timeline projection resolves governed aliases and adds display vocabulary over the reusable durable tail.
code:
  - spec-cli/src/session-timeline.ts
related:
  - spec-cli/src/session-timeline.ts
  - packages/session-events/src/schema.ts
  - spec-cli/src/index.ts
---
# session-timeline-projection

The reusable package reads the canonical durable tail without board policy. The CLI wrapper resolves a public
record alias, refuses absent or non-governed rows on the HTTP surface, and maps authored lifecycle values to
SpexCode's display words. After the session application cutover it reads the application event stream instead of
the retired ndjson timeline; the projection still does not append, segment, or cursor either history source.
The timeline is a history: events are shown in occurrence order, sequence breaking ties, so migrated legacy history
(`session.state.migrated.v1` / `session.message.migrated.v1`, appended after the live events but older than them)
appears where it happened and maps to the same status and sent rows as its live counterparts. The stamp stays the
last appended sequence, which is what a follower's cheap tick compares.
