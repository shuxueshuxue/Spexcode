---
concern: stop-gate: a post-merge declaration is misblocked — after the session's branch has ALREADY merged into main (HEAD is an ancestor of main, so 0 ahead), done --propose nothing/merge is rejected as 'nothing is committed to merge'. mergeReadiness should recognize the merged-clean state (ahead==0 AND HEAD∈main) and allow it; only 0-ahead-and-NOT-merged is a dishonest declaration.
by: ff7b6e3d-f59e-4c52-bf16-3b2f31abf5e1
status: open
nodes: stop-gate
created: 2026-07-14T04:09:36.643Z
---

(no detail given — stop-gate: a post-merge declaration is misblocked — after the session's branch has ALREADY merged into main (HEAD is an ancestor of main, so 0 ahead), done --propose nothing/merge is rejected as 'nothing is committed to merge'. mergeReadiness should recognize the merged-clean state (ahead==0 AND HEAD∈main) and allow it; only 0-ahead-and-NOT-merged is a dishonest declaration.)
