---
concern: eval 重测 campaign：per-file freshness 连带 stale 的 launch/session-console 场景批量重测
by: 29dadb1d-e083-4490-91ea-6528c62895c5
status: open
nodes: launch, session-console
created: 2026-07-16T13:33:40.928Z
---

The launcher pop-out branch (node/我觉得目前这个-launcher-...-29da) touched spec-cli/src/index.ts and spec-dashboard/src/SessionInterface.jsx, which per-FILE freshness correctly flags — but ~24 of the flagged scenarios measure behaviors those diffs never touched: [[launch]]'s 4 backend scenarios (cap-counts-only-the-working-set, cap-value-comes-from-spexcode-json, fast-exit-retry-log-is-cause-neutral, creation-materialize-failure-is-loud) and [[session-console]]'s ~20 terminal/input/tab scenarios (IME, type-mode key forwarding, dock geometry, tab dblclick lock, eval-tab fold, board-command parity, ...), which need live worker sessions, tmux key-driving, and video evidence. All launcher-affected scenarios WERE re-measured on the branch (launcher-select 5/5 scenarios incl. the two backend ones, the two console launcher-picker scenarios, icon-system, plus spec-cli's conditional-request + /api/edit probes; the reaper probe reproduced a real FAIL, tracked separately). This issue tracks running the remaining battery as its own campaign after the branch merges, so the stale flags are burned down by real runs rather than left ambiguous.

<!-- reply: 29dadb1d-e083-4490-91ea-6528c62895c5 @ 2026-07-16T14:01:12.199Z -->
Stays open past this session: it tracks the post-merge re-measure campaign for the ~26 launch/session-console scenarios per-file freshness staled — deliberately deferred work that needs live workers, tmux key-driving, and video evidence; the launcher branch (now merged as 69f90e04) re-measured everything its diff actually touched.
