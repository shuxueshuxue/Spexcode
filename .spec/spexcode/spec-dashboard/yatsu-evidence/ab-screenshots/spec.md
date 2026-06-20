---
title: ab-screenshots
status: active
session: sess-b412
hue: 45
desc: A→B proof frames are backend-served metadata links, shown inside a version's item in the history tab; with none, the item shows just that version's spec line diff — nothing is said about the missing screenshot.
---
# ab-screenshots

## raw source

A version's proof is a before/after pair (A = previous version, B = this version), shown **inside that
version's item** in the **history** tab. The frames are **metadata links**, never fabricated client-side.
When a version has none, its item doesn't sit empty and says nothing about a missing screenshot — it simply
shows that version's own spec line diff, the real change it made, which the dashboard already knows from git.

## expanded spec

Each node carries an `evidence` list (frontmatter today, a content-addressed manifest in `.spec` later),
served from the backend like every other node field. A version's proof slot prefers those real A→B frames;
the dashboard never fabricates a stand-in, and a version with no frames shows **only its spec line diff** —
the unified patch it introduced to spec.md — with no "pending" note or hint about the absent screenshot.
Until the yatsu package (pending) records captures — and until it records them *per version* — the frames
exist for the latest version alone; every version still shows its line diff, and real frames take the slot
above the diff the moment yatsu writes them.

Each item's diff is fetched **lazily**, the first time that item expands, so collapsed history never spins
on a fetch. The **latest** version is the exception: its diff is **precomputed and shipped with the board**
(`GET /api/board`, and `/api/specs`), so the expanded-by-default latest item renders with no round-trip.
Diffs are **cached by the version's commit sha** (a commit's patch is immutable), so an older item that
reuses a sha already shipped as some node's latest is a map hit; `/api/specs/:id/diff/:hash` serves any
version's diff on demand over that same cache, and only a sha never seen pays one `git show`.

The backend scopes each diff to the node's spec.md and resolves its path **at that version's commit**, so a
node reparented since (a pure rename, not itself a version) still shows the right patch. The frontend
renders only the hunk body — adds/dels coloured, file-header metadata dropped — and shows an honest
"no recorded change yet" line for a version with no recorded spec.md change. The proof slot is the same
figure whether screenshots, diff, or both fill it.

This node governs **no source of its own**. Its rendering surface (the per-version proof figure) is part of
`NodeView.jsx`, owned by [[work-pane]] (the node popup); the per-version diff is served by
`/api/specs/:id/diff/:hash` — the route in [[spec-cli]], the git-derived patch in [[source-of-truth]]; the
`evidence` field is backend metadata; and the real A→B captures arrive only with the yatsu package
(pending). So ab-screenshots is the proof *contract* — what fills the slot and where it shows — and stays
code-less until yatsu records the first frames, rather than co-claiming the popup file and reading its churn
as phantom drift.
