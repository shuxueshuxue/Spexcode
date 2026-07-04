---
concern: Adoption via 'spex init' ships no measurement/evidence mechanism — a fresh project's materialized contract has zero yatsu / browser-verify / reproduce nudge, so workers never produce or file measured evidence (let alone video)
by: 508d36a9-84cb-4c2d-a945-789b4f7d0112
status: open
nodes: init-preset, reproduce-before-fix
created: 2026-07-04T04:20:24.386Z
---

Found during the same end-to-end adoption dogfood (fixture /root/e2e-dogfood-2026-07-03). The experiment asked whether a dispatched worker AUTONOMOUSLY (un-prompted) produces real video/measured evidence for an obvious frontend change. Answer: NO — and the root cause is a mechanism gap, not worker behavior.

WHAT A FRESH ADOPTER GETS. `spex init` (default preset) materializes a contract block that carries ONLY: the commit-before-declare ritual + living-doc rule + sibling-node rule (core), issue-linking (forge-link), and memory-hygiene. The `careful` preset adds one plugin (clarify-before-code). NONE of default/careful carry any yatsu / "measure the loss signal" / "drive a real browser" / reproduce-before-fix prose, and no hook emits a yatsu nudge at Stop (verified: stop-gate.sh + all hook handlers contain zero yatsu/measure/video strings).

WHERE THE MEASUREMENT CONTRACT ACTUALLY LIVES. Only in spexcode's OWN .config: `reproduce-before-fix` (surface:system), the "keep the loss signal honest" + "Measuring a frontend node's yatsu — drive a real browser" prose (spexcode's own CLAUDE.md managed block), and the `e2e-review` skill. These are spexcode-repo-only and are NOT in spec-cli/templates/ — so `spex init` never ships them. A fresh adopter therefore has no mechanism pushing toward measurement, yatsu.md creation, evidence capture, or video.

OBSERVED OUTCOME (both launchers, identical). Neither node ended with a yatsu.md, a scenario, or a single eval reading (`spex yatsu show due-date/priority` → hasYatsu:false, 0 scenarios, 0 readings). Both workers DID browser-verify (reclaude: Playwright 12/12; codex: saved /tmp/taskflow-priority-verified.png) — but that came from the "Verify it works" line in the plain task prompt (self-invented instinct), NOT from any mechanism, and neither filed it as yatsu evidence. No video was produced by either.

WHY IT MATTERS. The whole "loss signal the optimizer reads" premise depends on measured evidence existing. On any adopted project it silently doesn't — the signal is blind from day one, exactly when adoption coverage is weakest. The fix is to templatize the measurement/evidence contract into a seeded preset (a surface:system measurement plugin, and/or fold reproduce-before-fix + the frontend-yatsu browser prose into `careful`), so an adopter's workers get nudged to measure the same way spexcode's own do. Exhibit on disk: fixture + both worktrees + session records.
