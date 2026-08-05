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

<!-- reply: 9be33950-7166-40fd-8d62-5d3a3390cdf7 @ 2026-08-05T10:21:49.844Z -->
## Attributed and half-fixed (2026-08-05)

The per-phase attribution asked for above is done, by measurement at three descending levels on the live mbp
deployment. The answer is that **the dominant cost was not in the graph build at all.**

1. macOS `sample` on the server process during a cold build: the time is synchronous-fs on the main thread
   (3336 samples in `open`), not git. 864 samples sat in `v8::internal::Isolate::CaptureAndSetErrorStack` —
   the stack-capture V8 does for every `ENOENT` a `readFileSync` throws.
2. A `NODE_OPTIONS --require` tally that counts every `fs` call by path shape: **3.67M calls per build**, of
   which `sessions/<UUID>/session.json` was **94%** (1.77M hits + 1.91M misses).
3. A 1-in-500 sampled stack capture on those calls: **95% came from `reconcileTurnFailureObservers`** — the
   turn-failure supervisor's 1Hz timer, a background loop, not the request path.

`readAliasedRecordEntry` treated one absence as one question. On a direct-read miss it scanned and JSON-parsed
the WHOLE store looking for a record whose `harness_session_id` equals the id. But absence splits in two: an id
that owns a store DIRECTORY is already one of ours (the sentinel-only self-launched shape) and its emptiness is
a settled fact; only an id owning no directory can be some record's `harness_session_id`. With 339 session dirs
of which 176 are record-less, the collapsed rule cost `339 + 176x339 = 60,003` synchronous read+parse per
second, permanently. The event loop was saturated and every request queued behind it — the board build included.

Fixed in `1b6164c12` by refining the rule at the one seam (`layout.ts readAliasedRecordEntry` + its shell twin
`hp_store_dir`), not by a caller-specific bypass. Per-lookup cost goes from O(N) reads to one directory check.
It is also a correctness fix: an unrelated record whose harness id equalled a live session's name really did
answer under that name (proved by the fail reading — old code returned `ok` where the fix returns `absent`).

### Product-level before/after, same box, same store, cold after a full backend restart

| | cold `/api/graph` |
| --- | --- |
| before (f91f362c0) | 30.9s · 43.0s · 25.7s — mean **33s**, spread 17s |
| after (1b6164c12) | 15.39s · 15.03s · 14.97s — mean **15.1s**, spread 0.4s |

Warm reads are 0.09-0.11s either way. Response size is unchanged (669677 bytes). The variance collapse is the
tell that the background saturation is gone: the build no longer competes with a pegged event loop.

### Still open — this issue stays open

15.1s is still **10x over the 1500ms budget**. A `sample` of a cold build on the FIXED code shows the remainder
is a different cost centre: `__open_nocancel` 983, `__getdirentries64` 819, `__open` 487, `stat` 359 — the
`.spec` tree walk (417 nodes at zcode scale) plus git spawns, i.e. the graph build's own reads. Idle CPU of the
server process is now ~0.7% for the port-holding child; the residual work of the supervisor loop is 339
reads/second, which is still O(store size) per second and will grow, but at 15s of build time it is noise.

Next attribution should target the `.spec` tree read and the per-node git fanout. Same rule as before: no
special-case bypass, and no claim of a fix without a cold product measurement to match this table.
