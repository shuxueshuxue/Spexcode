---
title: eval-tab
status: active
hue: 140
desc: The dashboard eval tab — a node's measurement timeline (verdict + expected + live freshness) with an evidence GALLERY (N images + a video/transcript) on expand, plus the spec-cli read API behind it.
code:
  - spec-eval/src/evaltab.ts#evalTimeline
  - spec-eval/src/evaltab.ts#readBlobByHash
related:
  - spec-cli/src/graph.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/NodeView.jsx
---
# eval-tab

## raw source

The eval/loss engine ([[spec-eval]], built by [[eval-core]]) records readings; this is the surface that
reads them back. Realize the founding **"Evidence — one timeline, two sources"** contract's first source: a
node's **eval tab** lists its measurements chronologically, each carrying its verdict, the scenario's
expected, and the freshness signal `spex eval lint` reports, with the captured evidence — a **gallery** of the
reading's whole evidence list (N images plus a **video** clip that plays inline, and/or a transcript) —
expanding inline. LOCAL readings only for now — the forge issue-events source is a later
sibling; leave a clean seam for it.

## expanded spec

Two halves behind one tab. The **read engine** ([[spec-cli]], in `evaltab.ts`) computes what only a live
read knows. A node's measurement timeline is every reading from its `evals.ndjson` sidecar (scenario,
the read's codeSha, an evidence LIST — each `{hash, kind}` resolved to its live blob state — **verdict**, ts) joined with the scenario's **expected**
(from the live eval.md — what zero loss looks like) and a **freshness flag**, derived live from git by the
same freshness machinery the lint uses ([[eval-core]]'s scenario-freshness derivation): a reading is *current* until its governed code or its scenario
moved past the sha it was taken at, otherwise *stale* (and which axis moved); a code-stale
reading also carries the code axis's per-file drift detail (`codeDrift` — which governed files moved, +how many
commits) so the [[event-detail]] stale readout can name it, never re-deriving git in the browser;
newest-first.

The board carries this timeline as a **summary** ([[graph-lean]]): `buildBoard` folds the latest reading per
scenario onto the node's `evals` and the declared set slim (`{name, tags}`), so every overview surface — the
[[eval-score-badge]] tile count, the [[focus-panel]] — counts the WHOLE set off the one `/api/graph` poll
(a never-measured scenario still counts as loss). The FULL timeline — each scenario's
`expected` and per-scenario `code` included — is served by `/api/specs/:id/evals`, lazy-loaded when the tab
opens. The board attach stays cheap by reusing the board's specs + `driftIndex` and one shared eval-file walk.
Bytes are never folded anywhere: `/api/evidence` serves each evidence entry by its content hash from the
shared cache, fetched **lazily on expand**, with a per-entry **miss original file** signal when the bytes are gone, MIME
sniffed from the content.

The **eval tab** ([[spec-dashboard]]) is a fourth face on the node popup beside spec/history/issues, on the
same `panesFor` registry. It fetches its timeline (readings + declared detail) per node on open, cache keyed
by the summary's newest reading so a fresh filing refetches; a failed fetch degrades to the board's
summary. It is a **thin consumer of the chronological-timeline
scaffold the history tab uses** (see [[work-pane]]): newest expanded, older reveal on the down gesture, an
expand-all door for find-in-page, and — on a long timeline — the shared sticky **scenario-name filter**
(blind-spot rows and dangling tracks filter with the readings, so a filtered view stays one coherent set). Each
row's header names its scenario, the **verdict badge** (✓ pass / ✗ fail, optional **note**
beside; *legacy* for a pre-verdict or note-only reading), and the per-reading **score circle**
([[eval-score-badge]]), then its codeSha and time.
Its evidence is the scenario's **expected** over the captured proof — a **gallery** mapping the reading's
evidence list (N screenshots, a video, a transcript), each entry showing *miss original file* when its blob
was pruned.

The tab surfaces the **whole declared set** in **one list**, not only the readings. A **declared scenario
with no reading** leads that list as a **blind-spot row** — the empty score ring over its name, its
`expected`, and the files it tracks. The ring is the *only* distinction (no fenced-off band, no second
scrollbar): an unmeasured scenario is outstanding loss and belongs where the attention is, so a node's
intent is legible **inside the popup** before a reading lands (the only place it shows once the popup
covers the [[focus-panel]]). No reading at all → those rows under a hint; some measured, some not → those
rows lead the timeline. The one presence-distinct empty state survives: a node with **no scenarios**
(no eval.md → no `evals` field) shows nothing.

**The seam / out of scope:** the **forge issue-events** half of the timeline — each tracked issue appearing
twice (open, close) and linking out to its forge-hosted image rather than a local blob — arrives with the
[[needs-eval]] forge node; the tab joins it at read time then. Backend and computer-use measuring hands, and
the cache cleanup surface, stay with their own nodes.
