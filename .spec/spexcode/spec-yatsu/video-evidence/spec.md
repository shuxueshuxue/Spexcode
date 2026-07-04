---
title: video-evidence
status: active
hue: 140
desc: A recorded video is a third yatsu blobKind — evidence with a time axis. It folds onto the existing evidence engine; only the enum and one render arm grow.
related:
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/proof.ts
  - spec-dashboard/src/Evidence.jsx
---
# video-evidence

A yatsu reading's evidence is a **list** of content-addressed entries, each typed by its `kind` ([[yatsu-core]]) —
`image` | `transcript` | `video`. A video is a screenshot with a time axis: the **same** primitive, one more
kind of entry. For a scenario whose loss is a *temporal user loop* (a UI surface), a recording of the loop is
the truest evidence — the author's choice per scenario, routed by its tag, not a forced default — and it can
ride in the same reading as N stills of the same run.

The whole point is that almost nothing is new. `spex yatsu eval --video <clip>` stores the bytes in the same
shared cache and pushes one `video` entry onto the reading's evidence list (`spex blob put` is the same
transport WITHOUT a reading, [[blob-put]]); the MIME is sniffed from content
(WebM / MP4) so `/api/yatsu/blob` streams a playable type — and answers **byte ranges**, without which a browser
clamps every seek to 0; every dashboard home renders the `<video>` inline through the ONE shared evidence
renderer ([[event-detail]]'s `Evidence.jsx` — the eval tab [[yatsu-eval-tab]], the session proof
([[review-proof]]), and an issue/eval thread's blob links alike), lazy on
expand, with the same *miss original file* when the blob is pruned; `spex yatsu show` labels it. A clip is
heavier bytes, so [[yatsu-core]]'s `clean` (which walks every evidence entry) is the intended prune.

An optional refinement — anchoring named steps to moments in the clip so an annotation can land on a step —
is [[step-timeline]], a separate format built only when a real annotation workflow needs it. yatsu still
runs nothing: it records a clip something else recorded, and the measuring hand stays a metadata tag.

A human who disagrees with **this** node's verdict simply files their own `manual@1` reading — the existing
supersede-by-a-newer-reading path, not a new lifecycle. A finding that is *not* this node's clean fail — a
cross-cutting problem, or one belonging to **another** node — is instead a **concern raised on the
responsible node** (a local or forge issue through the unified Issue port — [[proposals]]'s one Issue
type, whose typed `evidence[]` carries the hash), pointing at the
clip by its evidence hash — and the thread PLAYS that clip inline through the same shared renderer, so the
concern's evidence is watchable where the concern is read; not a hedged verdict here. So video keeps yatsu's
verdict binary and routes the "needs another look" elsewhere it belongs.
