---
title: annotator
status: pending
hue: 200
desc: Opening a video eval plays the clip with a clickable step ruler; the human scrubs, circles, comments — and the output files through existing seams only, never a new one.
related:
  - spec-yatsu/src/evaltab.ts
  - spec-dashboard/src/NodeView.jsx
---
# annotator

## raw source

The human's measuring hand on a recorded user loop: watch the clip, point at the moment something is
wrong, say what — and have that judgment land where it belongs. The annotator is an authoring surface over
an **already-captured** clip; yatsu still runs nothing, and no new ledger structure exists for its sake.

## expanded spec

Opening a video reading ([[evals-feed]]) plays its clip. When the reading carries a [[step-timeline]]
sidecar, a **step ruler** renders under the scrubber — click a step to seek to its `tMs`; an annotation at
moment T names its step by the last-boundary-≤T lookup, and a step's optional owning-node routes the
finding to the node it actually belongs to. Without a sidecar the annotator is a plain player with
annotations — degraded gracefully, never blocked.

Interactions stay lean: scrub, drag-circle a region on the paused frame, write a comment at that moment.
Context (the scenario's `expected`, the node) renders live from the board — no title cards, no run
management, no metadata files.

**Output routes through existing seams only.** A finding belonging to *another* node → an issue on the
responsible node ([[proposals]]'s unified Issue type, its typed `evidence[]` carrying the clip's hash —
[[video-evidence]]'s routing).
Disagreement with *this* node's verdict → the human files their own `manual@1` reading, superseding by
chronology. Annotated frames or an exported report are ordinary evidence blobs on that reading. The
annotator invents no verdict states, no timeline tables, no locks.
