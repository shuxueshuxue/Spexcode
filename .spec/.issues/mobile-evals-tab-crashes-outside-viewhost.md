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
