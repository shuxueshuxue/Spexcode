---
title: adopter-a fleet cleanup
hue: 34
desc: A per-record, evidence-backed execution ledger for retiring the MBP adopter-a session fleet without losing externally referenced or unmerged work.
code:
  - reports/adopter-a-session-cleanup-ledger-2026-07-27.md
---

# adopter-a-fleet-cleanup

## raw source

The MBP adopter-a fleet may be cleaned only from live ownership evidence. Archive and lifecycle labels do not
prove that a session is offline, unreferenced, or safe to destroy. Every candidate therefore needs an explicit
decision, evidence, owner, and handoff or closure gate before cleanup begins.

## expanded spec

The execution ledger records the exact live store, branch/worktree state, runtime references, current GitLab
deep links, CR reports, and agent task content observed for each archived or close-pending session. It classifies
each candidate as KEEP, SALVAGE-THEN-CLOSE, or CLOSE-AFTER-P0 and keeps unreadable or unowned runtime residue
outside ordinary cleanup.

The ledger serves [[host-resource-budget]]: process and thread ownership must be re-probed immediately before
each mutation, shared control-plane resources remain protected, and no process command or stale status grants
reclaim authority. A salvage handoff is complete only after the receiving owner acknowledges the exact commits,
dirty files, and proof artifacts. The ordered cleanup becomes executable only after the archive-to-offline P0
is deployed and its preconditions are re-verified against the current fleet.
