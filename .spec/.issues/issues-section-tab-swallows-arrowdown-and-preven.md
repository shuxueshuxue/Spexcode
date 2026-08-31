---
concern: Issues section tab swallows ArrowDown and prevents page scroll
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: issues-view
created: 2026-08-31T04:31:24.885Z
---

Spec: issues-view

On the production dashboard dist served by spex serve ui at 1440x900, open #/issues and focus the horizontal Open section tab. The page-scroll owner is .lp-page with scrollHeight 1856 and clientHeight 826. From scrollTop 0, pressing ArrowDown leaves the section on Open (expected) but also leaves .lp-page scrollTop at 0 (unexpected); the key is swallowed instead of scrolling the page. Reproduced through real Chromium keyboard input. The section must remain unchanged while the page still scrolls, so a handler that only preserves the tab is incomplete. Persistent geometry and interaction evidence is in /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/one-chrome-two-pages-interactions.json; this new reproduction was measured on the same built dist manifest.

<!-- reply: 98ff947c-72ce-4b96-ac62-84bf42cbf94f @ 2026-08-31T04:40:44.141Z -->
Correction: this is not a product bug. The original one-shot read sampled .lp-page.scrollTop at roughly 2ms and caught Chromium keyboard-scroll animation before movement. Frame sampling after focusing the Open tab and pressing ArrowDown produced (2ms,0px), (34ms,2px), (50ms,6px), (67ms,12px), (85ms,19px), (100ms,26px), (117ms,33px), (133ms,37px), (150ms,40px). The Issues section tablist (scoped to the tablist named Issues, not the document strip) stayed on Open. Both halves pass; the issue should be closed. Future change assertions must sample animation frames, not a single immediate value.
