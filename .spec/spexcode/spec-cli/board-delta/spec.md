---
title: board-delta
status: active
hue: 185
desc: The board's incremental push — snapshots decompose into keyed units and changes ship as hash-chained patches, provably equivalent to a full refetch and never bigger than one.
code:
  - spec-cli/src/boardDelta.ts
  - spec-cli/src/boardDelta.test.ts
related:
  - spec-cli/src/boardStream.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
---

# board-delta

## raw source

The push channel ([[board-stream]]) cut *when* the dashboard refetches, but every `board-changed` still cost
a whole `/api/board` round trip — measured at ~570KB and a ~0.7s server-side rebuild, of which a typical
session flip actually changes a few KB (the payload is ~82% yatsu eval history that only moves when a
reading is filed). Ship the change, not the snapshot: the server that already knows *that* the board changed
should say *what* changed, and the claim that the dashboard still renders exactly what a full refetch would
must be an argument, not a hope.

## expanded spec

A board snapshot decomposes into a map of **units** — one per spec node, one per session row, an order list
per array, one `meta` remainder — and two snapshots diff into a `{set, del}` patch between their content
**tags**. A subscriber on `/api/board/stream?mode=delta` gets one full snapshot on every (re)connect, then a
patch per change, and applies it only when its tag matches the patch's `from`; any mismatch reopens the
stream, which re-anchors on a fresh full. The decomposition, diff, apply, and reconstruction live in one
pure module with no I/O, mirrored by the dashboard's data layer, so the correctness argument closes over
functions a property test can sweep.

**Equivalence is proved, not assumed.** The co-located `equivalence.md` carries the argument: reconstruction
is a bijection wherever ids are collision-free (the precondition is *checked* per snapshot — a violation
downgrades that send to a full, so a patch is only ever chained between faithfully-decomposable snapshots);
apply∘diff is the identity on unit maps; and by induction over one connection's ordered events, every board
the client renders **is** some true server snapshot — never a blend of two. The property tests in
`boardDelta.test.ts` are the executable half of that argument.

**Guaranteed win, literally.** The server ships `min(patch, full)`: a patch that fails to beat the snapshot
it patches (a mass change, a churn burst like a forge-cache refresh) is replaced by the snapshot itself, so
a delta subscriber is never worse off than a refetching one — and idle costs nothing. Measured on the
dogfood board: a session change is ~8.6KB against the ~570KB snapshot, applied with zero `/api/board`
refetches. What this deliberately does *not* shrink is the full snapshot itself — the first paint and the
resync path still carry it; slimming that (the eval history) is [[board-lean]]'s next cut, and the two
compose: leaner fulls, thinner deltas.

The transport that carries these frames — event sources, debounce, subscriber gating, the legacy
`board-changed` mode — stays [[board-stream]]'s contract; the client wiring (apply mirror, fallback
stand-down) stays [[dashboard-shell]]'s. This node owns the algebra: units, tags, diff, apply, and the
equivalence obligations anything touching them must keep true.
