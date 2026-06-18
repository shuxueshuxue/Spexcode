#!/usr/bin/env bash
# @@@ seed-spec-history - replays our real design conversation as the git history of the
# .spec tree. Each commit = one spec change: subject is the REASON, the Session trailer is
# the attribution. A spec node's version history is then just `git log` of its spec.md.
# One-shot: refuses to run if the tree already exists.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -e ".spec/spec-dashboard/spec.md" ] && { echo "spec tree already seeded — aborting."; exit 0; }

seed() {
  local path="$1" session="$2" date="$3" subject="$4"
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  git add "$path"
  GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" \
    git commit -q -m "$subject" -m "Session: $session"
  echo "  ✓ [$session] $subject"
}

seed ".spec/spec-dashboard/spec.md" sess-meta "2026-06-17T09:30:00" \
  "spec: spec-dashboard — the front-end dashboard; a node-graph of specs navigated by logic" <<'EOF'
---
title: spec-dashboard
status: active
session: sess-meta
hue: 210
desc: The front-end dashboard — a node-graph of specs, navigated by logic.
---
# spec-dashboard

One of three SpexCode packages (alongside spec-cli and spec-yatsu).

A node-graph where every node is a spec. Specs form a tree; each version change
is attributed to a Claude Code session. The dashboard reads `main` (the ground
truth) and overlays in-progress worktrees.
EOF

seed ".spec/spec-dashboard/source-of-truth/spec.md" sess-design "2026-06-17T10:00:00" \
  "spec: source-of-truth — .spec on main is canonical; worktrees hold session-attributed proposals" <<'EOF'
---
title: source-of-truth
status: merged
session: sess-design
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
---
# source-of-truth

The canonical spec state is `.spec` on `main`. A worktree's `.spec` is never a
rival truth — it is a pending proposal, attributed to a session. On merge it
becomes the new version plus one entry in that node's history. The dashboard is a
read-time aggregator over git, not a separate store.
EOF

seed ".spec/spec-dashboard/source-of-truth/worktree-linker/spec.md" sess-design "2026-06-17T10:20:00" \
  "spec: worktree-linker — map worktree to node via branch name + untracked .session" <<'EOF'
---
title: worktree-linker
status: merged
session: sess-design
hue: 190
desc: Map each worktree to its node via branch name + an untracked .session file.
---
# worktree-linker

Branch `node/<id>` names the node (self-describing). An untracked `.session` file
carries the live session id/status. The linker = `git worktree list` -> parse
branch -> diff vs main -> overlay. Composable: `.spec` stays in-tree.
EOF

seed ".spec/spec-dashboard/source-of-truth/topology-eager/spec.md" sess-design "2026-06-17T10:40:00" \
  "spec: topology-eager — topology commits to main eagerly; content lives long in worktrees" <<'EOF'
---
title: topology-eager
status: merged
session: sess-design
hue: 175
desc: Topology changes commit to main eagerly; node content lives long in worktrees.
---
# topology-eager

Two kinds of change. Topology (create / reparent) must commit to `main` eagerly
so children are visible and child worktrees can be seeded. Content (a node's spec
body) can live as a long-running worktree diff until merged.
EOF

seed ".spec/spec-dashboard/dashboard-ui/spec.md" sess-design "2026-06-17T11:00:00" \
  "spec: dashboard-ui — choose web over TUI/GUI (xterm terminal-feel + rich media)" <<'EOF'
---
title: dashboard-ui
status: merged
session: sess-design
hue: 265
desc: Web over TUI/GUI — real terminal feel via xterm, rich media for yatsu evidence.
---
# dashboard-ui

Chose web. xterm gives genuine terminal interaction (capture-pane / send-keys);
the browser renders A->B screenshots and video for free. A TUI is cheap for
terminals but poor for media; a native GUI costs the most. Tauri optional later
for packaging.
EOF

seed ".spec/spec-dashboard/dashboard-ui/node-graph/spec.md" sess-graph "2026-06-17T11:30:00" \
  "spec: node-graph — render a focused lens, not the whole forest" <<'EOF'
---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots.
---
# node-graph

The full-forest view confused siblings with cousins. Show the local neighbourhood
and navigate by relationship.
EOF

seed ".spec/spec-dashboard/dashboard-ui/node-graph/spec.md" sess-graph "2026-06-17T12:00:00" \
  "spec: node-graph — stable tree; viewpoint pans, tree never re-plots" <<'EOF'
---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots.
---
# node-graph

The full-forest view confused siblings with cousins. Show the local neighbourhood
and navigate by relationship.

## v2 — stable map
The tree sits at fixed absolute positions and never re-plots. The viewpoint moves
(a flat constant-zoom pan that centres the focus); only highlight / dim / edge
colour change per keystroke. Edges: bold = touches focus, faint = not.
EOF

seed ".spec/spec-dashboard/dashboard-ui/keyboard-nav/spec.md" sess-1c9d "2026-06-17T12:30:00" \
  "spec: keyboard-nav — logical relationship nav (left/right siblings, up parent, down child)" <<'EOF'
---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
---
# keyboard-nav

Left/right = siblings, up = parent, down = child. Logical keys on a stable tree.
EOF

seed ".spec/spec-dashboard/dashboard-ui/keyboard-nav/spec.md" sess-1c9d "2026-06-17T13:00:00" \
  "spec: keyboard-nav — fix camera jump: replace Van Wijk zoom arc with flat constant-zoom pan" <<'EOF'
---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
---
# keyboard-nav

Left/right = siblings, up = parent, down = child. Logical keys on a stable tree.

## v2 — flat camera
Replaced React Flow's Van Wijk zoom arc (the "jump too high") with a flat
constant-zoom rAF pan that centres the focused node. +/- adjust the zoom.
EOF

seed ".spec/spec-dashboard/dashboard-ui/keyboard-nav/spec.md" sess-1c9d "2026-06-17T13:30:00" \
  "spec: keyboard-nav — down picks nearest child; left/right fall back to nearest node across subtrees" <<'EOF'
---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
---
# keyboard-nav

Left/right = siblings, up = parent, down = child. Logical keys on a stable tree.

## v2 — flat camera
Replaced React Flow's Van Wijk zoom arc (the "jump too high") with a flat
constant-zoom rAF pan that centres the focused node. +/- adjust the zoom.

## v3 — cross-subtree
Down descends to the horizontally nearest child. Left/right fall back to the
nearest node in that direction across the whole tree when no sibling exists —
reversible on a tidy tree because each subtree owns a contiguous x-band.
EOF

seed ".spec/spec-dashboard/dashboard-ui/session-peek/spec.md" sess-7f3a "2026-06-17T14:00:00" \
  "spec: session-peek — embed the live session via capture-pane / send-keys" <<'EOF'
---
title: session-peek
status: active
session: sess-7f3a
hue: 150
desc: Embed the live session via capture-pane / send-keys.
---
# session-peek

tmux is client/server. Read a pane with `capture-pane -p -e`, write with
`send-keys` — no attached terminal needed. xterm.js renders it in the browser.
EOF

seed ".spec/spec-dashboard/dashboard-ui/session-peek/spec.md" sess-7f3a "2026-06-17T14:30:00" \
  "spec: session-peek — fix Esc: xterm captured focus; intercept via attachCustomKeyEventHandler" <<'EOF'
---
title: session-peek
status: active
session: sess-7f3a
hue: 150
desc: Embed the live session via capture-pane / send-keys.
---
# session-peek

tmux is client/server. Read a pane with `capture-pane -p -e`, write with
`send-keys` — no attached terminal needed. xterm.js renders it in the browser.

## v2 — esc fix
xterm grabbed keyboard focus, so the window never saw Escape. Intercept it via
`term.attachCustomKeyEventHandler` -> onClose. Esc now exits reliably.
EOF

seed ".spec/spec-dashboard/yatsu-evidence/spec.md" sess-meta "2026-06-17T15:00:00" \
  "spec: yatsu-evidence — computer-use agents record A->B GUI evidence per version (pending)" <<'EOF'
---
title: yatsu-evidence
status: pending
session: sess-meta
hue: 30
desc: Computer-use agents record A->B GUI evidence per version. Designed, not built.
---
# yatsu-evidence

yatsu ("you as the stupid user") drives desktop containers and computer-use
agents to replay a spec's scenario and record before/after. Verification by
looking, not by the developer testing manually. A = prev version, B = this version.
EOF

seed ".spec/spec-dashboard/yatsu-evidence/ab-screenshots/spec.md" sess-b412 "2026-06-17T15:30:00" \
  "spec: ab-screenshots — render before/after inline as SVG placeholders" <<'EOF'
---
title: ab-screenshots
status: active
session: sess-b412
hue: 45
desc: Render before/after inline as SVG placeholders for real yatsu captures.
---
# ab-screenshots

Until yatsu records real GUI, the dashboard shows generated SVG A->B in the
evidence pane. Stored as a per-version artifact pointer (a manifest in `.spec`,
blob content-addressed out of tree).
EOF

seed ".spec/spec-dashboard/spec.md" sess-meta "2026-06-17T16:00:00" \
  "spec: spec-dashboard — multi-pane node view; sidebar split into global stats + focused info" <<'EOF'
---
title: spec-dashboard
status: active
session: sess-meta
hue: 210
desc: The front-end dashboard — a node-graph of specs, navigated by logic.
---
# spec-dashboard

One of three SpexCode packages (alongside spec-cli and spec-yatsu).

A node-graph where every node is a spec. Specs form a tree; each version change
is attributed to a Claude Code session. The dashboard reads `main` (the ground
truth) and overlays in-progress worktrees.

## v2
- Enter opens a node into switchable panes: spec / terminal / evidence / history.
- The sidebar is split into global statistics and focused-node information.
EOF

echo "done — seeded spec tree across $(git rev-list --count HEAD) commits."
