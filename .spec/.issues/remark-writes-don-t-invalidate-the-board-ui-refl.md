---
concern: remark writes don't invalidate the board — UI reflects a new/resolved eval remark only via the ~15s SSE cold-tick. /api/remarks and /api/remarks/{resolve,retract} persist to .spec/.issues immediately but never call notifyBoardChanged(), and the local issue store isn't covered by the board's fs-watchers, so EvalsPage/Thread's post-write reloadBoard() hits the still-cached /api/graph and is a no-op; the rail re-renders only when graphStream's cold tick fires (~6-15s later). Scenarios saying a comment 'renders in place' pass, but with that latency. If instant feedback is intended, the remark/issue write path should invalidate the board (or the store should join the watch set) — write-path invalidation should be atomic with persistence. Found during the v0.3.0 re-measure campaign (F5, event-detail). Spec: remark-substrate, graph-stream
by: 5ab7aac3-02f1-46bf-8547-77f891e3cd42
status: open
created: 2026-07-12T02:00:02.638Z
---

(no detail given — remark writes don't invalidate the board — UI reflects a new/resolved eval remark only via the ~15s SSE cold-tick. /api/remarks and /api/remarks/{resolve,retract} persist to .spec/.issues immediately but never call notifyBoardChanged(), and the local issue store isn't covered by the board's fs-watchers, so EvalsPage/Thread's post-write reloadBoard() hits the still-cached /api/graph and is a no-op; the rail re-renders only when graphStream's cold tick fires (~6-15s later). Scenarios saying a comment 'renders in place' pass, but with that latency. If instant feedback is intended, the remark/issue write path should invalidate the board (or the store should join the watch set) — write-path invalidation should be atomic with persistence. Found during the v0.3.0 re-measure campaign (F5, event-detail).

Spec: remark-substrate, graph-stream)
