# Graph Cache CFAE Closure Audit

> Checkpoint status: **UNPROPOSED / INCONCLUSIVE**. This audit records only
> the two current-anchor product controls that passed and the instrument or
> environment outcomes that prevent the remaining surfaces from closing. It
> contains no raw request bodies, process data, or evidence artifacts.

## Current Anchor

The measured product tree is
`20172b4080e63d450e388da0bc2c9f741c1f6495`
(`b7b2fb2dd0d8e1472927f9dd8ed55f3390e80866`). Local main is
`1938531a7b30bad336994e84a0c7cfc0343cee58` and is an ancestor. The two
current readings are retained by evidence commit `a5feed0d`; their `codeSha`
remains the measured product tree, not that sidecar commit.

## Current PASS Readings

- `graph-cache/session-projection-overtakes-structural-full` passed at
  `20172b40`: route-owned manifest `99424fc4` and TAP `43c0f18e` selected
  1/1. A real stale route-owned full was held, the close deletion arrived
  before release, and release completed without resurrection.
- `graph-stream/failed-refresh-keeps-trigger-attribution` passed at
  `20172b40`: failed-refresh manifest `cdc3afa4` and TAP `14125ee3` selected
  1/1. The failed full retained watcher causes, and the next patrol recovered
  the graph without a second invalidation or `PATROL-REPAIR`.

These are the only fresh product PASS readings filed at this anchor. They do
not establish lifecycle latency, browser summary coherence, demand priority,
or any performance property.

## Surface Outcomes

Surface 2 lifecycle is **instrument-invalid / product-inconclusive /
cleanup-fail**. The launcher inherited a foreign tmux context, group census
hit unrelated `/proc` access, and a Git 2.43 missing-ref assertion was false.
The preserved run is a launcher-isolation red control, not lifecycle evidence.

Surface 4 session-summary coherence is **instrument-invalid /
product-inconclusive / cleanup-pass**. Its two active fixture records were
offline in the real graph-full; session-eval correctly refused eager work, so
the intended cohort trace never began. It is not a browser product failure.

Surface 5 demand priority remains unfiled. A was
**instrument-invalid / product-inconclusive / cleanup-pass** because the shim
did not classify build-limits-prefixed impact calls. B was
**instrument-invalid / product-inconclusive / cleanup-pass**: the natural
503 and queue order were observed, but unresolved sampler errors were not
valid instrument evidence. C did not run a product scenario. Its first
precheck was parser-invalid; corrected preflight-v2 was
**PRE-GATE ENVIRONMENT-INVALID** with raw `e4552cef` and parsed `b2761a96`:
`[r=5 idle=82.6777%, r=9 idle=58.3064%, r=10 idle=64.8316%]`. The second and
third intervals violated `r <= 8`, and the second also violated `idle >= 60%`.
No C fixture, backend, API, SSE, or product run started.

The synthetic scale/plain/era legs, B2, sanitizer, and
`normal-build-memory-platform` remain unmeasured. There is no performance
claim or A/B parity result.

## Retained Older Evidence

Older product readings remain valid only at their named code SHA and stale for
the current product tree: route-owned ordering at `9c487f0`, lifecycle at
`8d4a2003`, rename at `ec7eacca`, dashboard push at `9c487f0`, and
session-summary coherence at `6157b87c`. The graph-scope 8/8 observability
unit is auxiliary regression evidence only.

## Future Gate

Any future closure first syncs then-current main and proves clean ancestry.
Only the still-open current product surfaces need remeasurement: lifecycle
create/propose-close/close, session-summary coherence through a real live
adapter, and demand priority through its natural HTTP rejection seam. Do not
fabricate a route. If that seam cannot be driven, leave it open and keep the
branch unproposed. Disclose remaining stale shared-axis readings rather than
mechanically repeating them.
