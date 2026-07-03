---
concern: drain guard: @new on a LANDED thread spawns duplicate work [[mentions]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: mentions
created: 2026-07-03T00:57:57.595Z
---

Live incident (2026-07-03): after eval-comments landed (ef22fc7) someone @new'd its design thread (likely testing the new assign UI). The dispatch dutifully spawned a worker that RE-IMPLEMENTED the whole landed design and got as far as a conflicted merge on main before a reviewer stop order — abort + increment audit found strictly zero new value. A twin spawn on the forge-replies thread (c3f8) burned a full re-measure run the same way. Gap: newWorkerPrompt carries the thread text but NOT its status — a fresh worker has no cue that the thread is resolved. Fix candidates (pick at implementation): ① dispatch-side — @new on a non-open thread requires confirmation / warns in the outcome line; ② prompt-side — newWorkerPrompt embeds the thread STATUS + 'if resolved/landed: verify on main first, and if satisfied propose close instead of re-implementing'; ③ both (cheap). Either way the guard is one rule in mentions dispatch, no per-thread special-casing. Incident evidence: sessions 1b7b9e38 (stopped, closed clean, main verified intact) + c3f86a1a.
