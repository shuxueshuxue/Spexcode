---
title: graph-delta
status: active
hue: 185
desc: The graph's incremental push — snapshots decompose into keyed units and changes ship as hash-chained patches, provably equivalent to a full refetch and never bigger than one.
code:
  - spec-cli/src/boardDelta.ts
related:
  - spec-cli/src/boardStream.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-cli/src/boardDelta.test.ts
---

# graph-delta

## raw source

The push channel ([[graph-stream]]) cut *when* the dashboard refetches, but every `board-changed` still cost
a whole `/api/graph` round trip — measured at ~570KB and a ~0.7s server-side rebuild, of which a typical
session flip actually changes a few KB (the payload is ~82% yatsu eval history that only moves when a
reading is filed). Ship the change, not the snapshot: the server that already knows *that* the graph changed
should say *what* changed, and the claim that the dashboard still renders exactly what a full refetch would
must be an argument, not a hope.

## expanded spec

A graph snapshot decomposes into a map of **units** — one per spec node, one per session row, an order list
per array, one `meta` remainder — and two snapshots diff into a `{set, del}` patch between their content
**tags**. A subscriber on `/api/graph/stream?mode=delta` gets one full snapshot on every (re)connect, then a
patch per change, and applies it only when its tag matches the patch's `from`; any mismatch reopens the
stream, which re-anchors on a fresh full. The decomposition, diff, apply, and reconstruction live in one
pure module with no I/O, mirrored by the dashboard's data layer, so the correctness argument closes over
functions a property test can sweep.

**Equivalence is proved, not assumed.** The co-located `equivalence.md` carries the argument: reconstruction
is a bijection wherever ids are collision-free (the precondition is *checked* per snapshot — a violation
downgrades that send to a full, so a patch is only ever chained between faithfully-decomposable snapshots);
apply∘diff is the identity on unit maps; and by induction over one connection's ordered events, every graph
the client renders **is** some true server snapshot — never a blend of two. The property tests in
`boardDelta.test.ts` are the executable half of that argument.

**Guaranteed win, literally.** The server ships `min(patch, full)`: a patch that fails to beat the snapshot
it patches (a mass change, a churn burst like a forge-cache refresh) is replaced by the snapshot itself, so
a delta subscriber is never worse off than a refetching one — and idle costs nothing. Measured on the
dogfood graph: a session change is ~1KB against the full snapshot, applied with zero `/api/graph`
refetches. The full snapshot itself — the first paint and the resync path — is [[graph-lean]]'s concern
(its evals cut took it ~576KB → ~270KB), and the two compose: leaner fulls, thinner deltas.

The transport that carries these frames — event sources, debounce, subscriber gating, the legacy
`board-changed` mode — stays [[graph-stream]]'s contract; the client wiring (apply mirror, fallback
stand-down) stays [[dashboard-shell]]'s. This node owns the algebra: units, tags, diff, apply, and the
equivalence obligations anything touching them must keep true.
