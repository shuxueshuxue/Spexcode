---
title: session-timeline-projection
status: active
hue: 280
desc: SpexCode's HTTP timeline projection resolves governed aliases and adds display vocabulary over the reusable durable tail.
code:
  - spec-cli/src/session-timeline.ts
related:
  - packages/session-core/src/session-timeline.ts
  - spec-cli/src/index.ts
---
# session-timeline-projection

The reusable package reads the canonical durable tail without board policy. The CLI wrapper resolves a public
record alias, refuses absent or non-governed rows on the HTTP surface, and maps authored lifecycle values to
SpexCode's display words. After the session application cutover it reads the application event stream instead of
the retired ndjson timeline; the projection still does not append, segment, or cursor either history source.
