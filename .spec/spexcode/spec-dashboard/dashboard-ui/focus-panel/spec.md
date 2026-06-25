---
title: focus-panel
status: active
hue: 300
desc: A right column showing the FOCUSED node's Issues and Scenarios together — their satisfaction status in one place — so the two stateful kinds of bound work share one surface instead of an issue popup on the node.
code:
  - spec-dashboard/src/FocusPanel.jsx
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# focus-panel

A persistent **right column** that reads the **focused** node and shows, in one place, the two kinds of
**stateful bound work** pointing at it: its **Issues** (open + closed, from the forge) and its **Scenarios**
(the yatsu loss targets, with each one's satisfaction status). It makes Issues and Scenarios **equal
citizens** of a node — both are things that *do*, with their own state, surfaced side by side — rather than
privileging issues with a popup that opened only on the node.

## raw source

Put a small dedicated window on the RIGHT of the board that follows the focused node and lists, for that node:
its **Scenarios** — each with its satisfaction state (fresh pass / fail / stale / never-measured), its
`expected`, and the files it tracks — headed by a **✓ satisfied / total** count; and its **Issues** — open
and closed, each a card linking to the forge, headed by open/closed counts. This REPLACES the on-node issue
popover: a node's bound work is read here, in one surface that treats Issues and Scenarios alike, not in a
card that pops on hover/focus of the node itself.

## expanded spec

**The head.** It leads with the focused node's identity: the `focus` eyebrow, the node **title**, and a
**clamped preview of its `desc`** (the frontmatter one-liner), so the column says *what this node is* before
it lists what it owes. The desc is line-clamped (full text on hover) and absent when the node declares none.

**One surface, two stateful kinds.** The panel is the answer to "what does this node still owe?" — and a
node owes on two axes that used to live apart: **issues** (external forge work, open/closed — [[dashboard-issues]])
and **scenarios** (internal loss targets, satisfied/outstanding — [[yatsu-score-badge]]). Both are *execution*
that rides beside the git-derived node, never node state; the panel lays them out with the same weight so
neither is the privileged one. It is **read-only** and does no fetch of its own: it reads the focused board
node verbatim (`node.scenarios` + `node.evals` + `node.issues`, all folded onto `/api/board`), so it tracks
focus on every poll and stays in lock-step with the tile.

**Scenarios, per-scenario.** It joins the node's declared scenarios to their latest reading (the shared
`scenarioStates` from [[yatsu-score-badge]]) so a **never-measured** scenario still appears — it is a unit of
loss, not an absence. Each row leads with a state mark in the score colour vocabulary, then the scenario name,
a **clamped preview** of its `expected` (the glance stays compact — long prose never blows out the column),
and — when the scenario scopes its own freshness — the **files it tracks** (the per-scenario `code` from
[[yatsu-core]]). The whole row is a **button that drills into the focused node's eval tab** (opens the
node-info popup on its eval pane), so the glance is the entry point to the full reading timeline, not a dead
end. The section header carries the **✓ satisfied / total** count, the same tally the tile shows, coloured by
the worst-first aggregate.

**Issues, open and closed.** The full bound set, grouped open-first then closed, each a card (number · state ·
title) linking to the forge — the same `.issue-card` vocabulary the node-info Issues tab uses. The on-tile
**count badge** (◆N) stays as the glance; the LIST now lives here, not in a popover.

**Where it mounts.** It is the board shell's right grid column (`App.jsx`, the shared `.app` layout), beside
the graph pane — desktop only (the phone keeps its own drill-down, [[mobile-ui]]). It owns its `FocusPanel.jsx`
plus its `.focus-panel` slice of the shared stylesheet and the one-column-to-two `.app` grid change, on
[[node-graph]]'s shared-stylesheet/shared-shell contract — so a co-owner's churn in App.jsx or styles.css is
that feature, not this node's drift.

Out of scope: the node-info popup's own Issues/Eval tabs ([[yatsu-eval-tab]]) stay as the deep timeline view
this panel **drills into** (the always-on glance, not a replacement for it). Editing or creating scenarios is
a workflow, not a view — that is the `/scenario` config flow, a separate node.
