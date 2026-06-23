---
title: yatsu-score-badge
status: active
hue: 160
desc: The yatsu score at a glance — one ringed circle on each node tile (and on every eval-tab row) whose colour reads freshness and whose ✓/✗ reads the verdict, so a board sweep finds the blind spots.
code:
  - spec-dashboard/src/score.jsx
  - spec-dashboard/src/SpecNode.jsx
---
# yatsu-score-badge

The board already carries every node's eval readings ([[yatsu-eval-tab]] folds them onto `/api/board`). This
node spends that data on a **glance**: a small **score circle** on the node tile that says, without opening
anything, whether a node's scenarios are measured-and-passing, measured-and-failing, or a **blind spot**
(stale or never measured). A score is execution, like an issue count — so it rides **beside** the node, never
*as* node state: the git-derived status dot keeps its own authority, and the score circle is drawn
deliberately UNLIKE it.

## raw source

Put each node's yatsu score on its tile as one small ROUND badge — a ring with a centred glyph, styled so it
never reads as the square status hue dot. The circle is constant; what's INSIDE tells the state. Colour
carries freshness, the mark carries the verdict, an empty ring is the blind spot: green ✓ = a current
(fresh) pass · red ✗ = a current fail · grey ✓ / grey ✗ = stale (the last verdict, greyed — measured once,
now out of date) · empty ring = never measured (no pass/fail verdict to show). NO badge at all when the node
declares no scenarios (no yatsu.md → nothing to score). The same circle is the eval tab's per-row freshness
signal, so card and tab speak ONE vocabulary.

## expanded spec

**One vocabulary, two surfaces.** The circle and the two reads of a score live once in `score.jsx`:
`readingScore` maps ONE reading to a state, `nodeScore` aggregates a node's whole timeline to one, and
`ScoreBadge` draws the ring. The node tile ([[node-graph]]) renders the aggregate; the eval tab
([[yatsu-eval-tab]]) renders the per-reading state in place of the old freshness badge — so the ⚠ stale mark
is gone, replaced by a greyed verdict, and a reader learns the vocabulary once.

**The aggregate is a worst-first fold** over the LATEST reading per scenario (the board hands them
newest-first): any **fresh fail** makes the node a red ✗ (the loudest current signal); else any **stale**
scenario makes it grey (a grey ✗ if any stale scenario last-failed, else a grey ✓ — the node remembers its
last verdict but admits it's out of date); else any scenario with **no current score** (an empty timeline =
declared but never measured, or only a note/legacy reading) makes it an empty ring — the blind spot the
scoreboard exists to surface; else every scenario is a **fresh pass** and the node is a green ✓.

**Freshness is the same live signal the tab and `spex yatsu scan` use** ([[freshness]]): it arrives on each
reading's `fresh` flag — this node never recomputes it. A `note` (an observation, not a pass/fail) and a
legacy pre-verdict reading carry no ✓/✗, so they read as the empty ring while their textual verdict badge
still names them in the tab.

**This node owns only its score slice** of the shared node tile (`SpecNode.jsx`) and of the shared stylesheet
(its `.score-badge` rules, sanctioned by [[node-graph]]'s shared-stylesheet contract) — exactly as
[[dashboard-issues]] owns only its issue badge there — so a co-owner's churn in those files is that feature,
not this node's drift. Out of scope: what a score MEANS or how it is measured (that is [[spec-yatsu]] /
[[yatsu-core]]); and a partially-measured node's individual missing scenarios are not distinguished on the
card (it reads the folded readings, not the declared-scenario list) — the eval tab is where per-scenario
detail lives.
