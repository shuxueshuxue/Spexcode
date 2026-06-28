---
title: yatsu-eval-tab
status: active
hue: 140
desc: The dashboard eval tab — a node's measurement timeline (verdict + expected + live freshness) with evidence (image or transcript) on expand, plus the spec-cli read API behind it.
code:
  - spec-yatsu/src/evaltab.ts
related:
  - spec-cli/src/board.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/NodeView.jsx
---
# yatsu-eval-tab

## raw source

The eval/loss engine ([[spec-yatsu]], built by [[yatsu-core]]) records readings; this is the surface that
reads them back. Realize the founding **"Evidence — one timeline, two sources"** contract's first source: a
node's **eval tab** lists its measurements chronologically, each carrying its verdict, the scenario's
expected, and the freshness signal `spex yatsu scan` reports, with the captured evidence (an image or a
transcript) expanding inline. LOCAL readings only for now — the forge issue-events source is a later
sibling; leave a clean seam for it.

## expanded spec

Two halves behind one tab. The **read engine** ([[spec-cli]], in `evaltab.ts`) computes what only a live
read knows. A node's measurement timeline is every reading from its `yatsu.evals.ndjson` sidecar (scenario,
the read's codeSha, blob + blobKind, evaluator, **verdict**, ts) joined with the scenario's **expected**
(from the live yatsu.md — what zero loss looks like) and a **freshness flag**, derived live from git by the
same [[freshness]] machinery scan uses: a reading is *current* until its governed code, its scenario, or the
evaluator version moved past the sha it was taken at, otherwise *stale* (and which axis moved). Readings
come back newest-first.

This timeline **rides the board**: `buildBoard` folds each node's `evalTimeline` onto it as the `evals`
field — the SAME single source as a node's issues / overlays / lastDiff — so the dashboard reads it from the
one `/api/board` poll, never a per-node fetch. Alongside the readings it folds the node's **declared
scenarios** (name, `expected`, optional `code`), so a consumer sees the WHOLE set — a never-measured
scenario has no reading but is still a countable unit of loss ([[yatsu-score-badge]]'s tile count, the
[[focus-panel]]). To keep the attach cheap it reuses the board's specs + `driftIndex` and one shared yatsu
walk. The bytes are the one thing NOT
folded: `/api/yatsu/blob` serves a reading's evidence by content hash from the shared cache, fetched **lazily
on expand**, with a **miss original file** signal when the bytes are gone and a MIME sniffed from the content.
(A standalone `/api/specs/:id/evals` route exposes the same engine for one id.)

The **eval tab** ([[spec-dashboard]]) is a fourth face on the node popup beside spec/history/issues, on the
same `panesFor` registry. Because the readings arrive on the board prop, the tab is **instant and consistent**
— never the previous node's readings on a switch. It is a **thin consumer of the chronological-timeline
scaffold the history tab uses** (see [[work-pane]]): newest expanded, older reveal on the down gesture. Each
row's header names its scenario, the **verdict badge** (✓ pass / ✗ fail / ≈ note; *legacy* for a pre-verdict
reading), and the per-reading **score circle** ([[yatsu-score-badge]]), then its evaluator, codeSha, and time.
Its evidence is the scenario's **expected** over the captured proof (screenshot or transcript), or *miss
original file* when the blob was pruned.

The tab surfaces the **whole declared set** in **one list**, not only the readings. A **declared scenario
with no reading** leads that list as a **blind-spot row** — the empty score ring over its name, its
`expected`, and the files it tracks. The ring is the *only* distinction (no fenced-off band, no second
scrollbar): an unmeasured scenario is the node's outstanding loss and belongs where the attention is, so a
node's intent is legible **inside the popup** before a reading lands (the only place it shows once the popup
covers the [[focus-panel]]). No reading at all → those rows under a hint; some measured, some not → those
rows lead the timeline. The one presence-distinct empty state survives: a node with **no scenarios**
(no yatsu.md → no `evals` field) shows nothing.

**The seam / out of scope:** the **forge issue-events** half of the timeline — each tracked issue appearing
twice (open, close) and linking out to its forge-hosted image rather than a local blob — arrives with the
needs-yatsu-eval forge node; the tab joins it at read time then. Backend and computer-use evaluators, and
the cache cleanup surface, stay with their own nodes.
