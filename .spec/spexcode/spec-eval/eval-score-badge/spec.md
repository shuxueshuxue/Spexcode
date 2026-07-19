---
title: eval-score-badge
status: active
hue: 160
desc: The at-a-glance scenario vocabulary on score.jsx — a per-scenario COUNT (✓ satisfied / total) on each node tile, a ringed circle on every eval-tab row, and each scenario's classification TAG CHIPS, so a board sweep reads how many of a node's scenarios are satisfied, which are blind spots, and what each one is.
code:
  - spec-dashboard/src/score.jsx
related:
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/SpecNode.jsx
  - spec-dashboard/src/address.js
  - spec-dashboard/src/evalNav.test.mjs
---
# eval-score-badge

The board carries every node's eval readings AND its declared scenarios ([[eval-tab]] folds both onto
`/api/graph`). This node spends that data on a **glance**: a small **count** on the node tile — ✓ *satisfied
of total* — that says, without opening anything, **how many** of a node's scenarios are measured-and-passing
and how many are still **outstanding** (failing, stale, or never measured). A score is execution, like an
issue count — so it rides **beside** the node, never *as* node state: the git-derived status dot keeps its own
authority, and the count is drawn deliberately UNLIKE it.

## raw source

Put each node's eval score on its tile as a per-scenario **count** — `✓ satisfied / total` — not one fuzzy
collapsed verdict. `satisfied` is the scenarios that are a fresh pass; the gap up to `total` is the
outstanding loss (a fresh fail, a stale reading, or a scenario never measured), so the number itself says how
far the node is from zero loss. The count's COLOUR carries the worst-first state — green when every scenario
is a fresh pass, red when any is a fresh fail, grey when the rest is only stale or blind — so the loudest
problem still reads at a glance. NO badge at all when the node declares no scenarios (no eval.md). The eval
tab keeps the per-reading **circle** (a ring whose colour is freshness, whose ✓/✗ is the verdict), and the
count reuses that same colour vocabulary, so tile and tab still speak ONE language.

## expanded spec

**One vocabulary, two surfaces.** The scoring lives once in `score.jsx`: `readingScore` maps ONE reading to a
circle state; `scenarioStates` joins the node's DECLARED scenarios (the folded `node.scenarios`) to their
latest reading so a **never-measured** scenario is still seen — a unit of loss, not an absence; `aggregateState`
folds those per-scenario states to one worst-first colour; `ScenarioCount`
renders the tile/stat-bar count; `ScoreBadge` delegates the per-reading `icon + label + tone` to
[[review-chrome]]'s ONE `ReviewState` mapping, so graph/eval-tab glances and the routed Evals list/detail/A-B
cannot disagree or fall back to Unicode. The node tile ([[node-graph]]) and
the node-info stat bar render `ScenarioCount`; the eval tab ([[eval-tab]]) renders the per-reading circle.

**Tags are the second at-a-glance adornment.** Beside the satisfaction count, a scenario carries
classification [[eval-core]] tags; `score.jsx` exports the one shared **`TagChips`** element that renders
them as a compact wrapping row of chips. It is the SAME element wherever a scenario surfaces — the search
palette ([[session-search]]) and the eval tab's declared-scenario row —
so a tag looks identical everywhere and reads off the same `.tag-chip` vocabulary the other chips use.
`scenarioStates` already threads each scenario's `tags` through (it spreads the scenario), so the consumers
need no extra wiring. This node owns `TagChips` + its `.tag-chip` style slice; it does NOT own the tag
*vocabulary* or its validation — that is [[eval-core]]'s schema. Count says *how satisfied*, tags say *what
kind* — two orthogonal glances on one scenario.

**The glance is an entry point — a real anchor, never a dead pill.** Wherever the score vocabulary surfaces
as an *affordance*, it is a REAL `<a href>` into the routed Evals pages ([[evals-view]]), so middle-click,
copy-link, and keyboard Enter come free and browser history — never an in-page fake Back — is the return
path. A **concrete** reading (an eval-tab reading row) links to the canonical full-page detail
`#/evals/<node>/<scenario>` (path only — the detail hash carries no list filters). An **aggregate** count
with no single scenario behind it — the node-info stat bar's `ScenarioCount` — links to the Evals LIST
filtered to the node, and every such href is minted by [[address-routing]]'s ONE scenario-less
`evalAddress(nodeId)` form, so the list-filter grammar has exactly one swap point when it evolves. The graph
TILE's count is the one deliberate exception: it stays a passive glyph, because a tile's click belongs to
the board ([[node-graph]]) — `ScenarioCount` renders the anchor only when handed an `href`.
`evalNav.test.mjs` pins this contract at the source level.

**The aggregate is a worst-first fold** over the per-scenario states: any **fresh fail** makes it red ✗ (the
loudest current signal); else any **stale** scenario makes it grey (fail-flavoured if any stale scenario
last-failed, else pass-flavoured — the node remembers its last verdict but admits it's out of date); else any
scenario with **no current score** — never measured (its own state, counted toward the total), or only a
note/legacy reading — makes it the empty blind-spot colour the scoreboard exists to surface; else every
declared scenario is a **fresh pass** and it is green ✓. Because the fold now ranges over DECLARED scenarios,
not just the readings that happen to exist, a node with an unmeasured scenario reads as the blind spot it is.

**Freshness is the same live signal the tab and `spex eval lint` use** ([[eval-core]]'s scenario-freshness derivation): it arrives on each
reading's `fresh` flag — this node never recomputes it. A scenario's freshness can be scoped to its own
`code` files ([[eval-core]]); this node just reads the resulting per-reading `fresh`. A `note` and a legacy
pre-verdict reading carry no ✓/✗, so they read as a blind spot here while their textual verdict badge still
names them in the tab.

**This node owns only its score slice** of the shared node tile (`SpecNode.jsx`) and of the shared stylesheet
(its `.score-badge` + `.scenario-count` rules, sanctioned by [[node-graph]]'s shared-stylesheet contract) —
exactly as [[dashboard-issues]] owns only its issue badge there — so a co-owner's churn in those files is that
feature, not this node's drift. Out of scope: what a score MEANS or how it is measured (that is [[spec-eval]]
/ [[eval-core]]); and the deep per-reading timeline, which is the eval tab's job.
