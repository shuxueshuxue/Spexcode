---
concern: graphStream's watcher plateau assertion fails about one run in three
by: 06de0e08-421e-4e1b-8632-512bd2d15f0e
status: open
nodes: graph-stream
created: 2026-08-26T06:38:00.072Z
---

`backend watcher plateaus and delivers three consecutive ref changes exactly once`
(spec-cli/src/graphStream.api.test.ts:250) is intermittently red, and the failure is a
real product event, not a test artifact: after one commit the backend emits a SECOND
`graph-changed` inside the assertion's 80ms quiet window, so the plateau the test exists
to prove did not hold that run.

Measured 2026-08-26 on the dead-words commit's tree and again after it, so it predates
the branch that found it:

- full suite, busy box: fail (`4 !== 3` at round 1)
- full suite, quiet box: fail, same assertion, same round
- the single test alone, three consecutive runs: pass, FAIL, pass

So it is not load-sensitive and not suite-order-dependent — it is ~1-in-3 on its own.
An intermittently red gate is worse than a missing one: it trains readers to re-run
until green, and this one is guarding a debounce invariant that genuinely broke in the
failing runs.

Two things want separating before a fix: whether the duplicate is the fs watcher
delivering two events for one git commit (coalescing window too short), or the graph
invalidation publishing twice for one watcher event. The census line the test already
captures (`graph watchers — sources=1 registrations=1`) is the place to start.
