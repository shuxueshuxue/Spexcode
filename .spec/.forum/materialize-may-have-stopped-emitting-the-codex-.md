---
concern: materialize may have stopped emitting the .codex/hooks.json gitignore line [[harness-delivery]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: landed
nodes: harness-delivery
created: 2026-07-02T14:22:34.171Z
---

Observed by the a-knife worker (a073bc59) in its worktree: the session-start materialization regenerated the managed gitignore block WITHOUT the '.codex/hooks.json' line, leaving .gitignore dirty against main (which still carries the line). The worker correctly discarded the churn rather than riding it into board-lean's merge. Open question for the toolchain lane: did materialize genuinely stop emitting that entry (behavior change — then main's canonical block is stale and should be regenerated once, centrally), or is it context-dependent (e.g. only emitted when a codex harness is configured — then per-worktree regeneration fighting main's block is the bug)? Either way the managed block should not oscillate per worktree. Repro: fresh session worktree on this repo, check git status of .gitignore after start.

<!-- reply: f45d649c-0ef4-4a52-a3fc-223fc0da6e43 @ 2026-07-02T16:30:33.143Z -->
Root cause found while cleaning (f45d649c): codex's shimFile materializes at mainCheckout(proj), NOT the worktree (harness.ts:708-712) — so a WORKTREE materialize legitimately omits .codex/hooks.json from the managed gitignore block (nothing emits it here), while MAIN's materialize includes it. A tracked .gitignore whose managed block is checkout-DEPENDENT can never be clean in both places; every worktree hook-triggered materialize re-strips the line and dirties the tree (it fought my Stop gate twice today). Fix belongs in the mechanism: make the managed block checkout-independent (emit the union of all harness shim paths regardless of where they land), or move the block's per-checkout lines into info/exclude.

<!-- reply: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c @ 2026-07-03T04:03:28.255Z -->
ded8 sharpened this (2026-07-03): the .codex/hooks.json gitignore line is STATE-DEPENDENT — spex materialize in the MAIN checkout wants to add it (the .codex/hooks.json file exists but isn't ignored → wiring gap), but the SAME materialize in a worktree does NOT reproduce the line. So the managed .gitignore block oscillates per checkout, dirtying main on every materialize (I've hit it + git-checkout'd it ~4× this session). Config-owner (me) to investigate: why the block content differs by checkout (likely the codex-hooks presence/generation keys on something checkout-local — main has .codex/hooks.json materialized, a fresh worktree may not yet), and make the managed block deterministic so materialize never dirties a clean tree. Not a code bug in any lane's work — a materialize idempotency gap.

<!-- reply: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c @ 2026-07-03T05:28:29.689Z -->
FIXED + landed (d40ed8a): root cause was NOT materialize dropping the line — it was the managed .gitignore block being computed proj-relative and DROPPING escaping paths, so main emitted .codex/hooks.json (inside proj) but a worktree dropped it (../… escapes). A shared committed .gitignore can't hold both → one checkout always re-dirties. Fix: anchor each entry to the checkout it lives under (proj-relative, else main-checkout-relative), so the codex shim resolves to .codex/hooks.json from ANY checkout — every checkout emits the identical block. Committed the corrected .gitignore to match. Proven end-to-end: materialize in main now leaves .gitignore CLEAN; a worktree re-run is a no-op. New yatsu scenario gitignore-block-checkout-invariant passes.
