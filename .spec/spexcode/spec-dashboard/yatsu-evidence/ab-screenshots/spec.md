---
title: ab-screenshots
status: active
session: sess-b412
hue: 45
desc: A→B proof frames are backend-served metadata links, shown in the recent tab — none until yatsu.
---
# ab-screenshots

## raw source

A version's proof is a before/after pair (A = previous version, B = this version), shown in the **recent**
tab beside the current version's changelog and line-diff. The frames are **metadata links**, never
fabricated client-side — the dashboard shows real captures or honestly shows nothing.

## expanded spec

Each node carries an `evidence` list (frontmatter today, a content-addressed manifest in `.spec` later),
served from the backend like every other node field. The recent tab renders the images from those links at
an evidence slot. The dashboard does not generate placeholder SVGs: when a node has no evidence links — the
case until the yatsu package (pending) records real A→B captures — the slot honestly reads "no proof
evidence yet". Same slot, real frames later.

`NodeView.jsx`'s `RecentPane` is the proof surface. It renders the current version row (number · hash · date
· `+adds`/`−dels` · reason · session, from `/api/specs/:id/history`) and then a `figure`: if
`node.evidence?.length`, it maps the links into an `.ev-pair` of `<img>` shots; otherwise it renders the
`.ev-note` caption "no proof evidence yet — the yatsu package (pending) will record the A→B here". No SVG is
fabricated anywhere — absent evidence reads as none, an admitted gap (no real captures exist yet) rather than
a back-written claim. The `evidence` field rides in on the node from the backend (`data.js` decorates only
x/y), so when yatsu starts recording, real frames appear in the same slot with no dashboard change.

This node governs **no source of its own**. Its rendering surface, `RecentPane`, is part of `NodeView.jsx`,
owned by [[work-pane]] (the node popup); the `evidence` field is backend metadata; and the real A→B captures
arrive only with the yatsu package (pending). So ab-screenshots is the proof *contract* — what evidence is
and where it shows — and stays code-less until yatsu records the first frames, rather than co-claiming the
popup file and reading its churn as drift.
