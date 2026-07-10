---
concern: board cache does not invalidate when the resident forge slice warms: on a freshly restarted backend the first board build folds an EMPTY forge slice (cache still fetching), and since board rebuilds are keyed on git/spec changes only, an idle repo serves zero forge issues indefinitely while /api/issues (live merge) already returns them — observed on z-code (7 gitlab issues live on /api/issues, board stuck at 0 until next invalidation). Fix direction: forge-slice arrival should nudge the board cache (or the board's issue fold should read the live merge like /api/issues does).
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: open
nodes: board-cache
created: 2026-07-10T14:24:07.568Z
---

(no detail given — board cache does not invalidate when the resident forge slice warms: on a freshly restarted backend the first board build folds an EMPTY forge slice (cache still fetching), and since board rebuilds are keyed on git/spec changes only, an idle repo serves zero forge issues indefinitely while /api/issues (live merge) already returns them — observed on z-code (7 gitlab issues live on /api/issues, board stuck at 0 until next invalidation). Fix direction: forge-slice arrival should nudge the board cache (or the board's issue fold should read the live merge like /api/issues does).)
