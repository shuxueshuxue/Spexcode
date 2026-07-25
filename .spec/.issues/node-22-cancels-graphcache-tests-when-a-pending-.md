---
concern: Node 22 cancels graphCache tests when a pending top-level board build owns only unref handles
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: graph-cache
created: 2026-07-25T07:35:44.986Z
---

On the repository-pinned Node v22.21.0, graphCache.test.ts is already 100 percent cancelled on main with Promise resolution is still pending but the event loop has already resolved. A graph-cache candidate adding one test to that file therefore adds one cancelled test but introduces no green-to-red transition. The same source and environment complete under Node 24. Fix the test harness or handle ownership so Node 22 keeps the intended completion path alive; do not mask it by changing the project Node pin or deleting the regression. Baseline comparison at main 2f7ca725 and candidate dc61e300 established identical failure strings and per-file profiles.
