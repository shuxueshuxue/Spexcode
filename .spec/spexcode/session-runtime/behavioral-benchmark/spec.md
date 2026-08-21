---
title: behavioral-benchmark
desc: Real product behavior measurements for weak-instruction and write-oriented Swarm tasks.
code:
  - docs/session-behavior-benchmark.md
related:
  - docs/session-slopcodebench-two-problem.md
  - docs/session-slopcodebench-three-problem.md
  - docs/session-behavior-findings.html
---

# behavioral-benchmark

Behavioral benchmarks measure the user-visible agreement between task result, session topology, protocol delivery,
isolated worktree collection, and process exit. They are not substitutes for unit coverage and must not be used to
justify a fallback that hides an undelivered worker.

The current evidence distinguishes two contracts. A write-oriented isolated worker is delivered only after its commit
reaches the parent workspace. A read-only worker needs an explicit result contract; a no-commit branch must not be
silently treated as collected. Patch-equivalent collection is a conservative receipt: after conflict resolution it
may leave a semantically collected worker in `need_review`, which is a measured projection limitation rather than
permission to write `merged` optimistically. Any change to this boundary requires a real benchmark that fails before
the change and passes after it while preserving protocol message and topology invariants.

Iterative benchmarks keep one durable session across successive specifications while isolating unrelated problems at
the process, storage, repository, snapshot, and evaluator boundaries. A headless turn is successful only when its
provider termination reason denotes completion. In particular, a token-limit termination with an empty assistant
response and no tool effects is an incomplete turn: it must not exit zero or project the session as successfully idle.
The same rule applies when a tool call or provider turn starts but no tool result or assistant completion arrives before
the bounded run is stopped: the durable session must remain visibly incomplete rather than becoming successful idle.
Prompt text is not an isolation boundary, and a retry, fallback, implicit compaction, or fabricated completion receipt
must not be used to hide this state.

The consolidated review artifact in `docs/session-behavior-findings.html` summarizes these measurements and their
evidence boundaries; it is a report view, not a separate runtime contract.
