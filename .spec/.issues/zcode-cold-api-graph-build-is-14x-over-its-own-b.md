---
concern: zcode cold /api/graph build is 14x over its own budget after the drift-count fix
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: open
nodes: graph-cache
created: 2026-08-05T09:11:12.557Z
---

(no detail given — zcode cold /api/graph build is 14x over its own budget after the drift-count fix)

## Measured (2026-08-05, mbp zcode deployment, toolchain f91f362c0)

The backend's own instrumentation, from the `zcode-backend` tmux pane immediately after a full restart:

    spec-cli: /api/graph build took 21838ms (budget 1500ms) — full path is slow

Independent product-surface timings against the real backend on `:8787`:

| read | old code, WARM (45min up) | new code, COLD (post-restart) | new code, WARM |
| --- | --- | --- | --- |
| `/api/graph` | 1004ms | **16317ms** | 385ms |
| `/api/evals` | 587ms | 3837ms | — |

Payload is byte-identical across all three `/api/graph` reads (675896 bytes), so the graph CONTENT is unchanged
by the drift-count work — this is purely build cost.

## What this is NOT

It is not the per-pair drift count. That defect is fixed and delivered here (`unionTopology` present in the
npm-global install this backend execs, `behindCount` gone): 1750 git children / 15845ms became 3 children /
219ms on a 437-anchor scope, measured by a PATH-argv census. Whatever that contributed to zcode's cold board,
it is not what remains.

## What is unresolved

The dominant remaining cost is unidentified. The deployment's own launcher records the standing suspicion —
this host "walks ~110 session worktrees inside a 185-worktree repo", which is why it carries
`SPEXCODE_BOARD_TIMEOUT_MS=180000` and `SPEXCODE_BOARD_BUILD_TIMEOUT_MS=600000` instead of the 20s default.
A cold build 14x over the 1500ms budget is what makes the console feel dead on first load, and the override
only hides the 503 — it does not make the path fast.

Next step is a per-phase attribution of the cold build (worktree walk vs graph projection vs eval freshness),
not another guess. Do not add a special-case bypass for the worktree count; the budget log already says the
FULL path is slow, so the general mechanism is what needs the optimization.
