---
title: yatsu-score-badge
status: active
hue: 160
desc: The yatsu score at a glance — a per-scenario COUNT (✓ satisfied / total) on each node tile, and a ringed circle on every eval-tab row, so a board sweep reads how many of a node's scenarios are satisfied and which are blind spots.
code:
  - spec-dashboard/src/score.jsx
  - spec-dashboard/src/SpecNode.jsx
---
# yatsu-score-badge

The board carries every node's eval readings AND its declared scenarios ([[yatsu-eval-tab]] folds both onto
`/api/board`). This node spends that data on a **glance**: a small **count** on the node tile — ✓ *satisfied
of total* — that says, without opening anything, **how many** of a node's scenarios are measured-and-passing
and how many are still **outstanding** (failing, stale, or never measured). A score is execution, like an
issue count — so it rides **beside** the node, never *as* node state: the git-derived status dot keeps its own
authority, and the count is drawn deliberately UNLIKE it.

## raw source

Put each node's yatsu score on its tile as a per-scenario **count** — `✓ satisfied / total` — not one fuzzy
collapsed verdict. `satisfied` is the scenarios that are a fresh pass; the gap up to `total` is the
outstanding loss (a fresh fail, a stale reading, or a scenario never measured), so the number itself says how
far the node is from zero loss. The count's COLOUR carries the worst-first state — green when every scenario
is a fresh pass, red when any is a fresh fail, grey when the rest is only stale or blind — so the loudest
problem still reads at a glance. NO badge at all when the node declares no scenarios (no yatsu.md). The eval
tab keeps the per-reading **circle** (a ring whose colour is freshness, whose ✓/✗ is the verdict), and the
count reuses that same colour vocabulary, so tile and tab still speak ONE language.

## expanded spec

**One vocabulary, two surfaces.** The scoring lives once in `score.jsx`: `readingScore` maps ONE reading to a
circle state; `scenarioStates` joins the node's DECLARED scenarios (the folded `node.scenarios`) to their
latest reading so a **never-measured** scenario is still seen — a unit of loss, not an absence; `aggregateState`
folds those per-scenario states to one worst-first colour; `nodeScore` is that aggregate; `ScenarioCount`
renders the tile/stat-bar count; `ScoreBadge` draws the per-reading ring. The node tile ([[node-graph]]) and
the node-info stat bar render `ScenarioCount`; the [[focus-panel]] renders the same per-scenario states as a
list; the eval tab ([[yatsu-eval-tab]]) renders the per-reading circle.

**The aggregate is a worst-first fold** over the per-scenario states: any **fresh fail** makes it red ✗ (the
loudest current signal); else any **stale** scenario makes it grey (fail-flavoured if any stale scenario
last-failed, else pass-flavoured — the node remembers its last verdict but admits it's out of date); else any
scenario with **no current score** — never measured (its own state, counted toward the total), or only a
note/legacy reading — makes it the empty blind-spot colour the scoreboard exists to surface; else every
declared scenario is a **fresh pass** and it is green ✓. Because the fold now ranges over DECLARED scenarios,
not just the readings that happen to exist, a node with an unmeasured scenario reads as the blind spot it is.

**Freshness is the same live signal the tab and `spex yatsu scan` use** ([[freshness]]): it arrives on each
reading's `fresh` flag — this node never recomputes it. A scenario's freshness can be scoped to its own
`code` files ([[yatsu-core]]); this node just reads the resulting per-reading `fresh`. A `note` and a legacy
pre-verdict reading carry no ✓/✗, so they read as a blind spot here while their textual verdict badge still
names them in the tab.

**This node owns only its score slice** of the shared node tile (`SpecNode.jsx`) and of the shared stylesheet
(its `.score-badge` + `.scenario-count` rules, sanctioned by [[node-graph]]'s shared-stylesheet contract) —
exactly as [[dashboard-issues]] owns only its issue badge there — so a co-owner's churn in those files is that
feature, not this node's drift. Out of scope: what a score MEANS or how it is measured (that is [[spec-yatsu]]
/ [[yatsu-core]]); and the deep per-reading timeline, which is the eval tab's job.
