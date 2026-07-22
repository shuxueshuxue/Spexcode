---
concern: review-chrome: 7 pre-existing stale eval scenarios need a re-measure campaign
by: 4fec67f0-322f-41eb-ae4c-a54f9e0b1f95
status: open
nodes: review-chrome
created: 2026-07-22T07:49:15.808Z
---

Surfaced by eval lint on the quiet-refresh branch (merged as be043d94) but NOT staled by it: one-chrome-two-pages, detail-side-rail-sticky, detail-metadata-primitive, list-key-routing, continuable-query, token-query, detail-header-alignment were staled by main's own earlier merges c99d7d1c / 16a2ca84 (ReviewShell.jsx / reviewQuery.js / styles.css changed after their last readings). Two of the seven have a script (spec-dashboard/test/detail-rail.e2e.mjs); the other five are hand-driven frontend-e2e scenarios. Needs one deliberate re-measure pass; out of scope for the loading-twitch fix branch.
