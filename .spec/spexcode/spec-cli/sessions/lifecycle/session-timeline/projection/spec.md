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
the retired ndjson timeline; the projection still does not append or segment either history source.
The timeline is a history: events are shown in occurrence order, sequence breaking ties, so migrated legacy history
(`session.state.migrated.v1` / `session.message.migrated.v1`, appended after the live events but older than them)
appears where it happened and maps to the same status and sent rows as its live counterparts. The stamp stays the
last appended sequence, which is what a follower's cheap tick compares.

**This is where a window is cut, and the two orders are kept apart.** [[session-timeline]] defines the window a
reader holds; the projection is what answers it. A growth read (`since`) is served from the event store's own
sequence range — it never materializes the history, which is the whole point of it on a record with thousands of
events. A positioned read (tail, or `before`) is served from the ordered history, because a position is a position
in what the reader SEES, and migrated history makes that order differ from the sequence. The projection reports
the window's `offset`, the history's `total`, and the `priorWorking` the events before the window already said,
so no reader has to infer any of the three from the events it happens to have been given.
