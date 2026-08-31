---
title: graph-delta
status: active
hue: 185
desc: The graph's incremental push — snapshots decompose into keyed units and changes ship as hash-chained patches, provably equivalent to a full refetch and never bigger than one.
code:
  - packages/spec-core/src/graph-delta.ts
related:
  - packages/spec-core/src/graphDelta.ts
  - packages/spec-core/scripts/graph-delta-browser-entry.test.mjs
  - spec-cli/src/graphStream.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-cli/src/graphDelta.test.ts
---

# graph-delta

## raw source

The push channel ([[graph-stream]]) cut *when* the dashboard refetches, but every `graph-changed` still cost
a whole `/api/graph` round trip — measured at ~570KB and a ~0.7s server-side rebuild, of which a typical
session flip actually changes a few KB (the payload is ~82% eval history that only moves when a
reading is filed). Ship the change, not the snapshot: the server that already knows *that* the graph changed
should say *what* changed, and the claim that the dashboard still renders exactly what a full refetch would
must be an argument, not a hope.

## expanded spec

A graph snapshot decomposes into a map of **units** — one per spec node, one per session row, an order list
per array, one `meta` remainder — and two snapshots diff into a `{set, del}` patch between their content
**tags**. A subscriber on `/api/graph/stream?mode=delta` gets one full snapshot on every (re)connect, then a
patch per change, and applies it only when its tag matches the patch's `from`; any mismatch reopens the
stream, which re-anchors on a fresh full. The decomposition, diff, apply, and reconstruction live in one
pure module with no I/O that the dashboard's data layer IMPORTS rather than mirrors, so the correctness
argument closes over the functions actually running on both sides — and a property test sweeps those.

**Equivalence is proved, not assumed.** The co-located `equivalence.md` carries the argument: reconstruction
is a bijection wherever ids are collision-free (the precondition is *checked* per snapshot — a violation
downgrades that send to a full, so a patch is only ever chained between faithfully-decomposable snapshots);
apply∘diff is the identity on unit maps; and by induction over one connection's ordered events, every graph
the client renders **is** some true server snapshot — never a blend of two. The property tests in
`graphDelta.test.ts` are the executable half of that argument.

**Guaranteed win, literally.** The server ships `min(patch, full)`: a patch that fails to beat the snapshot
it patches (a mass change, a churn burst like a forge-cache refresh) is replaced by the snapshot itself, so
a delta subscriber is never worse off than a refetching one — and idle costs nothing. Measured on the
dogfood graph: a session change is ~1KB against the full snapshot, applied with zero `/api/graph`
refetches. The full snapshot itself — the first paint and the resync path — is [[graph-lean]]'s concern
(its evals cut took it ~576KB → ~270KB), and the two compose: leaner fulls, thinner deltas.

The transport that carries these frames — event sources, debounce, subscriber gating, the legacy
`graph-changed` mode — stays [[graph-stream]]'s contract; the client wiring (what it holds, when it
verifies, the fallback belt) stays [[dashboard-shell]]'s. This node owns the algebra: units, tags, diff, apply, and the
equivalence obligations anything touching them must keep true.

The unit decomposition lives in `@spexcode/spec-core`, not in the CLI, because the guarantee that
travels with it is a property of the published surface: two consumers now read these units — the
CLI's SSE path and any process that imports the package — and a second copy of the decomposition
would be a second answer to "which unit kinds exist". The browser-safe `@spexcode/spec-core/graph-delta`
entry exports the zero-I/O unit algebra (`unitize`, `unitKeyKind`, diff, apply, reconstruction, and unit
values); its module graph contains no `node:*` import. The existing `.` entry stays Node-side and retains
tags plus every existing export, so browser consumers have an explicit pure boundary without changing
Node consumers' resolution. The dashboard IMPORTS that entry rather than mirroring it. A mirror was the
earlier arrangement and it did what mirrors do: the two copies drifted, and not cosmetically — the client's
units carried no serialization, ran no bijection check, and shaped `#order` differently. A client that
cannot serialize a unit cannot state what it holds, so the drift was not untidiness; it was the thing
standing between this system and its own strongest guarantee.

**The tag has one definition of WHAT is hashed, and two of HOW.** `tagBytes` is the canonical byte
sequence — every unit as `key \0 serialization \0`, keys sorted so map order cannot matter. Over those
bytes, the Node side takes a `node:crypto` digest and a browser takes a WebCrypto one. Which digest API is
reachable is a platform question and belongs at that boundary; what the bytes ARE is product semantics and
may have exactly one answer, because two answers would let both sides pass their own tests while
disagreeing with each other — and disagreeing in the direction that certifies a board nobody holds. The two
are held byte-equal by test, over random boards, not by inspection.

**A holder can therefore state its own identity, and that changes what a tag is FOR.** Until now a tag was
something the server asserted and a client repeated. A client that computes `tagOf` over the units it
actually holds is making a measurement instead of quoting a receipt, and the difference is the whole
equivalence argument moving from prose into the running system: apply a patch, fingerprint the result,
compare it to the tag the patch was named with. Equal discharges the contract for that frame, on that
client. Unequal is the exact failure this node's proof exists to exclude — a rendered board that is not any
true server snapshot — and it is now observable at the moment it happens rather than inferred later, or
never. `applyDeltaUnits` exists so that a holder carries each unit's serialization through every apply and
can answer that question without re-serializing the whole board.

That question has one answer here and nowhere else, via `unitKeyKind`. Deriving it from `unitize`'s
body is what a reader will try, and it is wrong: the two `keyed()` calls yield four kinds and miss
`meta`, which carries identity and drives the map title and two gates. Exhaustiveness is a property
of the emitted set, so it is checked against that set, not against the code that emits it.

An unrecognised key is reported as unknown, never thrown. Producer and consumer version separately
once this package is published, so a kind added later must degrade to "ignored, and visibly so" in a
consumer that predates it. Tolerating an unknown key is not the same as letting a fallback branch
stand in for handling a known one; only the latter hides a path that is never taken.
