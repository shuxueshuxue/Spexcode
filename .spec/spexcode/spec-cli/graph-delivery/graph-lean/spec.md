---
title: graph-lean
status: active
hue: 175
desc: The graph payload is a lean summary — per-node detail that the tree overview never shows is dropped from every fetch and reconstructed or lazy-loaded where it's actually viewed.
code:
  - spec-cli/src/graph.ts#buildBoard
  - spec-cli/src/graph.ts#latestPerScenario
  - spec-cli/src/graph.ts#slimScenarios
related:
  - spec-cli/src/graph.test.ts
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/corpus.js
---

# graph-lean

## raw source

`/api/graph` shipped every node's full detail — the spec `body`, its parsed `parts`, and its whole `evals`
history — on every single fetch. Measured at ~1.2 MB for ~117 nodes, and ~88% of it is detail the tree
overview never renders (a tile shows a title, a desc, a status, an eval score — not prose). The graph is a
hot, frequently-fetched surface; it should carry the summary the overview needs and nothing else. Detail
belongs where a node is actually opened, not on the wire every time.

## expanded spec

The graph is the *summary*, not the archive: per-node payload that only a distinct surface consumes is
excluded, and that surface reconstructs or lazy-fetches it. The hot path is trimmed without changing a pixel
of the overview, one field at a time so each cut is verifiable.

**`body` and `parts` are both dropped** (~56% of the payload together). `parts` is pure redundancy — it is
`parseParts(body)` ([[three-part-body]]), and neither rides the graph now. Detail reaches its two viewers off
the hot poll: the **detail view** fetches `{body, parts}` from `/api/specs/:id/content` on open; the
**search palette** ([[spec-search]]) fetches the body corpus from `/api/specs/lite` on open and ranks nodes
over full prose — `body` is load-bearing for search, so the corpus keeps ranking whole. Both endpoints are filesystem-only (no git);
`loadSpecs`/`/api/specs` still expose `body`+`parts` verbatim, [[three-part-body]]'s contract untouched.
Where a payload is in flight the detail view shows a **loading spinner** (not an empty pane), so a slow
`/content` read shows as loading, not a bodyless node; a failed fetch resolves to an empty body,
never a spinner that never stops. **No minimum display time** — the body lands the instant
it arrives; a manufactured spinner would spend the user's time on a decoration. The tree overview never rendered these fields, so it does not change at all.

**Freshness is preserved, not traded for the saving.** The detail cache is keyed by `(id, version)` — the
graph carries the live version, so a new version refetches and the prose can never lag the version badge
above it (a non-OK response is shown but never cached). The search corpus revalidates on every palette open,
seeded instantly from the last one; the open overlay is keyed by node id so switching never flashes
one node's prose under another's header.

**`evals` is cut the same way** (it had grown to ~70% of the payload): the graph carries only the **latest
reading per scenario** — what every overview surface (badge, stats, search) reduces to anyway, so
they consume it unchanged — and the eval tab lazy-loads the full timeline from
`/api/specs/:id/evals` when opened, cache keyed by the summary's newest reading so a fresh filing refetches.
A failed timeline fetch falls back to the graph's summary readings — truthful, just shallow. Measured: the
dogfood graph halved again (~576KB → ~270KB).

**The `scenarios` declarations are the third cut.** Each declared scenario rides the graph **slim** —
`{name, tags}`, the fields every overview surface joins state onto — while its prose (`description` /
`expected`) and per-scenario `code` join the **lite corpus**: a measurable node's `/api/specs/lite` row carries
its scenarios whole, so the one corpus fetch ranks scenario prose as it ranks node bodies. The shared fetch (`corpus.js`) revalidates at most once per mount, when prose is first needed — the
palette per open, the always-mounted [[focus-panel]] on its first scenario-bearing focus, whose clamped
`expected` preview and tracked-files line join from it (rows render name/state/tags instantly;
prose fills in). The eval tab's blind-spot
rows take `expected`+`code` from the `/evals` fetch it already makes, falling back to the slim graph set — shallow, never wrong. Measured: the fold 73KB → 9KB, the dogfood frame ~304KB → ~240KB (~-21%).

This node holds the lean-payload contract those cuts extend, beside the freshness-side [[graph-stream]],
the change-side [[graph-delta]], and the compute-side [[graph-cache]] — the lean payload is now also BUILT
once per change and served from cache, so a poll storm no longer re-walks git per request, and the
assembly's fs walks yield the event loop instead of starving the liveness probe. Still duplicated: each
summary *reading's* `expected` inside `evals` — the annotator lane's follow-up, since `latestPerScenario`
is a filter, never a projection.
