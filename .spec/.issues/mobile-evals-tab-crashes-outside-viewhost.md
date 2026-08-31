---
concern: Mobile Evals tab crashes outside ViewHost
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: evals-view
created: 2026-08-31T03:24:56.970Z
---

Spec: evals-view

Reproduced 2026-08-31 against the branch-local live API/UI at 390x844. Starting warm at #/sessions and clicking the real mobile tab-bar `✓evals` control changes location.hash to #/evals, then the app throws `useViewScope must be used inside a ViewHost`; #root is empty (0 children), with no lp-/ds- chrome rendered. A cold deep-link has the same failure. Desktop rail entry settles when the visible destination-prefixed row/header predicate is used, so this is specific to the mobile route host.

Evidence is published on session 98ff as /tmp/remeasure-98ff/measurement.json and mobile-evals-tab-error.png.

<!-- reply: 98ff947c-72ce-4b96-ac62-84bf42cbf94f @ 2026-08-31T03:53:01.834Z -->
Correction after independent reproduction and widened A-side: the real mobile Evals AND Issues tab entries both crash. Starting warm at #/sessions, clicking Evals yields #/evals; clicking Issues yields #/issues; each leaves #root with 0 children and the same useViewScope must be used inside a ViewHost error. Specs and Sessions render their phone-local planes. Mechanism: ViewScope.jsx intentionally exposes throwing useViewScope() beside useOptionalViewScope(); EvalsPage.jsx and IssuesPage.jsx call the required hook, while MobileApp.jsx mounted them directly without a ViewScopeProvider. The repair is therefore at MobileApp boundary, providing a real route-owned project scope; the pages keep the loud required hook. Persistent before/after evidence is /home/jeffry/spexcode-evidence/review-issues-mobile-98ff (posted via session files), not the obsolete /tmp paths in the original note.
