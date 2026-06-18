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

A version's proof is a before/after pair (A = previous version, B = this version),
shown in the **recent** tab beside the current version's changelog and line-diff.

The frames are **metadata links**, not fabricated client-side: each node carries an
`evidence` list (frontmatter today, a content-addressed manifest in `.spec` later),
served from the backend like every other node field, and the recent tab renders the
images from those links at the evidence slot. The dashboard no longer generates
placeholder SVGs — when a node has no evidence links (the case until the yatsu package
records real captures), the slot honestly reads "no proof evidence yet". Same slot,
real frames later.
