---
scenarios:
  - name: anchor-canonical-seek
    tags: [frontend-e2e]
    related: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >-
      In a real browser, open the eval detail on a scenario with TWO readings whose step-timelines place the
      SAME named step at DIFFERENT times (a re-measure moved it). On each reading, click a remark anchored to
      that step and observe where the clip seeks; also view a remark whose step is absent from the current
      reading's timeline.
    expected: >-
      The anchor seeks to the step's LIVE tMs on whichever reading is shown — the right frame on BOTH, not the
      frozen m:ss of the other reading — and the shown m:ss re-derives to match the current clip. A remark
      whose step is gone from the current timeline renders as a readable-not-seekable chip (marked degraded ⚠,
      no seek), never silently seeking to a wrong moment. Scrubber markers sit at the resolved step positions.
  - name: dispatch-fallback-chain
    tags: [cli]
    related: [spec-cli/src/mentions.ts, spec-cli/src/localIssues.ts]
    description: >-
      Author a remark on a (node, scenario) eval track and drive the loop-in fallback chain: (a) the reading's
      filer session online, (b) the filer offline but the node's governing session online, (c) both offline.
      Inspect who is notified and the remark's resolved bit after each.
    expected: >-
      (a) the filer is notified; (b) delivery falls through to the node's governing session; (c) nobody is
      notified and it stays silent (the teeth still surface the remark). In every case the notification
      RESOLVES nothing — the remark stays unresolved (resolve is a deliberate `spex resolve`), no worker is
      spawned (only `@new` spawns), and the chain stops at the first online link (no double-delivery to a link
      already reached by an explicit `@`-mention).
  - name: dangling-orphan-visible
    tags: [cli, frontend-e2e]
    related: [spec-yatsu/src/evaltab.ts, spec-yatsu/src/cli.ts, spec-dashboard/src/NodeView.jsx]
    description: >-
      Remark a scenario, then rename/delete it in yatsu.md so its (node, scenario) track joins no reading.
      Read the node's eval timeline at node level and run `spex yatsu scan`.
    expected: >-
      The orphaned track surfaces as a synthetic dangling row at node level — the gone scenario name struck
      through / marked, its remarks listed and still resolvable/retractable via their refs — never vanishing.
      `spex yatsu scan` prints a `yatsu-dangling` line for the node and counts it in the summary. The dangling
      track ages NOTHING: it stays out of latestPerScenario / the board scoreboard, and no other scenario is
      staled by it. A still-declared-but-unmeasured scenario is NOT flagged dangling (it is a blind spot).
---

# measuring remark-polish

YATU each strand through the surface a user actually touches. Strand 1 is a **real browser** reading of the
eval detail across two readings with divergent step-timelines — the only honest proof that the anchor
re-resolves by step-name rather than seeking a frozen m:ss. Strand 2 is measured through the real
`remark` + loop-in path in `mentions.ts`/`localIssues.ts`, reading who was notified and confirming the remark
stays unresolved (notification never resolves). Strand 3 is measured both from the CLI (`spex yatsu scan`'s
`yatsu-dangling` line + the node eval timeline's `dangling` field) and in the browser (the struck-through
node-level row), on a scratch/disposable yatsu.md so the rename leaves no residue.
