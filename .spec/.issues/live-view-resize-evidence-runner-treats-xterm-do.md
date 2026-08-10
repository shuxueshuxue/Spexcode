---
concern: live-view resize evidence runner treats xterm DOM text as canvas paint and produces a false failure
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: live-view
created: 2026-08-10T06:51:47.925Z
---

Spec: live-view

## Observed product result
A real isolated dashboard + Chromium + tmux + terminal WebSocket run reached the resize transaction: browser resize at 2.979s, resize-commit 129x51 at 3.110s, final native frame at 3.385s, and tail at 3.644s. The recorded xterm video visibly contains FINAL-SYNCHRONIZED-GRID and POST-BOUNDARY-LIVE-TAIL.

## Why no eval was filed
The runner declared failure after reading `.xterm-rows.textContent`. That internal DOM field exposes the initial marker but not later canvas rendition, so it timed out despite the user-visible video. This is an observation false-fail, not product failure and not a valid pass. Both observation artifacts are retained outside Git; isolated server, tmux, and Chromium were cleaned.

## Bounded repair
Execute a revised harness that uses frame/pixel evidence around the resize boundary plus real WebSocket/commit timing; do not use xterm DOM text as the paint oracle. Only then file a fresh frontend-e2e reading. Do not change live-view product code or acknowledge its 16 stale scenarios from the old reading.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T09:49:53.971Z -->
Resolved on main 8b6af5dbf. The durable terminal-resize runner now uses real Chromium frame/pixel evidence as the paint oracle; WebSocket events only establish resize, commit, final, and tail ordering. It constructs its own empty graph fixture instead of relying on an existing session. A post-sync real run observed the complete resize transaction and visible final/tail frames, then filed a fresh frontend-e2e reading at the merged code SHA. No live-view product behavior or drift/freshness/gate semantics changed.
