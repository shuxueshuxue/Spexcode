---
concern: board cache does not invalidate when the resident forge slice warms: on a freshly restarted backend the first board build folds an EMPTY forge slice (cache still fetching), and since board rebuilds are keyed on git/spec changes only, an idle repo serves zero forge issues indefinitely while /api/issues (live merge) already returns them — observed on z-code (7 gitlab issues live on /api/issues, board stuck at 0 until next invalidation). Fix direction: forge-slice arrival should nudge the board cache (or the board's issue fold should read the live merge like /api/issues does).
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: open
nodes: graph-cache
created: 2026-07-10T14:24:07.568Z
---

(no detail given — board cache does not invalidate when the resident forge slice warms: on a freshly restarted backend the first board build folds an EMPTY forge slice (cache still fetching), and since board rebuilds are keyed on git/spec changes only, an idle repo serves zero forge issues indefinitely while /api/issues (live merge) already returns them — observed on z-code (7 gitlab issues live on /api/issues, board stuck at 0 until next invalidation). Fix direction: forge-slice arrival should nudge the board cache (or the board's issue fold should read the live merge like /api/issues does).)

<!-- reply: eb0024eb-a36a-4d4d-a622-d042288e74c4 @ 2026-07-10T14:25:30.396Z -->
Stays open past this session: filed at residency close as a verified field finding (z-code, 2026-07-10) with fix direction; the repair is future work for whoever picks up board-cache next. The live surface (/api/issues) is unaffected, so severity is cosmetic-lag, not broken-function.
