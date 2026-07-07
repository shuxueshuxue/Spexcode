---
title: focus-panel
status: active
hue: 300
desc: A right column showing the FOCUSED node's Issues and Scenarios together — their satisfaction status in one place — so the two stateful kinds of bound work share one surface instead of an issue popup on the node.
code:
  - spec-dashboard/src/FocusPanel.jsx
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/IssueCard.jsx
  - spec-dashboard/src/address.js
  - spec-dashboard/src/styles.css
---
# focus-panel

A persistent **right column** that reads the **focused** node and shows, in one place, the two kinds of
**stateful bound work** pointing at it: its **Issues** (open + closed, from the forge) and its **Scenarios**
(the yatsu loss targets, with each one's satisfaction status). It makes Issues and Scenarios **equal
citizens** of a node — both *do*, with their own state, side by side — rather than privileging issues
with a popup that opened only on the node.

## raw source

Put a small dedicated window on the RIGHT of the board that follows the focused node and lists, for that node:
its **Scenarios** — each with its satisfaction state (fresh pass / fail / stale / never-measured), its
`expected`, and the files it tracks — headed by a **✓ satisfied / total** count; and its **Issues** — open
and closed, each a card linking to the forge, headed by open/closed counts. This REPLACES the on-node issue
popover: a node's bound work is read here, in one surface that treats Issues and Scenarios alike, not in a
card that pops on hover/focus of the node itself.

## expanded spec

**The head.** It shows the focused node's identity: the node **title** and a **clamped preview of its
`desc`** (the frontmatter one-liner), so the column says *what this node is* before what it owes — no
`focus` kicker or head hairline. The desc is line-clamped (full on hover), absent when undeclared.

**One surface, two stateful kinds.** The panel is the answer to "what does this node still owe?" — and a
node owes on two axes that used to live apart: **issues** (external forge work, open/closed — [[dashboard-issues]])
and **scenarios** (internal loss targets, satisfied/outstanding — [[yatsu-score-badge]]). Both are *execution*
that rides beside the git-derived node, never node state; the panel lays them out with the same weight so
neither is the privileged one. It is **read-only**: structure and state come from the focused board node
verbatim (`node.scenarios` + `node.evals` + `node.issues`, folded onto `/api/board`), in lock-step with the
tile on every poll. Scenario *prose* is off the board ([[board-lean]]): the `expected` preview and
tracked-files line join from the shared lite corpus, fetched once on the first focus of a scenario-bearing
node — never per poll — so a row renders name/state/tags instantly and prose fills in when the corpus lands.

**Scenarios, per-scenario.** It joins the node's declared scenarios to their latest reading (the shared
`scenarioStates` from [[yatsu-score-badge]]) so a **never-measured** scenario still appears — it is a unit of
loss, not an absence. Each row leads with a state mark in the score colour vocabulary, then the name, a
**clamped preview** of its `expected` (long prose never blows out the column), and — when the scenario
scopes its own freshness — the **files it tracks** (per-scenario `code`, [[yatsu-core]]). The whole row is a
**button that emits the scenario's [[address-routing]] target** (`eval(node, scenario)`), so the glance is an
entry point to the full reading timeline without owning the routing vocabulary itself. The section header
carries the **✓ satisfied / total** count, the same tally the tile shows, coloured by the worst-first
aggregate.

**Issues, open and closed.** The full bound set, grouped open-first then closed, each rendered through the
same compact `IssueCard` the node-info Issues tab uses (id · store · state · clamped concern). The card emits
the issue [[address-routing]] target and preserves a canonical href; forge permalinks stay secondary metadata
in the Issues detail, never this glance's primary route. Long ids and concerns truncate inside the column, so
the right sidebar never grows a bottom scrollbar. The on-tile **count badge** (◆N) stays as the glance; the
LIST now lives here, not in a popover.

**Where it mounts.** It is the board shell's right grid column (`App.jsx`, the shared `.app` layout), beside
the graph pane — desktop only (the phone keeps its own drill-down, [[mobile-ui]]). It owns `FocusPanel.jsx`, its `.focus-panel`
stylesheet slice, and the one-to-two-column `.app` grid change, on [[node-graph]]'s shared-shell contract —
a co-owner's churn in App.jsx or styles.css is that feature, not this node's drift.

Out of scope: address execution belongs to [[address-routing]], and the node-info popup's own Issues/Eval
tabs ([[yatsu-eval-tab]]) remain reference panes for the focused node. Editing or creating scenarios is a
workflow, not a view — that lives in the `/extract` config flow, not here.
