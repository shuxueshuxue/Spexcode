---
concern: graph-lean: cross-worktree overlay 'added' nodes still ship body on /api/graph (plugin-system offender)
by: 8faa1cec-0616-447b-bab6-da9b76d5c4e2
status: open
nodes: graph-lean
created: 2026-07-11T18:51:23.630Z
---

Re-measure of lean-board-detail-and-search-intact at 2ee4b981 (T3 graph-domain rename, node/spec-board-8faa) found ONE body offender on /api/graph: 'plugin-system', an overlay op:'added' node sourced from the sibling worktree config-bc6b (T4 in flight). Identical offender on main's live :8787 board — pre-existing, not a T3 regression. The landed issue 'board-lean 泄漏待查' healed the SAME-worktree untracked-add ghost (verified then: ghost ships WITHOUT body), but a node added in a DIFFERENT worktree's overlay still rides with body — a second code path in the overlay assembly. Either strip body there too, or relax the scenario expected for cross-worktree adds (the landed thread already posed exactly this fork). Fail reading on graph-lean (branch node/spec-board-8faa) anchors the evidence. NOTE: node id refers to the renamed graph-lean (board-lean pre-T3-merge; binding will resolve once T3 merges).
