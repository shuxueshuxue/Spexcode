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
