---
title: board-lean
status: active
hue: 175
desc: The board payload is a lean summary — per-node detail that the graph overview never shows is dropped from every fetch and reconstructed or lazy-loaded where it's actually viewed.
code:
  - spec-cli/src/board.ts
  - spec-dashboard/src/NodeView.jsx
---

# board-lean

## raw source

`/api/board` shipped every node's full detail — the spec `body`, its parsed `parts`, and its whole `evals`
history — on every single fetch. Measured at ~1.2 MB for ~117 nodes, and ~88% of it is detail the graph
overview never renders (a tile shows a title, a desc, a status, a yatsu score — not prose). The board is a
hot, frequently-fetched surface; it should carry the summary the overview needs and nothing else. Detail
belongs where a node is actually opened, not on the wire every time.

## expanded spec

The board is the *summary*, not the archive: it excludes per-node payload that only the opened-node detail
view or a distinct surface consumes, and that surface reconstructs it locally or fetches it on demand. This
trims the hot path without changing a single pixel of the overview, and is applied one field at a time so
each cut is verifiable in isolation.

First cut — **`parts` is dropped** (~21% of the payload). `parts` is pure redundancy on the wire: it is
`parseParts(body)` ([[three-part-body]]), a deterministic split of `body` at the `## raw source` / `## expanded
spec` headings, and `body` is still on the board. So `buildBoard` omits it and `NodeView` reconstructs it
client-side with a parser that mirrors the backend's exactly (same grammar, fence-aware) — the two-part
detail view is byte-identical, no round-trip, no new endpoint. `loadSpecs`/`/api/specs` still expose `parts`
verbatim, so [[three-part-body]]'s own contract is untouched; only the board's copy goes.

Not every heavy field can be dropped this cheaply, which is why the field-at-a-time discipline matters. `body`
itself (~35%) is **load-bearing for [[spec-search]]** — the palette ranks nodes over their full prose — so it
cannot be naively stripped; removing it from the board needs a lazy body-corpus the search palette fetches
once on open and the detail view fetches per node. `evals` (~32%) is only distilled by the overview to a
per-scenario latest-state, so the board can carry that compact summary and lazy-load the full readings for the
eval tab. Those are the next cuts, each its own step; this node holds the contract they extend, alongside the
freshness-side companion [[board-stream]].
