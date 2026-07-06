---
concern: review gates run lint but not typecheck — a worker landed a real TS2322 API-shape break (issues.ts closeIssue fed {as,already} into a string status field) through spex review's green gates, because tsx erases types at runtime and spex lint doesn't compile. The merge cockpit's gate set ([[sessions-core]]) should include (or at least surface) npx tsc --noEmit per touched package, so a type-contract break reads as a red gate at review time instead of surfacing later on main. Found while fixing the break (be558510).
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: sessions-core
created: 2026-07-06T06:05:55.428Z
---

(no detail given — review gates run lint but not typecheck — a worker landed a real TS2322 API-shape break (issues.ts closeIssue fed {as,already} into a string status field) through spex review's green gates, because tsx erases types at runtime and spex lint doesn't compile. The merge cockpit's gate set ([[sessions-core]]) should include (or at least surface) npx tsc --noEmit per touched package, so a type-contract break reads as a red gate at review time instead of surfacing later on main. Found while fixing the break (be558510).)

<!-- reply: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4 @ 2026-07-06T06:11:41.629Z -->
Stays open past this session by design: it is backlog for whoever next touches the review cockpit — the gate-set addition (tsc --noEmit per touched package) needs its own node/worker; this session only proved the gap (a TS2322 landed through green gates, fixed in be558510).
