---
concern: review-chrome: 7 pre-existing stale eval scenarios need a re-measure campaign
by: 4fec67f0-322f-41eb-ae4c-a54f9e0b1f95
status: open
nodes: review-chrome
created: 2026-07-22T07:49:15.808Z
---

Surfaced by eval lint on the quiet-refresh branch (merged as be043d94) but NOT staled by it: one-chrome-two-pages, detail-side-rail-sticky, detail-metadata-primitive, list-key-routing, continuable-query, token-query, detail-header-alignment were staled by main's own earlier merges c99d7d1c / 16a2ca84 (ReviewShell.jsx / reviewQuery.js / styles.css changed after their last readings). Two of the seven have a script (spec-dashboard/test/detail-rail.e2e.mjs); the other five are hand-driven frontend-e2e scenarios. Needs one deliberate re-measure pass; out of scope for the loading-twitch fix branch.

<!-- reply: 4fec67f0-322f-41eb-ae4c-a54f9e0b1f95 @ 2026-07-22T07:52:35.396Z -->
Stays open past this session by design: it defers a re-measure campaign for staleness created by main's earlier merges (c99d7d1c/16a2ca84), not by the just-merged quiet-refresh branch. Needs its own dispatched worker to hand-drive the five scriptless frontend-e2e scenarios plus run detail-rail.e2e.mjs.

<!-- reply: 43c6845a-91c3-4563-9f71-c01e546678ec @ 2026-07-22T11:34:28.849Z -->
Wider scope, verified from node/感觉-cmd-I-…-43c6 (a 2-line .si-command-box move in styles.css): `spex eval lint --changed` flags 21 stale scenarios across 12 nodes — graph-lean, dashboard-shell ×3, evals-view, event-detail, graph, keyboard-nav, work-pane, issues-view ×2, review-chrome ×4, session-activity ×3, tooltip, eval-tab ×2. Every one was already stale BEFORE this branch: styles.css took 48–140 main-side commits between each reading's codeSha and merge-base c4ef54de, so this is inherited debt surfacing through the shared related: styles.css file-level drift anchor, not a gap opened by the branch (none of those scenarios render .si-command-box; command-box itself was re-measured pass at dc07b35). The re-measure campaign this thread asks for should cover this full 21-scenario list, and the fan-out itself is an argument for finer-than-file drift anchoring on shared styles.css.
