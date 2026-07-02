---
title: annotator
status: active
hue: 200
desc: The issues page's eval DETAIL pane — a selected reading full-height (a video plays with a clickable step ruler; the human scrubs, circles, comments; images/transcripts render whole) — and the output files through existing seams only, never a new one.
code:
  - spec-dashboard/src/Annotator.jsx
related:
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/filing.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/NodeView.jsx
---
# annotator

## raw source

The human's measuring hand on a recorded user loop: watch the clip, point at the moment something is
wrong, say what — and have that judgment land where it belongs. The annotator is an authoring surface over
an **already-captured** clip; yatsu still runs nothing, and no new ledger structure exists for its sake.

## expanded spec

The annotator IS the issues page's **detail pane for a selected eval** ([[issues-view]]'s master-detail —
no modal, no box-in-a-box: the reading gets the pane's full height, and switching selection resets the
working state to the new reading). Every evidence kind renders here — an image full-width, a transcript as
text, a missing blob as the honest sentinel, a blob-less (`note`) reading its verdict note as the text
body (never an empty media box) — and a **video** reading plays its clip. When the reading
carries a [[step-timeline]]
sidecar, a **step ruler** renders under the scrubber — click a step to seek to its `tMs`; an annotation at
moment T names its step by the last-boundary-≤T lookup, and a step's optional owning-node routes the
finding to the node it actually belongs to. Without a sidecar the annotator is a plain player with
annotations — degraded gracefully, never blocked.

Interactions stay lean: scrub, drag-circle a region on the paused frame, write a comment at that moment.
Context (the scenario's `expected`, the node) renders live from the board — no title cards, no run
management, no metadata files.

**Output routes through existing seams only.** A finding belonging to *another* node → an issue on the
responsible node ([[proposals]]'s unified Issue type via the port's write route, its typed `evidence[]`
carrying the clip and step-map hashes — [[video-evidence]]'s routing; the marks are the prose body).
Disagreement with *this* node's verdict → the human files their own `manual@1` reading through the eval
seam's write half (filing.ts, [[yatsu-core]]), the annotation report as its transcript evidence. The
annotator invents no verdict states, no timeline tables, no locks.

**Discussion rides the Issue mechanism — an eval's comment thread IS a local Issue.** Under the media the
pane renders the eval's comment thread: a local issue deterministically bound to this (node, scenario) by
its concern key — `eval: <node> · <scenario>` — matched by concern TEXT against the page's resident issues
list (ids de-collide, concerns don't). No thread exists until someone speaks: the first comment lazily
creates it through the SAME propose the CLI uses (`nodes: [node]`, the comment as the body), every later
comment replies to it through the SAME reply — one thread per pair, forever, whatever its status. The
reply list and composer are the SAME shared thread UI the issue detail uses ([[issues-view]]'s
`Thread.jsx` — one thread UI, three homes: local issue, forge issue, eval), so an `@session`/`@new` typed
in a comment dispatches ([[mentions]]) — commenting "@new look at this regression" under an eval IS
assigning it. No new object, no new store, no hiding: the thread lists in the issues group like any local
issue, and its node chip focuses the graph. Where no resident issues list is wired in (the session eval
tab), the section does not render — a blind post would mint duplicate threads.
