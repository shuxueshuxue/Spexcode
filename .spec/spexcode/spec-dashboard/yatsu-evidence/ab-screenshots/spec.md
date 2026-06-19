---
title: ab-screenshots
status: active
session: sess-b412
hue: 45
desc: A→B proof frames are backend-served metadata links, shown in the recent tab; with none yet, the slot falls back to the spec's own latest line diff.
code:
  - spec-dashboard/src/NodeView.jsx
---
# ab-screenshots

## raw source

A version's proof is a before/after pair (A = previous version, B = this version), shown in the **recent**
tab beside the current version's changelog and line-diff. The frames are **metadata links**, never
fabricated client-side. Until yatsu records any, the slot doesn't sit empty: it falls back to the spec's
own latest line diff — the real change that version made, which the dashboard already knows from git.

## expanded spec

Each node carries an `evidence` list (frontmatter today, a content-addressed manifest in `.spec` later),
served from the backend like every other node field. The recent tab's evidence slot prefers those real
A→B frames; the dashboard never fabricates a stand-in. When a node has no evidence links — the case until
the yatsu package (pending) records captures — the slot shows the spec's **latest line diff** instead: the
unified patch its newest version introduced to spec.md, served by `/api/specs/:id/diff`. That keeps the
proof surface honest and useful (the actual lines that changed) rather than a bare "pending" note, and the
real frames take the same slot the moment yatsu writes them.

The backend scopes the diff to the node's spec.md and resolves its path **at that version's commit**, so a
node reparented since (a pure rename, not itself a version) still shows the right patch. The frontend
renders only the hunk body — adds/dels coloured, file-header metadata dropped — and falls back to an honest
"no recorded change yet" line for a node with no committed version. The proof surface stays the same
`RecentPane` figure either way; what fills it (screenshots vs. diff) is the only thing that differs.
