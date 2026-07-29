# Graph Cache CFAE Closure Audit

> Historical checkpoint. This branch is **UNPROPOSED / INCONCLUSIVE**. The
> synthetic A/B performance result is not verified: it is neither a PASS nor
> a product FAIL. This document contains no raw request bodies, process data,
> or evidence artifacts.

## Scope

The worktree is `node/graph-cache-cfae` at
`1d300dc30eed68ae18c2b408650842f729d5a83b`; local main is
`1938531a7b30bad336994e84a0c7cfc0343cee58`. Main is an ancestor, the
worktree is clean, and the branch is 23 commits ahead.

The final synthetic fixture declared 54 registry worktrees, 30 governed
session records, and 440 specs. `normal-build-memory-platform` remains
unmeasured because there is no actual zcode corpus input. The era scenario is
unrun and unfiled. B2 is prohibited.

## Instrument Attempts

| Attempt | Instrument Pins | Result SHA-256 | Result |
| --- | --- | --- | --- |
| A1 | plain `49e4c128`, preload `82966866`, runtime `7c38bf65` | `d804b0969ee0bfccc9e30139c64d908f22c6bf19f5180d150d4333e033dbd7b7` | Source tar was truncated by `spawnSync` stdout buffering before a listener started. |
| A2 | plain `49e4c128`, preload `82966866`, runtime `7c38bf65` | `7f43f4a2535aa1e8a790278c770fdda006b8d13134bbc6b386b2fead75ea96eb` | Callback-based preload I/O and mutable cleanup identity invalidated settle and cleanup. |
| A3 | plain `49e4c128`, preload `9badae7a`, runtime `5296a091` | `ddefd668541f3849110c41a4efd83cb7bbe1dbc33ac999e196cbabd8745d1778` | Reentrant sampler overlap produced incomplete samples and an instrument-invalid trailer. |
| A4 | plain `72f955d2`, preload `daaa635f`, runtime `5296a091` | `f5228fc07f822c74d60664fd28d37b27ce1c8641f2ffe99c2fe951cdea10c299` | Full route/build diagnostic completed, but post resource gate invalidated the leg. |
| B1 | plain `72f955d2`, preload `daaa635f`, runtime `5296a091` | `cdc7e66b5fcab2df7e273f1355315aa4ff74242cb7f18cfadad4e338464528be` | Candidate-local route/build diagnostic; post resource gate invalidated the leg. The complete policy envelope was not retained. |
| A5 | plain `96d35a13`, preload `daaa635f`, runtime `5296a091` | `66b2b5b7bdef2c6ef23b3bfbb97c49cebd4cbba5f04bdbb80f801b1a88e2abb5` | **PRE-GATE environment-invalid**: authoritative rows r=12/9/12/3; deltas r=9/12/3; idle=62.92/56.42/71.88. Post was skipped, no listener started, and no product samples exist. |

The A4 parent builds (4983/3760/3781/4381 ms) and B1 candidate builds
(5176/3627/4160/3798 ms) are a broad-band diagnostic only. The invalid
resource gates forbid treating them as parity or performance acceptance.

The final instrument fixes serialize the 100 ms target sampler, retain
overlap/drop/flush as hard trailer invariants, use promise-based preload I/O,
and use `{pid, process group, starttime, executable}` cleanup identity. These
mechanics do not turn the invalid runs into product evidence.

## Retained Product Evidence

Each retained reading below is valid only at its named `codeSha` and stale for
current `1d300dc3`; none substitutes for final-current remeasurement.

- `graph-cache/session-projection-overtakes-structural-full` at `9c487f0`:
  active full 17168 ms; session frame 17019 ms before release; release to
  server 53 ms and client 1 ms; no rollback or successor.
- `graph-stream/lifecycle-push-latency` at `8d4a2003`: real create
  persist-to-SSE 7/0 ms; close route deletion before the held full; request
  start to deletion 137.686 ms.
- `graph-stream/rename-nudge` at `ec7eacca`: watcher-disabled real HTTP/SSE
  completed in 28 ms.
- `session-console/dashboard-session-state-push-latency` at `9c487f0`: real
  Chromium persist-to-raw-delta 41/61/48 ms; SSE-to-DOM 28/38/21 ms; data,
  video, and image evidence; the 0 ms red control was nonzero.
- `graph-stream` failed-refresh/registry controls and `graph-cache`
  unchanged-patrol at `9048bbaa`.
- `session-eval/session-summary-coherence` at `6157b87c`: 43/43 Chromium;
  it predates the atomic cohort fix.

The graph-scope 8/8 observability unit is auxiliary regression evidence only.
It does not substitute for product or performance remeasurement.

## Current Branch Evidence

The branch changes these governed paths:

- `.spec/spexcode/spec-cli/graph-delivery/graph-cache/evals.ndjson`
- `.spec/spexcode/spec-cli/graph-delivery/graph-stream/eval.md`
- `.spec/spexcode/spec-cli/graph-delivery/graph-stream/evals.ndjson`
- `.spec/spexcode/spec-eval/session-eval/evals.ndjson`
- `.spec/spexcode/spec-eval/session-eval/spec.md`
- `spec-cli/src/graphStream.api.test.ts`
- `spec-cli/src/graphStream.ts`
- `spec-eval/src/sessioneval.test.ts`
- `spec-eval/src/sessioneval.ts`

`spex session review . --json` reports no main conflict, no proposal, 0 lint
errors, 55 warnings, and an unavailable eval gate. `spex spec lint` reports 0
errors and 57 warnings. `spex eval lint --changed` reports 27 stale scenarios
across four nodes, with no malformed, missing, or coverage-gap finding. No
new reading was filed by this audit.

## Future Gate

When separately authorized, sync the then-current main once and prove the
ancestor/tree-clean state. Remeasure only the directly affected final-current
surfaces: structural-full/session delta ordering; graph-stream create/close
latency; failed-refresh trigger attribution; session-summary coherence through
current Chromium/backend; and demand-priority through a real HTTP integration
seam. Do not fabricate a failure route. If the natural rejection seam cannot
drive that clause, leave it open and keep proposal blocked. Disclose the other
shared-axis stale rows rather than automatically repeating all 27.
