---
concern: The dashboard sheet 42 scenarios depend on is governed by no node
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: typography
created: 2026-09-03T14:04:38.928Z
---

The dashboard's entire visual layer lives in one file that no spec node claims, while 42 eval
scenarios anchor their freshness to it. That combination is what let a regression of mine ship
invisibly, so the gap is measured, not theoretical.

MEASURED, on node/hi-8bb0 at 1ef264ae5, with the product's own answer:

  spex spec owner spec-dashboard/src/styles.css
  → not governed (no code: claim), but referenced by 'files', 'live-view', 'web', 'context-dock',
    'dashboard-shell', … 45 nodes in all (related: coverage only). Its drift is tracked on the eval
    axis only: 42 scenarios anchor freshness to it … but no spec body says what it should do.

  of those 42 scenarios, stale right now:            42
  of those 42, ALREADY stale on main:                41
  commits touching the sheet since the oldest anchor: 31

So the one file every dashboard surface is painted with has no governing body, and the only signal
that watches it is 42 screenshots that have been stale for 31 commits. Its one crisp gate is
spec-dashboard/src/styles.test.mjs — but [[typography]] governs that gate as a TEST file, not the
sheet, so the sheet's contract is asserted nowhere and enforced only where a test happens to reach.

HOW IT BIT. a3d1e15c6 on this branch fixed `.proj-fleet-label`, which I had shipped in 74d22109f
with `text-transform: uppercase` and `letter-spacing: 0.06em` — both forbidden outright by the
calm-ui rule. Nothing in the loss signal could have caught it: the sheet's 42 anchored scenarios
were already stale, so their staleness carried no new information, and the one suite that does
assert the rule was not in the gate set I was running. I found it only because a merge from main
forced me to run styles.test.mjs for the first time.

WHY NOT JUST FIX IT HERE. Giving the sheet a governing node is a `code:` reassignment on the
highest-traffic file in the repo — 45 nodes reference it, and whichever node claims it inherits a
one-govern relationship with 42 scenarios' freshness. That is an intent decision about how the
visual layer is owned, not a cleanup, and it does not belong bolted onto a machine-routing lane.
Filing it is the honest defer the lint's own remedy list names for a feature with no home.

WHAT WOULD CLOSE IT, either one:
  - the sheet gets a governing node whose body states the visual contract the calm-ui rule already
    enforces piecemeal (sentence case, the tracking token, hierarchy spent on space→colour→weight→
    size), so a shouting declaration is a spec violation and not just a test failure; or
  - the sheet is split along the node boundaries that already reference it, so each slice maps to
    one node — at which point the 42 anchors become 42 narrow anchors and a sheet change stales
    only the scenarios it can actually affect.

Either way the eval axis stops being the sheet's only reader.

Spec: typography
