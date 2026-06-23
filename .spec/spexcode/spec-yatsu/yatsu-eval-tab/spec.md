---
title: yatsu-eval-tab
status: active
hue: 140
desc: The dashboard eval tab — a node's evaluation timeline (readings + live freshness) with expand-to-image, plus the spec-cli read API behind it.
code:
  - spec-yatsu/src/evaltab.ts
  - spec-cli/src/board.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/NodeView.jsx
---
# yatsu-eval-tab

## raw source

The eval/loss engine ([[spec-yatsu]], built by [[yatsu-core]]) records readings; this is the surface that
reads them back. Realize the founding **"Evidence — one timeline, two sources"** contract's first source: a
node's **eval tab** lists its evaluations chronologically, each carrying the freshness signal `spex yatsu
scan` reports, with the captured pixels expanding inline. LOCAL readings only for now — the forge
issue-events source is a later sibling; leave a clean seam for it.

## expanded spec

Two halves behind one tab. The **read engine** ([[spec-cli]], in `evaltab.ts`) computes what only a live
read knows. A node's evaluation timeline is every reading from its `yatsu.evals.ndjson` sidecar (scenario,
the read's codeSha, blob, evaluator, ts) joined with a **freshness flag**, derived live from git by the same
[[freshness]] machinery scan uses: a reading is *current* until its governed code, its scenario, or the
evaluator version moved past the sha it was taken at, otherwise *stale* (and which axis moved). Readings
come back newest-first.

This timeline **rides the board**: `buildBoard` folds each node's `evalTimeline` onto its board node as the
`evals` field — the SAME single-source pattern as a node's issues / overlays / lastDiff — so the dashboard
reads it from the one `/api/board` poll every other pane already rides, never a separate per-node fetch. To
keep that whole-board attach cheap the read engine takes the specs + `driftIndex` the board ALREADY computed
(not re-derived per node) plus one shared yatsu walk, and short-circuits every non-yatsu node on that walk,
so only the few yatsu nodes touch their sidecar. The bytes are the one thing NOT folded: an `/api/yatsu/blob`
endpoint serves a reading's pixels by content hash from the shared common-dir cache, fetched **lazily on
expand**, with a clear **miss original file** signal when the record outlived its bytes and an image type
sniffed from the bytes (the cache stores no MIME). (A standalone `/api/specs/:id/evals` route still exposes
the same engine for one id.)

The **eval tab** ([[spec-dashboard]]) is a fourth face on the node popup beside spec/history/issues, driven
by the same `panesFor` registry so the tab bar and keyboard nav agree. Because the readings arrive on the
board prop, the tab is **instant and consistent** — it can never show the previous node's readings on a
switch (the old per-node fetch never reset, so stale readings lingered and the pane loaded out of step with
the rest). It renders the timeline as expandable cards: each names its scenario, a freshness **badge** (✓
current / ⚠ stale — the board's code-drift vocabulary, naming the moved axis on hover), its evaluator,
codeSha, and time. A reading with pixels expands to fetch and show its image by hash; one whose blob was
pruned reads *miss original file*; a pixel-less observation (a human eyeballed it) says so. Two empty states
stay distinct by the field's presence: no scenarios (no yatsu.md → no `evals` at all) and scenarios but no
reading yet (an empty array). There is no loading state — the board already carries the readings.

**The seam / out of scope:** the **forge issue-events** half of the timeline — each tracked issue appearing
twice (open, close) and linking out to its forge-hosted image rather than a local blob — arrives with the
needs-yatsu-eval forge node; the tab joins it at read time then. Backend and computer-use producers, and
the cache cleanup surface, stay with their own nodes.
