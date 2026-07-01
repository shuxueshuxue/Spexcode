---
title: board-lean
status: active
hue: 175
desc: The board payload is a lean summary — per-node detail that the graph overview never shows is dropped from every fetch and reconstructed or lazy-loaded where it's actually viewed.
code:
  - spec-cli/src/board.ts
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SpecSearch.jsx
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

**`body` and `parts` are both dropped** (~56% of the payload together). `parts` is pure redundancy — it is
`parseParts(body)` ([[three-part-body]]), and neither rides the board now. Detail reaches its two viewers off
the hot poll: the **detail view** fetches one node's `{body, parts}` from `/api/specs/:id/content` when it
opens; the **search palette** ([[spec-search]]) fetches the body corpus from `/api/specs/lite` when it opens and
ranks nodes over their full prose. `body` is genuinely load-bearing for search, so it could not be naively
stripped — the corpus is what keeps ranking whole. Both endpoints are filesystem-only reads (no git), and
`loadSpecs`/`/api/specs` still expose `body`+`parts` verbatim, so [[three-part-body]]'s contract is untouched.
Where a payload is in flight the detail view shows a **loading spinner** (not an empty pane), so a slow or
remote `/content` read reads as loading rather than as a bodyless node; a failed fetch resolves to an empty
body, never a spinner that never stops. Because `/content` is a ~20ms filesystem read, the spinner is held a
**minimum ~300ms beat** on a node's FIRST open so it reads as a smooth load instead of flickering too fast to
see; a cached re-open serves synchronously and shows no spinner at all. The graph overview never rendered
these fields, so it does not change at all.

**Freshness is preserved, not traded for the saving.** On the old board `body` refreshed with every poll, so
the lazy reads must not go stale. The detail cache is keyed by `(id, version)` — the board carries the live
version, so a new version misses the cache and refetches, and the detail prose can never lag the version badge
above it (a non-OK response is shown but never cached, so a transient reload can't poison a node). The search
corpus revalidates on every palette open, seeded instantly from the last one. And because the detail view now
fetches per node, the open overlay is keyed on the node id so switching nodes never flashes one node's prose
under another's header.

The remaining cut is **`evals`** (~32%): the overview distills it to a per-scenario latest-state, so the board
can carry that compact summary and lazy-load the full readings for the eval tab — its own next step. This node
holds the lean-payload contract those cuts extend, alongside the freshness-side companion [[board-stream]];
together they take the board from ~1.2 MB toward a small, mostly-static summary.
