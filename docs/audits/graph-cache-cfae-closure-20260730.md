# Graph Cache CFAE Closure Audit

> Checkpoint status: **FINAL-CURRENT PRODUCT EVIDENCE COMPLETE / READY FOR
> PROPOSAL**. This audit names the measured product tree and the five product
> surfaces that were actually rerun. It makes no synthetic scale, memory, or
> general performance claim.

## Measured Anchors

The backend and projection product tree measured by the five-surface run is
`47852c531790a29bf508bf0117e4f7a4bd394288`
(`958209e2b8f4e046b537bdfad836a662905a9bec`). It contains main
`5bd345cb9a7bb910d262ce7e7f1d3e3cf0229acf` and product commit
`b4a8cc728814d6cbd457b3409cb42d640fb036eb`. The worktree was clean and main
was an ancestor before every final manifest was repinned. Four readings below
use `47852c53` as `codeSha`.

Main then advanced through dashboard session-toolbar work, including
`SessionInterface.jsx`. The clean combined tree
`e9ba80fe0694d397f632a411dffb8db917cf2e7e`
(`267f45ed8d0da762a7b6f46944a20da8f9000320`) contains main
`faad7355c24bc6f88e36a2f3b44f02df100e77d3`. That change did not stale the
four backend readings, but it did stale browser coherence, so coherence was
rerun and its replacement reading uses `e9ba80fe` as `codeSha`. Later sidecar
commits do not pretend to be either measured tree.

## Product Correction

The pre-fix Demand-v4 run at `07a82992` was a real product red, not an
instrument timeout: the selected scoped Evals request failed naturally with
HTTP 503 / git status 76, then the same selected worktree ran a second summary
flight at the same generation and became ready. Its retained result is
`8f4bd5ebe100934ec5b94fd979487fb3b205930c3c4a0e096bb7edc86099b813`
and its ledger is
`f32a414106fa6c2c13da26d11b7081d0521f73a13f49c4c8f913223b0070fce7`.

The fix records a cancelled eager generation only when demand actually
supersedes that exact queued generation. Rejected demand leaves that
generation suppressed through repeated snapshots; invalidation clears the
marker and permits exactly one next-generation eager build. A summary already
running is still joined rather than cancelled. The focused unit makes all
three distinctions explicit.

## Final Product Readings

- `graph-cache/session-projection-overtakes-structural-full`: PASS. The exact
  API control selected 1/1; the real close deletion arrived before the held
  route-owned full was released and did not resurrect. TAP:
  `c31b3ad1fca8c67f2c5ec0249a77498a041d9b693bb8ea491290a24771c1d4ad`.
- `graph-stream/lifecycle-push-latency`: PASS. A real create reached online
  SSE in 133.128 ms, real `session done --propose close` reached awaiting in
  51.123 ms, and confirmed filesystem absence reached the delete delta in
  45 ms. Product passed, instrument was valid, and cleanup passed. Result:
  `b501a04333a2f27e068f306b511611df9229a2a6de0795b7d81d89e7c60a6591`.
- `graph-stream/failed-refresh-keeps-trigger-attribution`: PASS. The exact
  watchdog/patrol control selected 1/1; recovery retained its trigger causes
  without `PATROL-REPAIR`. TAP:
  `ee06a5d00b23eac66013e6ccf835e24046ec49620d87738ecca5cf8e43661072`.
- `session-eval/session-summary-coherence`: PASS on the post-main-sync tree.
  A real candidate backend,
  Vite, and Chromium proved cold cohort publication, A->B->A with zero eval
  reads, updating with exact last-known value before ready, deadman disconnect
  and new-epoch reconnect, scoped Evals parity, and warm Back. Product passed,
  instrument was valid, and both backend generations, sessions, worktrees,
  tmux sockets, ports, browser, and fixture cleaned up. Result:
  `6c10b53192abe0231acb0c4be52a66ef8a9c90fe2df9b26b95e00e1af08948a5`;
  raw timeline `f034dbed6e62cbf9965a11435ab85990f972d998dd047c53fb00803262d81c5a`;
  image `f78986b6e7cec4261fd7c93d740a3073e297d2c79adced900afe5d460c3809e1`;
  video `04aec2a44e325e62dda565e4be5725cc49f581d7d83e4d7fa395debf9b9ccfb0`.
- `session-eval/demand-priority-under-delta-backlog`: PASS. With 30 real
  online `pi-headless` rows and concurrency one, the ledger was current job,
  exactly one selected status-76 rejection / HTTP 503, then the unrelated
  suffix. All 29 ordinary rows settled while selected remained loading at its
  original generation; no second selected flight occurred. Product passed,
  instrument was valid, and backend group, port, SSE, and fixture cleaned up.
  Result:
  `639a5e0343bddeabcf6d0c5e8bc19d41f9f44f3e8c7757074d3016649cce4894`;
  timeline `0d150827f5bc5913f4a683edb0d1a321243fa481aa2903f7e65a69d919f32c32`;
  SSE `a54002ab5a362c4d6fd60cf00138fea73e17e45ee690b2ea00cea5e24e58d4ec`;
  selected 503 body
  `ab8816cd65221800b45b8143e56dae0ab10d310389187d01ed37543795114ad8`.

## Validation Gates

At the post-main-sync combined head, the rejected-demand focused regression, the
`spec-eval` typecheck, both exact `graphStream.api.test.ts` controls, and
`spex spec lint` passed. The two API controls were also rerun as the product
readings above. Coherence then passed its complete Chromium run on that same
combined tree. Eval lint remains advisory: only the five scenarios measured
here are closed; 22 unrelated shared-axis stale scenarios remain disclosed
and were not mechanically relabelled.

## Execution Incidents

The final root was also addressed by the cfae owner while this closure owner
was taking over. A duplicate lifecycle invocation reached a root guard and
overwrote its small result envelope, so lifecycle was rerun once solely to
recover the destroyed evidence; the guarded duplicate started no product
process. Coherence and Demand each already had an owner process when a second
invocation reached the same guard. Those second invocations stopped before
fixture creation; the first processes completed and atomically wrote the PASS
results named above. Guard-failure run logs are audit incidents, not product
evidence. Final targeted census found no owned product process or fixture.

## Explicitly Open

The synthetic plain A/B, scale/era, sanitizer, Linux adopter-scale, and real
zcode memory legs did not produce an accepted final-current reading. This
checkpoint therefore claims neither a general graph/dashboard performance
improvement nor a memory/CPU slope result. Earlier algorithm and cold-board
readings remain separate evidence at their own code SHAs.

## Hindsight

The durable invariant belongs in `SessionEvalProjectionCache`, not in a YATU
shim: cancelling queued work for a demand is a per-generation state transition.
A demand failure may reject its waiter, but repeated snapshots cannot silently
recreate the cancelled generation. Only an actual generation advance releases
that suppression. The permanent focused regression is the cheap gate; the
natural HTTP backlog run proves the same rule at product altitude.
