---
title: graph-lean
status: active
hue: 175
desc: The graph payload is a lean summary — no Issues/Evals row arrays, only explicit per-node counts and identity needed by first paint; every row list is demand-paged elsewhere.
code:
  - spec-cli/src/graph.ts#buildBoard
related:
  - spec-cli/src/graph.test.ts
  - spec-cli/src/reviewSnapshot.ts
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

**Issues and Evals rows are absent, not merely shortened.** A graph node carries one explicit
`reviewSummary`: issue open/closed counts plus open ids for distinct-count/walk identity, and Eval state
counts (`total/pass/fail/stalePass/staleFail/empty`). It carries no `issues`, `openIssues`, `evals`, or
`scenarios` arrays and no row title/body/evidence from which either main review list could be reconstructed.
Tile badges, popup captions, graph stats, the CLI tree, and any other first-paint glance consume only this
projection. The complete local/forge Issue population and current Eval population stay in one server-only
snapshot produced atomically with the graph build; [[paged-review]] filters/counts/slices that snapshot
when a row surface actually opens. Server memory is not serialized by graph JSON, graph SSE, or delta units.

**A session row carries its eval glance, never its eval model.** The row's `evalSummary` is
[[session-eval]]'s cached lean projection: process epoch, monotonic input generation, loading/updating/ready/error
phase, content revision when stable, the seven counts, and an optional last-known stable value while updating or
failed. It is already batch-produced and content-addressed before graph assembly; `buildBoard` and the sessions
splice only attach the cached projection. No graph request, subscriber, or session row calls the full
`buildSessionEvals`, and scenarios/readings/evidence remain behind their demand routes.

**Demand routes own rows all the way down.** `/api/specs/lite` remains the node prose corpus but carries no
scenario declarations; the search palette requests its bounded Issue/Eval planes through [[paged-review]].
The node popup requests `node:`-filtered Issue rows and a paged Eval timeline through the same protocol.
A direct Eval detail loads only the selected scenario's complete A/B history plus at most five lightweight
ordered neighbors through [[paged-review]]'s ONE bounded detail projection; trunk and scoped sources share
that response shape, and scoped detail keeps [[session-eval]]'s generation/revision fence. Issue detail loads
its one addressed thread. No failed demand read falls back to graph rows, because there are deliberately none.
The self-contained session HTML export is the only full-model transport exception.

This node holds the lean-payload contract those cuts extend, beside the freshness-side [[graph-stream]],
the change-side [[graph-delta]], and the compute-side [[graph-cache]] — the lean payload is now also BUILT
once per change and served from cache, so a poll storm no longer re-walks git per request, and the
assembly's fs walks yield the event loop instead of starving the liveness probe. The network budget is
measured as a whole-app ledger: initial graph bytes/forbidden-row counts plus the first opened list response,
never an isolated endpoint claim.
