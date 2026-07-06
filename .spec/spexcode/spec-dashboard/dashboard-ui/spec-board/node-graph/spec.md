---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A drill-down tidy-tree — only the focused node's spine expands, so the root layer stays a short readable column. Each node shows its identity and its people.
code:
  - spec-dashboard/src/SpecNode.jsx
  - spec-dashboard/src/specMeta.js
  - spec-dashboard/src/avatar.jsx
  - spec-dashboard/src/color.js
  - spec-dashboard/src/Legend.jsx
  - spec-dashboard/src/Modal.jsx
related:
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
---
# node-graph

A **drill-down** tidy-tree of the spec-node neighbourhood: navigate by **relationship**, not by hunting a full forest where siblings blur into cousins. Only the focused node's **ancestor spine is expanded** — every other subtree collapses to a single tile — so the **root layer is always a short, readable column** no matter how deep or bushy the real tree is. (A point-per-node tidy tree otherwise spends vertical space equal to its *leaf count*, sprawling the high-level nodes — the ones you most want to grasp together — worst.) The tree **re-plots as focus moves** and the **camera follows focus**, keeping it centred while its neighbourhood expands and collapses around it. Layout is horizontal left→right: depth is the column (root at the left); each layer is an **evenly-spaced column** and an expanded node's children form a block **centred on that node** — so focus moving within a column never reflows it, and a deep expansion can no longer spread the shallow rows apart. Tiles never touch; edges read bold when they touch the focus, faint otherwise. A **collapsed node** (children hidden) carries a small **`▸N` tab on its right edge** naming its hidden direct-child count, so a leaf and a closed branch never look alike; it picks up the focus colour on the focused node. Keys follow the same relationships (see [[keyboard-nav]]): ←/→ drill out/in, ↑/↓ walk siblings in the focused column.

Each node is a tight **two-row tile** — not a card — so the whole tree fits one screen; a reader sees at a glance both *what this node is* and *who/when*.

**Row 1 — identity & recency:** `status dot · title`, with one recency signal flushed to the right edge. With pending ops it is the **op glyphs** stamped in the author session's colour — `+` added, `~` edited, `✕` deleted, `→` moved (dashed ring while uncommitted; an `added`-only node draws as a translucent ghost) — an overlay means the node is being touched *now*, so the age would be redundant. Without ops it is the **last-edited age**, bare ("3h", "3 小时" — no label, no "ago"), absent when there is no committed history. The tile's `node-dot` (the session-row face has no dot — it leads with its avatar) shows the backend-**derived** four-state (see [[spec-node-states]]): green merged, orange active (pulsing), yellow drift, grey pending.

**Row 2 — marks & people:** the denser cluster lives below the title line: the `version`, the badges — drift's commits-ahead `⚠N`, open issues, scenario count — then the node's *live editors*: the sessions whose pending ops currently touch it (the live overlay, never the historical `session` trailer), one **avatar** each (deduped per session) ringed by liveness and capped with `+N`.

**Avatars** are deterministic, generated from the session id (the dashboard has no real accounts) — one pure `seed → {glyph, shape, colour}` function, no provider registry (an image-avatar seam existed and was removed unused; reintroduce it only when a real provider exists).

**One colour system.** A session's avatar face and its *labelling colour* — node ring/overlay, the reparent edge, the session-row stripe — derive from the SAME hash of the SAME seed (the session id), so a session's face and every mark that names it share one hue. The backend emits a stable `seed` per worktree (its live session id, else its path); the dashboard derives the colour.

A `moved` overlay carrying `toParent` draws a **faint dashed arrow** to the node's proposed new parent, in the author session's colour, so a human SEES the reparent before it merges — overlaid on, never replacing, the solid tree edges.

Because this vocabulary is dense, a **floating legend** decodes it on demand (`?` toggles, Esc closes), reading its swatches from the SAME constants the nodes render from so it can never drift. The legend and the [[settings]] popup share one centered-modal chrome (`Modal.jsx`). `styles.css` is the dashboard's **shared stylesheet**: other surfaces add classes to it — the yatsu eval tab's `.eval-verdict`/`.eval-transcript` rules from the measure-and-score reframe are the latest — so its growth is those features, not this tree's rules.

The board and the session console are **bidirectionally linked**: live editors map to live sessions by exact id, driving Row 2's avatars (see [[session-console]]); clicking a session row focuses its first changed node, and nodes with no live editor focus on click.
