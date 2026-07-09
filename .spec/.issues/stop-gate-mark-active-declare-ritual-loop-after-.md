---
concern: stop-gate/mark-active declare ritual loop: after park/ask, ANY same-turn tool call (even a voice line or a background-task read) flips the session back to active, so the next stop re-blocks demanding a fresh declaration — heavy multi-agent sessions report 15+ park→blocked→re-park cycles, and the block message repeats full-text each time. Field report: gugu-promo coordinator (~15 workers, one night); the resident engineer session reproduces it every single turn. Design wanted: a declaration grace for read-only/output-type calls in the same turn, or declaration-sticky-until-mutating-call; plus a one-line repeat message after the first full-text block.
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: open
nodes: stop-gate
created: 2026-07-09T23:19:53.225Z
---

(no detail given — stop-gate/mark-active declare ritual loop: after park/ask, ANY same-turn tool call (even a voice line or a background-task read) flips the session back to active, so the next stop re-blocks demanding a fresh declaration — heavy multi-agent sessions report 15+ park→blocked→re-park cycles, and the block message repeats full-text each time. Field report: gugu-promo coordinator (~15 workers, one night); the resident engineer session reproduces it every single turn. Design wanted: a declaration grace for read-only/output-type calls in the same turn, or declaration-sticky-until-mutating-call; plus a one-line repeat message after the first full-text block.)
