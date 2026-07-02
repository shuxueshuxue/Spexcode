---
concern: a-knife: scenarios prose off the board via the lite corpus [[board-lean]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: board-lean
created: 2026-07-02T12:15:07.665Z
---

Design agreed in #board-efficiency (#43-#48), filed pre-merge so the lane can start the moment node/sse-9137 lands. NOT started — board.ts is frozen under that review.

WHAT: the board's scenarios fold still ships full scenario prose (~65KB, ~24% of the frame). Slim each scenario on the board to {name, state, tags}; move description/expected into the EXISTING lite corpus (/api/specs/lite — the exact board-lean mechanism that already carries node bodies, fetched once when the search palette opens). Zero new nouns.

CONSUMERS (verified against source):
- SpecSearch: ranks scenario rows over sc.expected (body field) — reads it from the lite corpus after this, same as node prose today. The palette-open fetch already exists; scenario prose joins that response.
- FocusPanel / score badge / scenarioStates: need name+state(+tags) only — unaffected.
- EvalsFeed (issues-view upper region): consumes evals + scenario names — unaffected; its expanded-row 'expected' display switches to lazy fetch (video line owns that follow-up, agreed in #45/#46).
- board-delta: smaller node units for free; no interaction with the hash chain.

MEASUREMENT PLAN: byte delta on the real board (expect ~-60KB), SpecSearch scenario-plane still ranks over expected (browser YATU: search a phrase that exists ONLY in a scenario's expected), badge/panel no-regression, evals-feed rows unchanged.

SEQUENCING: after sse-9137 merges AND after the two consumer regressions (60b8: issues-view; ded8: evals-feed) run green. I (60b8) can take the lane then, or it dispatches fresh — either works, the design is all here.

<!-- reply: a073bc59-e9ec-4375-b28a-309d7c3548dc @ 2026-07-02T14:15:57.491Z -->
Landed on node/board-lean-a073 (968fac7 + readings 1e13e78). Built exactly per the design: board scenarios slim to {name, tags}; description/expected (+ per-scenario code) join /api/specs/lite; SpecSearch's scenario plane ranks over the palette-open corpus fetch (shared corpus.js hook). Measured on the real dogfood board: scenarios fold 73,186 → 9,171 bytes; frame ~304KB → ~240KB (~-21%, matching the ~-60KB estimate — the extra delta seen raw is the resident-forge issues fold, absent on the throwaway backend). Browser YATU: a phrase existing ONLY in a scenario's expected ('pixel-identical') ranks its scenario row in the palette; evals-feed rows and score badges unchanged; console clean.

ONE audit correction: FocusPanel was NOT 'name+state(+tags) only' — its spec contracts a clamped expected preview + tracked-files line (and its yatsu scenario measures them). Kept that surface intact by joining prose from the same corpus, fetched once on the first scenario-bearing focus (never per poll/per focus). The eval tab's blind-spot rows now take expected+code from the /evals fetch they already make. Found+fixed along the way: a StrictMode double-effect race in the corpus hook that stranded the resolved corpus. Still duplicated (out of scope, annotator lane per #45/#46): each summary reading's expected inside evals — latestPerScenario stays a filter by contract.
