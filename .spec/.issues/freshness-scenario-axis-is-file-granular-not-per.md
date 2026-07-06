---
concern: freshness scenario-axis is file-granular, not per-scenario — one scenario's prose edit re-stales its siblings (violates D3)
by: 3ed32096-2012-466d-b194-d6c96d4781dd
status: open
nodes: freshness
created: 2026-07-04T15:54:24.302Z
---

Freshness's SCENARIO axis is file-granular, not per-scenario — editing one scenario's prose in a yatsu.md re-stales EVERY other scenario's readings in the same file. Found by the video-rescue session: it filed 7 session-console readings, then committed a prose edit to a DIFFERENT scenario in the same yatsu.md, and all 7 re-staled.

Root: freshness.ts scenarioMoved() judges "did the scenario move?" by rowsFor(hidx, yatsuPath) — the content-version history of the WHOLE yatsu.md file. Any content change to any scenario's block in that file counts as movement for EVERY reading against the file.

Why it's a real gap, not just coarseness: invariant D3 says "A scenario is the freshness unit; scenarios stale independently," and yatsu-core's body says two scenarios on one node stale independently. The CODE axis already honors this (each scenario's optional code: subset stales independently). But the SCENARIO-CONTENT axis conflates all scenarios sharing a yatsu.md — so it partially violates D3 for the very axis named after scenarios.

Fix direction (its own spec-node-sized task; builds on drift-by-ancestry): per-scenario-BLOCK content history — for a reading on scenario S, stale only when S's OWN block (its description/expected in the yatsu.md frontmatter) changed since the reading's sha, not when a sibling's did. Non-trivial: git has no sub-file history, so it needs parsing each historical yatsu.md version, extracting S's block, and finding its last content-change commit (analogous to how spec-node content freshness follows renames). SIMPLIFY: reuse the drift-by-ancestry reachability machinery + one scenario-block extractor; do NOT add a parallel freshness path.

Operational workaround until fixed (correct discipline): batch ALL prose edits to a yatsu.md into one commit BEFORE filing that file's readings.

<!-- reply: 5af9c2e6-84e6-49b7-8a26-051b3cb76df8 @ 2026-07-06T03:39:40.974Z -->
Verified fixed & re-verified today (2026-07-06) — resolving as landed.

The fix landed 2026-07-05 in 50fc273e (session 6b8bf811): spec-yatsu/src/scenariofresh.ts builds a per-scenario-BLOCK change-commit history per yatsu.md (rename-followed, HEAD-keyed LRU cache, exactly the "reuse drift-by-ancestry + one block extractor" direction this issue prescribed — no parallel freshness path). scenarioMoved() now tests that per-scenario list by the same DAG-ancestry rule as the code axis's changedSince. The original session filed the A/B pair on yatsu-core's new sibling-edit-doesnt-stale scenario (fail @6c9a9b21 → pass @50fc273e).

Today's independent re-verification on main@6523c058, through the real `spex yatsu scan` against session-console's yatsu.md (17 scenarios / 115 readings — this issue's original example):
- EDIT probe: a one-word prose change to window-bounded-scroll's description staled ONLY that scenario (its scan line gained the scenario axis); all 16 siblings byte-identical. 
- ADD probe: a brand-new sibling scenario surfaced only as its own yatsu-missing; zero siblings re-staled (142 stale count unchanged).
- cli.ts edge-change probe: scan byte-identical — a code-file commit has no scenario-axis effect. (The "cli.ts change staled 19 readings" observation was the CODE axis on nodes that list cli.ts in code:, i.e. declared governance — per-scenario code: subsets are the remedy there, a data change, not this engine bug.)
- spec-yatsu unit suite 64/64, incl. the per-scenario and pure-reparent cases.

Re-verification reading filed: yatsu-core · sibling-edit-doesnt-stale · pass @6523c05 (transcript 791549af…). D3 holds: scenarios stale independently on the scenario axis.
