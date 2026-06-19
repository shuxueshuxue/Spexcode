---
title: ab-screenshots
status: active
session: sess-b412
hue: 45
desc: A→B proof frames are backend-served metadata links, shown in the recent tab — none until yatsu.
code:
  - spec-dashboard/src/NodeView.jsx
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

## current state

### description

`NodeView.jsx`'s `RecentPane` is the proof surface. It renders the current version row (number · hash ·
date · `+adds`/`−dels` · reason · session, from `/api/specs/:id/history`) and then a `figure`: if
`node.evidence?.length`, it maps the links into an `.ev-pair` of `<img>` shots; otherwise it renders the
`.ev-note` caption "no proof evidence yet — the yatsu package (pending) will record the A→B here". No SVG
is fabricated anywhere — absent evidence reads as none. The `evidence` field rides in on the node from the
backend (`data.js` decorates only x/y), so when yatsu starts recording, real frames appear in the same slot
with no dashboard change.

### verdict — not drifted

`NodeView.jsx` is the only governed file and, after this rewrite, sits at this node's latest version with
no commits ahead (`spex lint` reports no `drift` warning for `ab-screenshots`; it had drifted by 2 commits,
now reconciled). The expanded spec states the proof contract as intended behavior; the description is the
honest read of how `RecentPane` meets it today — including that no real captures exist yet (the slot reads
"none"), an admitted gap rather than a back-written claim. The raw source (backend-served metadata links,
nothing fabricated) still holds.
