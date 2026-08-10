---
concern: base checkout .spec created after graph cache warm-up stays fresh-empty without delta patrol
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: graph-stream
created: 2026-08-10T11:14:35.553Z
---

Spec: graph-stream

Reproduced on current main 1fb574909 in three disposable empty Git projects, each through the real spex serve api command, isolated SPEXCODE_HOME/tmux/port, and the actual Hono generation PID from /api/instance. Each first read /api/graph as fresh with zero nodes, then created a valid .spec/repro-node/spec.md while the service stayed up.

No SSE and plain /api/graph/stream both returned HTTP 200 with x-spexcode-graph fresh and zero nodes in every 1s sample through about 38.8s. Delta /api/graph/stream?mode=delta surfaced the node only after 14.923s in the stream and 15.625s in graph polling, with a PATROL-REPAIR log naming node:repro-node and nodes#order. All actual generations held six watchers; this is not an ENOSPC or zero-watcher incident.

The graph revision reads the base checkout .spec, but graphStream observes only session store, refs, worktree registry, and live governed linked worktrees. Plain polling trusts the clean cache and never validates the revision. This breaks the normal empty-project path where a shared worker creates .spec and a polling SpecMap must show it.

Bounded repair: add one stable base-checkout observation that detects .spec creation, deletion, and edits without per-node registration; preserve the existing root-count watcher budget. Add a same-surface fail to pass test for no SSE and plain SSE, while delta patrol remains a documented blind-watcher repair rather than primary freshness.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T11:50:01.216Z -->
Spec: graph-stream

Resolved on main at dd813c9d4. The graph service now observes repoRoot(), the exact served root graphCache revisions, through the existing canonical TreeWatcherRegistry mechanism. This covers an initially absent .spec directory and ordinary create/delete events without a delta subscriber, restart, polling exception, or demo-specific branch.

Post-merge proof on main: focused real backend API controls passed for both an empty base project and an unrecorded linked-worktree root (2/2). Each warms ordinary HTTP /api/graph to fresh/0, creates the first uncommitted .spec node without SSE or restart, converges through root events, then deletes it and returns to fresh/0 while watcher census returns to the warm plateau. The committed real supervisor reading records ordinary HTTP visibility in 347ms and deletion back to fresh/0 in 347ms, with the owned service and fixture released.
