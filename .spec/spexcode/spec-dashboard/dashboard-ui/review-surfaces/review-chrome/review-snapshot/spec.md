---
title: review-snapshot
status: active
hue: 205
desc: The server-only atomic source snapshot shared by graph assembly and paged review, retaining full rows in process while graph JSON exposes only lean summaries.
code:
  - packages/spec-core/src/reviewSnapshot.ts
related:
  - packages/spec-core/src/graph.ts
  - spec-cli/src/reviews.ts
  - spec-cli/src/graph.test.ts
  - spec-cli/src/reviewSnapshot.test.ts
---

# review-snapshot

One graph build already reconciles resident local/forge Issues and current Eval timelines. At successful
completion it atomically publishes those full source populations, including Eval histories needed to project
one selected scenario, to process memory, replacing the previous snapshot as a unit. The first `/api/issues`
or trunk `/api/evals` request waits for that first successful publication; once a snapshot exists, a request
reads its atomic generation without joining an unrelated graph/session refresh, then joins current session
presence separately. A newer content revision on ANY issue store the read merges — the resident forge slice
and the local store alike — is a relevant source change, not an unrelated refresh: the published snapshot
carries one revision per store, and the next Issue read asks graph-cache for a publication that has reached
at least the required revision on every one of them before answering. One carrier per store is the
invariant, not an implementation detail: a store missing from that comparison is a store whose writes the
read cannot see, and a single folded number lets a lead on one store pay for a missed write on another. The
producer samples those revisions BEFORE reading the stores, so a snapshot never certifies a write that
landed after its read; sampling can only under-claim, costing one extra rebuild rather than presenting a
stale generation as current. An already-running graph flight that read a store before a write landed may
settle, but cannot satisfy that request; graph-cache retains its full rebuild obligation. Thus a background reconcile cannot leave the
row snapshot permanently behind, without product-level polling. A later page revision/poll observes the replacement generation. Trunk detail projects
one selected history plus its bounded lightweight neighbors from the same generation; a sessions-only graph
splice leaves the snapshot valid because session presence is joined separately at request time.

The snapshot has no enumerable attachment to the board and is never included in graph JSON, SSE full frames,
or delta units. Reading before a successful publish fails loudly. This is a compute-sharing boundary, not a
second datastore: git/spec/eval/issue sources remain authoritative and graph invalidation remains the one
refresh trigger.
