---
title: yatsu-eval-tab
status: active
hue: 140
desc: The dashboard eval tab — a node's measurement timeline (verdict + expected + live freshness) with evidence (image or transcript) on expand, plus the spec-cli read API behind it.
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
one `/api/board` poll, never a per-node fetch. To keep that attach cheap the engine reuses the specs +
`driftIndex` the board already computed plus one shared yatsu walk, short-circuiting every non-yatsu node. The
bytes are the one thing NOT folded: `/api/yatsu/blob` serves a reading's evidence by content hash from the
shared cache, fetched **lazily on expand**, with a **miss original file** signal when the bytes are gone and a
MIME sniffed from the content — an image type for a screenshot, `text/plain` for a transcript. (A standalone
`/api/specs/:id/evals` route exposes the same engine for one id.)

The **eval tab** ([[spec-dashboard]]) is a fourth face on the node popup beside spec/history/issues, on the
same `panesFor` registry. Because the readings arrive on the board prop, the tab is **instant and consistent**
— never the previous node's readings on a switch. It is a **thin consumer of the chronological-timeline
scaffold the history tab uses** (the scroll/reveal/toggle and per-row header-over-evidence shape live once —
see [[work-pane]]): newest expanded, older reveal on the down gesture, a header click toggles any. Each row's
header names its scenario, the **verdict badge** (✓ pass / ✗ fail / ≈ note — the loss the agent measured, the
how-far-off text on hover; *legacy* for a pre-verdict reading), and the freshness **badge** (✓ current /
⚠ stale — the board's code-drift vocabulary, the moved axis on hover), then its evaluator, codeSha, and time.
Its evidence is the scenario's **expected** over the captured proof — a screenshot inline or a transcript as
text (fetched by hash **lazily on expand**), or — no capture — *miss original file* when the blob was pruned,
else an evidence-less observation. Two empty states stay distinct by presence: no scenarios (no `evals` at
all) and scenarios but no reading yet (an empty array).

**The seam / out of scope:** the **forge issue-events** half of the timeline — each tracked issue appearing
twice (open, close) and linking out to its forge-hosted image rather than a local blob — arrives with the
needs-yatsu-eval forge node; the tab joins it at read time then. Backend and computer-use evaluators, and
the cache cleanup surface, stay with their own nodes.
