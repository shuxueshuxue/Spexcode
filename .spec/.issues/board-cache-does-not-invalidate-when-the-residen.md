---
concern: board cache does not invalidate when the resident forge slice warms: on a freshly restarted backend the first board build folds an EMPTY forge slice (cache still fetching), and since board rebuilds are keyed on git/spec changes only, an idle repo serves zero forge issues indefinitely while /api/issues (live merge) already returns them — observed on z-code (7 gitlab issues live on /api/issues, board stuck at 0 until next invalidation). Fix direction: forge-slice arrival should nudge the board cache (or the board's issue fold should read the live merge like /api/issues does).
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: landed
nodes: graph-cache
created: 2026-07-10T14:24:07.568Z
---

(no detail given — board cache does not invalidate when the resident forge slice warms: on a freshly restarted backend the first board build folds an EMPTY forge slice (cache still fetching), and since board rebuilds are keyed on git/spec changes only, an idle repo serves zero forge issues indefinitely while /api/issues (live merge) already returns them — observed on z-code (7 gitlab issues live on /api/issues, board stuck at 0 until next invalidation). Fix direction: forge-slice arrival should nudge the board cache (or the board's issue fold should read the live merge like /api/issues does).)

<!-- reply: eb0024eb-a36a-4d4d-a622-d042288e74c4 @ 2026-07-10T14:25:30.396Z -->
Stays open past this session: filed at residency close as a verified field finding (z-code, 2026-07-10) with fix direction; the repair is future work for whoever picks up board-cache next. The live surface (/api/issues) is unaffected, so severity is cosmetic-lag, not broken-function.

<!-- reply: a20319eb-3542-400b-b35d-31b915587c7d @ 2026-07-12T07:14:02.352Z -->
Adjacent-but-distinct note: node/remark-substrate-a203 (7a2f0ae0) gives the ISSUE/REMARK write routes an atomic notifyBoardChanged('full') nudge — write-path invalidation is fixed. THIS thread's forge-slice warm-up case remains open (the background reconcile still nudges nothing when the slice arrives); the landed nudge is the natural precedent — the reconcile could fire the same notify when its slice content changes.

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:25:37.999Z -->
已修:buildBoard 每次构建折入活的 residentForgeState()(graph.ts:118),每次读触发后台刷新(resident.ts:46);board 级 issuesStamp 携带 forge 新鲜度,slice 变动即触发 delta 广播(graph.ts:125-130);cold-tick patrol 每 15s FULL 失效重建,注释点名 forge issue refresh 场景(graphStream.ts:232-244)。空 forge slice 最多存活一个 patrol 周期。
