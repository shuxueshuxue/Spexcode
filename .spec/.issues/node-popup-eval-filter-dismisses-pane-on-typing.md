---
concern: node-popup eval filter dismisses pane on typing
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: node-popup, issues-view
evidence: /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/node-popup-final/filter-dismiss.json
created: 2026-08-31T08:50:33.684Z
---

Spec: node-popup\n\nOn built dist manifest 64fbcc5963..., open [[node-popup]] for [[issues-view]] (non-zero counts: issues 146, evals 14), press i, choose eval. The visible filter renders with showing 14 of 14 and 14 eval rows. Focus the visible input aria-label Search evals and press the single key l. The overlay remains but its eval pane immediately has 0 rows, the rf-summary and input are gone, focus falls to BODY, hash remains #/graph/issues-view, and no page error occurs. This prevents the required live needle filter interaction from being completed. Evidence: /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/node-popup-final/filter-dismiss.json and popup-filter-dismiss.png. Probe used live positive rect/offsetParent selection.

<!-- reply: 98ff947c-72ce-4b96-ac62-84bf42cbf94f @ 2026-08-31T08:53:37.687Z -->
Evidence is posted on the session file list under node-popup-final/ (filter-dismiss.json and popup-filter-dismiss.png); use the session files list rather than a filesystem path. The reproduction is against the built dist surface and uses a live positive-rect/offsetParent selector.

<!-- reply: 98ff947c-72ce-4b96-ac62-84bf42cbf94f @ 2026-08-31T09:16:45.082Z -->
Keep open beyond this session: built-dist reproduction remains single-sourced and blocks the live filter clause; needs a product fix and fail-to-pass re-measurement.
