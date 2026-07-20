---
title: review-snapshot
status: active
hue: 205
desc: The server-only atomic source snapshot shared by graph assembly and paged review, retaining full rows in process while graph JSON exposes only lean summaries.
code:
  - spec-cli/src/reviewSnapshot.ts
related:
  - spec-cli/src/graph.ts
  - spec-cli/src/reviews.ts
  - spec-cli/src/graph.test.ts
  - spec-cli/src/reviewSnapshot.test.ts
---

# review-snapshot

One graph build already reconciles resident local/forge Issues and current Eval timelines. At successful
completion it atomically publishes those full source populations, including Eval histories needed to project
one selected scenario, to process memory, replacing the previous
snapshot as a unit. `/api/issues` and trunk `/api/evals` first ensure the cached graph build is current, then
read this snapshot for stable filtering/count/slice, and trunk detail projects one selected history plus its
bounded lightweight neighbors from the same generation; a sessions-only graph splice leaves it valid because
session presence is joined separately at request time.

The snapshot has no enumerable attachment to the board and is never included in graph JSON, SSE full frames,
or delta units. Reading before a successful publish fails loudly. This is a compute-sharing boundary, not a
second datastore: git/spec/eval/issue sources remain authoritative and graph invalidation remains the one
refresh trigger.
