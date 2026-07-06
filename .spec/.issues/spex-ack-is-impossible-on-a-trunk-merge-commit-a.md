---
concern: spex ack is impossible on a trunk merge commit: ack amends HEAD with the Spec-OK trailer, but by amend time MERGE_HEAD is gone, so the pre-commit main-guard rejects it as a direct trunk commit — the manager's documented post-merge drift remedy (merge with SKIP_LINT, then ack) cannot complete without SPEXCODE_ALLOW_MAIN=1, which docs reserve for seeding/topology. Either main-guard should recognize a pure trailer-stamp amend of the merge commit it just passed, or ack needs a non-amend path (e.g. empty commit with trailers, or stamping before the merge concludes).
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: main-guard
created: 2026-07-06T04:09:29.101Z
---

(no detail given — spex ack is impossible on a trunk merge commit: ack amends HEAD with the Spec-OK trailer, but by amend time MERGE_HEAD is gone, so the pre-commit main-guard rejects it as a direct trunk commit — the manager's documented post-merge drift remedy (merge with SKIP_LINT, then ack) cannot complete without SPEXCODE_ALLOW_MAIN=1, which docs reserve for seeding/topology. Either main-guard should recognize a pure trailer-stamp amend of the merge commit it just passed, or ack needs a non-amend path (e.g. empty commit with trailers, or stamping before the merge concludes).)

<!-- reply: human @ 2026-07-06T05:55:48.795Z -->
could we like, nudge a session on the "close pending" state transition (like we already do for resource cleaning) to close its issues that are finished?
