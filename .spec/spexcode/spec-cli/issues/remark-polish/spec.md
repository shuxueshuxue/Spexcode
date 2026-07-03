---
title: remark-polish
status: active
hue: 208
desc: M4 of the eval/issue/remark refactor — the closing polish. Three independent strands over the built substrate: an anchor's canonical form is its STEP-NAME (m:ss derived from the current clip, surviving a re-measure), a remark's authoring reaches an agent through a NOTIFICATION fallback chain (filer → node's governing session → nobody, never a resolve), and a dangling remark track (renamed/deleted scenario) surfaces at node level instead of vanishing.
related:
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/EventDetail.jsx
  - spec-cli/src/mentions.ts
  - spec-cli/src/proposals.ts
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/cli.ts
  - spec-dashboard/src/NodeView.jsx
---
# remark-polish

M4 is the closing milestone of the eval/issue/remark refactor: the substrate ([[remark-substrate]]), the
teeth ([[remark-teeth]]), and the split + one detail component ([[eval-issue-split]] / [[event-detail]]) are
built; this node polishes three edges the invariant set (E2, the R3 dispatch clause, directive 5) left
sharp. The three strands are independent and share no new record type or schema growth — each is one
computation reused on every surface, CLI-first.

## Strand 1 — an anchor's canonical form is its step-name (E2)

An anchored remark's first line is `▶m:ss · <step>` ([[event-detail]]). The **step-name is canonical**; the
`m:ss` is *derived from the current clip at render time*, never trusted frozen. The reason is re-measure: a
fresh reading produces a new video where the same step sits at a *different* time, so a frozen `m:ss` would
seek to the wrong moment. The renderer resolves the anchor by **step-name against the CURRENT reading's
[[step-timeline]]** — seek to that step's live `tMs`, and re-derive the shown `m:ss` to match — so the anchor
lands correctly on *every* reading of the scenario, A and B alike.

When the named step is **absent** from the current reading's timeline (a step that reading never had), the
frozen `m:ss` is the only clue and it may be wrong, so the anchor degrades to **readable-not-seekable**: it
still shows (the label is legible), but it is not a seek link and it is marked degraded (⚠). Never silently
wrong. With no timeline at all, or a step-less `▶m:ss`, the frozen `m:ss` is all there is and seeks as
before. The composer keeps stamping **both** — the `m:ss` for the raw reader, the step for the machine — so
authoring is unchanged; only the *reader* re-resolves. This lives in one pure helper (`resolveAnchor`) the
review-track markers and the thread chips both call, so the scrubber and the reply list agree.

## Strand 2 — a notification fallback chain, never a resolve (R3 dispatch clause)

Authoring a remark should **reach an agent who can act on it**. The implicit loop-in ([[mentions]]) already
notifies a thread's originator when online; M4 makes it a **fallback chain**: for an eval-remark the
candidates are, in order, the **reading's filer** session, then the **node's governing session**, then
**nobody** (the remark still surfaces on the board through the teeth). Delivery walks the chain and stops at
the first ONLINE link; an offline/absent link falls through to the next. This is **notification only** — it
**resolves nothing** (R3: resolve is a deliberate `spex resolve`, agent-only, never from dispatch/delivery),
never spawns a worker (only an explicit `@new` spawns), and stays silent when the chain runs dry. It is one
small extension of the existing loop-in seam (`notifyOriginator` takes the chain; `mentions.ts` owns it), not
a new subsystem — a plain issue thread's chain is still just its author, so nothing else changes.

## Strand 3 — a dangling remark track surfaces at node level (directive 5)

A remark whose scenario was **renamed or deleted** keys a `(node, scenario)` that no reading joins — it
loads ([[remark-teeth]]'s dangling clause) but, until now, appeared *nowhere*. M4 surfaces it: the node's
eval timeline (`evaltab.ts`) emits a synthetic **dangling** row per orphaned track — the scenario name struck
through / marked gone, its remarks listed and **resolvable/retractable via their normal refs**
(`spex resolve` / `spex retract`). A track is dangling only when its scenario is BOTH gone from `yatsu.md`
AND has no reading; a still-declared-but-unmeasured scenario is a blind spot, not an orphan. The dangling row
is kept **separate** from `readings` so it never flows into `latestPerScenario` / the board scoreboard: it
**ages nothing** (there is no reading for the teeth to stale), it is only made *visible*. `spex yatsu scan`
notes orphaned tracks (one `yatsu-dangling` line per node plus a count in the summary), so the gap is legible
from the CLI with no server running.
