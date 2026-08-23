---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A drill-down tidy-tree — only the focused node's spine expands, so the root layer stays a short readable column. Each node shows its identity and its people.
code:
  - spec-dashboard/src/SpecNode.jsx#SpecNode
  - spec-dashboard/src/SpecNode.jsx#Editors
  - spec-dashboard/src/SpecNode.jsx#EDGE_ANCHOR_PROPS
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/specMeta.js
  - spec-dashboard/src/avatar.jsx
  - spec-dashboard/src/color.js
  - spec-dashboard/src/Legend.jsx
  - spec-dashboard/src/Modal.jsx
  - spec-dashboard/test/plugin-node.e2e.mjs
---
# node-graph

A **drill-down** tidy-tree of the spec-node neighbourhood: navigate by **relationship**, not by hunting a full forest where siblings blur into cousins. The focused node's **ancestor spine is expanded**, and the frontier fully opens the focused node's parent layer so the **focused layer and its complete next layer are visible together** — two visible layers of neighbourhood at once — while every deeper subtree collapses to a single tile. The next layer's total height is the layout budget, so sibling branches are visible together instead of folding into one tile. The tree **re-plots as focus moves** and the **camera follows focus**, framing the focused tile at the graph pane's geometric centre while its neighbourhood expands and collapses around it. Layout is horizontal left→right: depth is the column (root at the left); each layer is an **evenly-spaced column** and an expanded node's children form a block **centred on that node**. Each visible child block reserves the sum of its child-block row heights before sibling blocks are centred; tile centres stay `Y_GAP` apart (a 4px clear gap for the fixed 50px tile), so no two visible node boxes overlap, including when adjacent parents both have wide next layers. Coordinates are a function of tree shape and the expansion frontier, never of focus identity: changing focus only adds or removes frontier nodes; every tile that remains visible keeps its x/y when its occupied row budget is unchanged. Tiles never touch; edges read bold when they touch the focus, faint otherwise. A **collapsed node** (children hidden) carries a small **`▸N` tab on its right edge** naming its hidden direct-child count, so a leaf and a closed branch never look alike; it picks up the focus colour on the focused node. Keys follow the same relationships (see [[keyboard-nav]]): ←/→ drill out/in, ↑/↓ walk siblings in the focused column.

Node identity is rendered from the backend title (or its existing leaf fallback) without path-derived prefixes; backend ids and routes remain unchanged. The fixed title slot uses a middle ellipsis in the renderer, preserving the beginning and end of long names so labels that share a prefix remain distinguishable. Full text remains available through the native title tooltip.

Every spec node, including the reserved `.plugins` branch, renders its backend identity unchanged. The ordinary drill-down rule applies uniformly: a collapsed node shows its raw title, version, and direct-child `▸N` tab; focusing it reveals its immediate children. The graph does not invent visual node classes, subtree totals, or presentation-only partitions from a path name.

A re-plot separates **structure** from **navigation feedback**. In graph coordinates the structure updates atomically: newly revealed tiles and their solid tree edges appear together at final geometry, persisting tiles never interpolate between slots, and removed branches leave together. Above that stable topology, a keyboard or programmatic focus move gives direction in screen coordinates: the camera eases onto the target at constant zoom and focus-neighbour opacity settles gently; a pending reparent's dashed overlay arrow flows in its author's colour. None of those cues changes a tile's graph position or a solid edge endpoint, so the tree stays connected throughout the camera move. Mouse focus also re-plots the frontier, but the clicked/focused tile remains at its pre-click screen position while the camera absorbs the layout delta; the world does not jump under the pointer.

The two-layer frontier stays bounded on the full board. A live 362-node board, focused on its deepest depth-6
node, rendered 63 visible tiles; Chrome CDP measured `ScriptDuration=0.301s`, `LayoutDuration=0.074s`, and
`TaskDuration=0.668s` after settle (1440×900). This is the worst-depth two-layer sample recorded for the
contract, not a promise that every machine has the same wall time.

Each node is a tight **two-row tile** — not a card — so the whole tree fits one screen; a reader sees at a glance both *what this node is* and *who/when*.

**Row 1 — identity & recency:** `status dot · title`, with one recency signal flushed to the right edge. With pending ops it is the **op glyphs** stamped in the author session's colour — `+` added, `~` edited, `✕` deleted, `→` moved (dashed ring while uncommitted; an `added`-only node draws as a translucent ghost) — an overlay means the node is being touched *now*, so the age would be redundant. Without ops it is the **last-edited age**, bare ("3h", "3 小时" — no label, no "ago"), absent when there is no committed history. The tile's `node-dot` (the session-row face has no dot — it leads with its avatar) shows the backend-**derived** four-state (see [[spec-node-states]]): green merged, orange active (pulsing), yellow drift, grey pending.

**Row 2 — marks & people:** the denser cluster lives below the title line: the `version`, the badges — drift's commits-ahead `⚠N`, open issues, scenario count — then the node's *live editors*: the sessions whose pending ops currently touch it (the live overlay, never the historical `session` trailer), one **avatar** each (deduped per session) ringed by liveness and capped with `+N`.

**Avatars** are deterministic, generated from the session id (the dashboard has no real accounts) — one pure `seed → {glyph, shape, colour}` function, no provider registry (an image-avatar seam existed and was removed unused; reintroduce it only when a real provider exists).

**One colour system.** A session's avatar face and its *labelling colour* — node ring/overlay, the reparent edge, the session-row stripe — derive from the SAME hash of the SAME seed (the session id), so a session's face and every mark that names it share one hue. The backend emits a stable `seed` per worktree (its live session id, else its path); the dashboard derives the colour.

A `moved` overlay carrying `toParent` draws a **faint dashed arrow** to the node's proposed new parent, in the author session's colour, so a human SEES the reparent before it merges — overlaid on, never replacing, the solid tree edges.

Because this vocabulary is dense, a **floating legend** decodes it on demand (`?` toggles, Esc closes), reading its swatches from the SAME constants the nodes render from so it can never drift. The legend and the [[settings]] popup share one centered-modal chrome (`Modal.jsx`). `styles.css` is the dashboard's **shared stylesheet**: other surfaces add classes to it — the eval tab's `.eval-verdict`/`.eval-transcript` rules from the measure-and-score reframe are the latest — so its growth is those features, not this tree's rules.

The board and the session console are **bidirectionally linked**: live editors map to live sessions by exact id, driving Row 2's avatars (see [[session-console]]); clicking a session row focuses its first changed node, and nodes with no live editor focus on click.

**Inside the workspace this view is the hidden-tab bottom sheet.** `#/graph` and `#/graph/<node>` still
parse, still render, and still behave exactly as described above. With no document focus, the shell lands on
`#/graph`: the graph is the workspace bottom sheet, the same kind of quiet first surface as the New Session
hero. It remains `document:false`, never enters the tab strip, and its camera/expansion are workspace state.
The palette and explorer still reach graph nodes. This supersedes the earlier "empty is an explicit state"
ruling: **这个 Node Graph 其实可以留着…相当于一个隐藏着的 tab** (human ruling).

**The sealed public face is untouched by that retirement** ([[public-spec-graph]]): it is a graph and
nothing else, so it has no workspace to retire from. This is why the view is demoted rather than deleted —
one build's whole product is another build's legacy address.

React Flow handles on these tiles are **edge anchors only**. They may exist in the DOM so parent→child edges attach to the tile edges, but they are never visible connection dots and never interactive hit targets; a click on a tile edge still belongs to the tile.
