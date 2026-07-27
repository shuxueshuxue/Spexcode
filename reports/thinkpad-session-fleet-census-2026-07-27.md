# ThinkPad SpexCode session-fleet cleanup census

Snapshot: `2026-07-27T09:21:22.668Z` (`spex session ls --all --json` and
`spex session resources --json`), project root `/home/jeffry/spexcode`, current `main`
`b5fbe0c1e9c419544dd33d492504219dc36a5363`.

This is a read-only execution queue, not authorization to mutate the fleet. No session was stopped, closed,
archived, resumed, dispatched, or created by this lane. The initial snapshot contained 37 records: 15 archived
rows, 16 non-archived direct children of parent `58195f32-61b8-4e69-9b91-b41fc2594501`, the census session
`fc3c7cee-b33f-42cc-b361-16b3599adc1e`, three protected records (`9f835e9e`, `c9add95b`, `fe9cbbfa`), and
one unrelated top-level active row (`9a408324`). A later read-only refresh contains 38 records because an
unrelated top-level UI row `25e7fe87-070a-4a66-8f48-ba7597238d1a` appeared; the target counts remain 15
archived and 16 direct children. This lane did not create that row.

## Decision rules

- **KEEP** means an active/protected/runtime-owned row, a human decision is still required, or an external
  reference/unfinished owner has not been handed off.
- **CLOSE-AFTER-ARCHIVE-FIX** means the branch is clean and has no unique undelivered work; close remains
  blocked until the archive-to-offline fix and a fresh exact-owner probe pass.
- **SALVAGE-FIRST** means a receiving owner must acknowledge the exact commits, dirty/diff paths, and proof
  artifacts before the row can enter the close queue.

Archive and lifecycle labels are not ownership evidence. `ahead/dirty/base` below comes from
`spex session review --json` plus `git merge-base main HEAD`; `diff` is the review diff-entry count. Every
candidate worktree reported zero dirty non-runtime files. A runtime value of `thread=<id> record-only` means
the session record has a Codex thread id but the live adapter reported no loaded reference at this snapshot;
`loaded/<turn>` is protective and cannot be closed through a session verb.

## KEEP

| id | state / proposal | ahead / dirty / base | diff / runtime ownership | lineage and reference reason |
| --- | --- | ---: | --- | --- |
| `206ab57c-2906-48c3-8084-e9eca97eb478` | archived, parked, **offline** / none | 1 / 0 / `3bf641ed` | 0; manager exact-stopped tmux and Claude PID `1920147`; record/worktree/branch preserved | Parent of `9a1eb40b`; note carries the CR dashboard handoff plus `!1657`, `!1658`, `http://10.253.209.97:5173`, and `http://100.99.97.58:5173`. Keep until the external dashboard/W23 handoff is acknowledged. Its only commit `0dca7999` is patch-equivalent to main; the runtime is gone but the owner and child lineage remain. |
| `c3579cc6-b90e-400b-b993-becb960aaff2` | archived, asking, offline / none | 0 / 0 / `934bf7c5` | 0; thread `019f9e6f-de86-7e01-806c-c640fc8b7eed`, record-only/no loaded ref | Human decision is pending on Mac mini proxy configuration and possible shared app-server restart; prompt references `http://64.83.11.237:18080/responses`. Do not discard an asking record. |
| `6c4eea5d-eaec-4f07-87f2-5e19feabef73` | working, online / none | 0 / 0 / `2f1b1128` | 0; thread `019fa1c7-abe7-72f3-83eb-e82acf6b5b1f`, record-only/no loaded ref | Final canonical-writer lineage. The manager reported `dirtyNonRuntime=13` before the exact shell removal; the latest `session review` and direct `git status` both read `dirtyNonRuntime=0`, `ahead=0`, and `diff=[]`. Keep the record/worktree/branch until that discrepancy is re-probed after the stale online projection is repaired. |
| `ba040720-374f-49df-bc73-904123f12a64` | close-pending, offline / close | 0 / 0 / `75dedcb7` | 0; thread `019fa29a-de6d-7a11-aff0-87b21e6108fc`, **loaded/idle**, protective | Product landed on main as `b5fbe0c1`, but the exact Codex thread remains loaded in the shared app-server. The host-resource stop/close guard must see that reference released before this row can move. |
| `c9add95b-02f6-466c-a665-24cea11c8f93` | protected working, online / none | not inspected by git per user guard | not inspected; exact thread `019f9e98-379a-7210-aa8a-e6f54a123084`, **loaded/active**, protective | Explicitly protected by the request. No cleanup action or worktree traversal. |
| `fe9cbbfa-f987-4b01-8b7c-f569d49e966a` | protected working, online / none | not inspected by git per user guard | exact thread `019fa283-fedd-7b30-986e-973e4696ce55`, **loaded/active**, protective | Explicitly protected by the request. No cleanup action or worktree traversal. |
| `9f835e9e-52d6-405f-9035-005d321c8ba2` | protected asking, online / none | not in the target population | exact thread `019f88ca-c003-75b2-8586-4efba2dfce8a`, **loaded/idle**, protective | Explicitly protected by the request and top-level (not a child of `58195f32`). No cleanup action. |

## SALVAGE-FIRST

| id | state / proposal | ahead / dirty / base | diff / runtime ownership | exact work, lineage, and handoff gate |
| --- | --- | ---: | --- | --- |
| `9a1eb40b-b9cc-4e12-a89d-fe4c8fb370ad` | archived, parked, online / none | 0 / 0 / `62d7522b` | 0; manager exact-stopped tmux; headless record remains addressable online; worktree/branch preserved | Child of `206ab57c`; external MBP z-code W23 lane, with GitLab context and a remote product branch not represented by local Spex commits. Parent note says replay and real YATU are still pending. Receiving owner must acknowledge the remote commits and evidence before close; archive projection fix is still required to make the preserved headless record offline. |
| `dd69b378-3f90-4cc3-9e20-ebe9d0ae1b1b` | working, online / none | 6 / 0 / `6b70a7a8` | 9; thread `019fa13c-06b6-7b31-a1a5-ce8afeed055b`, record-only/no loaded ref | **Manager reclassified SALVAGE-FIRST / superseded canonical-writer lineage.** Its exact zero-child tmux shell was removed; the public API still projects working/online. Six commits are patch-equivalent to main, but the record/worktree/branch must remain until the superseded lineage is acknowledged and the stale projection is corrected. |
| `484a29ac-8241-4cb3-9778-2b85b73964ae` | archived, done / nothing | 18 / 0 / `4c7d2dfa` | 17 diff entries; thread `019f9d76-27bd-70f1-98ae-7d1705380531`, record-only/no loaded ref | **KEEP/SALVAGE-FIRST.** Unique session-console latency implementation/evidence remains branch-only; `conflictsWithMain=true`. Unique commits include `078b7d18`, `b2044ab6`, `1db4348a`, `b72d911b`, `d0c6e456`, `9ca9574b`, `e5d4842f`, `23398f11`, `f3e9b8f9`, `14ef974e`, `b38bc892`, `a9775c01`, `42454e09`, `778c80eb`, plus three merge commits and `ca11c814` (Spec-OK). Preserve the code/spec/eval/test files and obtain an acknowledged replay-or-supersede decision. |
| `4132dcaf-5a1a-4640-9c34-51669ae577ac` | working, online / none | 15 / 0 / `9ec125a6` | 26 diff entries; thread `019fa159-8d4e-7e13-b1cb-49366ddf1dba`, record-only/no loaded ref | **Archive predecessor retained until `fe9cbbfa` lands.** Its exact zero-child tmux shell was removed; the public API still projects working/online. It is 50 commits behind main and all 15 commits are branch-only (`72d17654`, `3feef837`, `886d396b`, `f203921b`, `34edc7ab`, `7b1545a8`, `cb4b99dc`, `beb3f9e8`, `af4c2b27`, `a4f15591`, `8e136545`, `8ee61e8a`, `ee454434`). Child/successor `fbf4770c` has replayed the chain, but current-main B is still unfiled. Preserve this branch/worktree/record for audit until the protected successor lands and acknowledges it. |
| `6ca5e599-41fe-4704-b8af-c6d2712a6a07` | review, online / merge | 1 / 0 / `46252ab5` | 1 diff entry; thread `019fa189-325b-7620-afb7-046efdaa310d`, record-only/no loaded ref | Unique commit `422a2369` closes canonical-writer evidence; review says merge and `conflictsWithMain=true`. Child `6c4eea5d` is actively correcting the lane. Preserve the commit/evidence and obtain a receiving acknowledgment. |
| `fbf4770c-afee-4a23-babc-6ce23cf0b70b` | asking, online / none | 13 / 0 / `3894f016` | 26 diff entries; thread `019fa27a-5c96-7063-b507-f3cba978049b`, record-only/no loaded ref | Clean current-main replay of `4132dcaf`; exact chain is `2c415b4f`, `cd510b36`, `d8757625`, `43596e2b`, `1c86829b`, `7eb12f42`, `9a343f87`, `e2454f7b`, `ee4b582b`, `9414a8b4`, `04d85b6c`, `32f27e67`, `f3cd7839`. A-phase evidence is retained (`886d396b`, evidence hash `4813834368...`), but the exact current-main headed B and adversarial review are explicitly not done. Salvage to `fe9cbbfa` only after acceptance; do not close. |

## CLOSE-AFTER-ARCHIVE-FIX

These rows are clean, have no undelivered branch delta, and have no live external deep-link identified in the
prompt/note. The archive fix is still a required precondition for archived-online records, and every close must
re-probe exact process identity and shared references immediately before mutation.

| id | state / proposal | ahead / dirty / base | diff / runtime ownership | closure evidence |
| --- | --- | ---: | --- | --- |
| `c115afbe-3c13-4b40-b8de-c712a918d966` | archived, close-pending, offline / close | 0 / 0 / `593aa62d` | 0; thread `019f8fc3-d429-7de3-abaa-736c7c7e481b`, record-only/no loaded ref | Branch is an ancestor of main; no unique work or external reference. |
| `44da65b5-f338-4564-9c9e-c9fd2c1bde75` | archived, done, offline / nothing | 0 / 0 / `dc76dd4b` | 0; thread `019f9f16-4e6f-7812-968d-01e4fd9744ce`, record-only/no loaded ref | **CLOSE-AFTER-FE9.** Deployment/recovery identity, tarball hash, health, and resource result are preserved as historical facts below; no branch delta remains. |
| `b5acb442-ebda-437e-b399-c35b93f8d3ae` | archived, asking, offline / none | 0 / 0 / `934bf7c5` | 0; thread `019f9e91-8454-7a23-b4b7-0650140bd665`, record-only/no loaded ref | **CLOSE-AFTER-FE9.** Parent `58195f32` directly received its strict-three, contract-alignment, static4/isolated-package verdicts and consumed those decisions for HOLD/filing/repair actions; the receipt is proven despite the older timeout note. |
| `0e6a1bc4-fc35-4f3d-9c78-20d7b71991a5` | archived, parked, offline / none | 0 / 0 / `95dd52f8` | 0; thread `019f9eca-64de-7ed0-a5e4-bdce5e4f9591`, record-only/no loaded ref | **CLOSE-AFTER-FE9.** Its awaited product fix landed via `b2aa74d1` / main merge `0403ccf7`; no branch delta remains. Hold until protected `fe9cbbfa` lands and the archive projection gate is reverified. |
| `b2aa74d1-f05c-483f-93ce-b058f9256c54` | archived, done, offline / nothing | 0 / 0 / `73bfa93c` | 0; thread `019f9ef2-7d2c-71e0-87f2-34cf5faf519d`, record-only/no loaded ref | Note says work landed in main merge `0403ccf7`; clean, no sidecars. |
| `296fa2e5-c543-4fec-b99d-b9208e31f4fe` | archived, offline, offline / none | 0 / 0 / `ec59ffb0` | 0; thread `019f9f2b-6900-7eb0-a989-089c937ec9e0`, record-only/no loaded ref | Retired predecessor audit, clean ancestor, no note or unique commit. |
| `b3e1d382-8e4c-44df-84a0-07c6af905ffa` | archived, parked, offline / none | 0 / 0 / `4c7d2dfa` | 0; thread `019f9f83-48f0-7cd3-b471-43cd7b59c9dd`, record-only/no loaded ref | Audit-only branch; note explicitly says no own commit/readings and old `484a29ac` history is retained there. |
| `eed69846-6a0e-4589-b936-14344be7f860` | archived, done, offline / nothing | 0 / 0 / `4c7d2dfa` | 0; thread `019f9f8b-f121-7413-be44-30246d3c25c1`, record-only/no loaded ref | Audit-only, no merge proposed, no branch delta. |
| `518ceed0-7244-46cb-8bf1-621b63df92f5` | archived, close-pending, offline / close | 0 / 0 / `b421389c` | 0; thread `019fa032-6285-7e33-b088-8cc5106c212b`, record-only/no loaded ref | Landed on main (`021d02e7`); clean and no unique commit. |
| `eb8126bd-9867-4467-bc1b-0861295316f2` | archived, close-pending, offline / close | 0 / 0 / `90c37f34` | 0; thread `019fa05b-91c6-7090-8ff6-15a1f22d70aa`, record-only/no loaded ref | Landed on main as `adcffac3`; clean and no unique commit. |
| `25745879-20cc-467c-8ea0-c7104435b145` | archived, done, online / nothing | 0 / 0 / `6b70a7a8` | 0; manager exact-stopped tmux; headless record remains addressable online; worktree/branch preserved | **CLOSE-AFTER-FE9.** Historical production rollout identity/result is preserved below; no branch delta. Archive projection fix and protected `fe9cbbfa` gate remain required because the preserved headless record remains online. |
| `7093c143-8f46-49f4-bef8-011e2d175eb6` | review, online / merge | 3 / 0 / `6b70a7a8` | 9; thread `019fa0c6-ccaf-7452-907b-78906218e447`, record-only/no loaded ref | All three branch commits (`f54f7761`, `ed1e9e71`, `eefad85f`) are patch-equivalent to main (`git cherry` reports `-`); no unique deliverable remains. Proposal is stale, so archive cold-close then close after a final review re-probe. |
| `dc9077ab-de7e-4411-8447-2c7c371172fb` | close-pending, online / close | 0 / 0 / `cc905825` | 0; thread `019fa130-6af3-74b1-82d0-21e1430df0c0`, record-only/no loaded ref | Note says landed cleanly on main `67983325`; no branch delta. Online record still needs archive cold-close before destructive close. |
| `3adfb668-def1-4979-bc51-55b100364b10` | done, online / nothing | 0 / 0 / `ba1164ef` | 0; thread `019fa156-ff12-78b3-8d14-5bcdb6d4ef1b`, record-only/no loaded ref | MBP deployment runbook complete; no branch delta and no external link to this row. |
| `093e1d7e-5bdf-4963-bf4f-b5c11cfbc550` | done, online / nothing | 0 / 0 / `6b70a7a8` | 0; thread `019fa157-4324-7040-91a8-63eca6e2b326`, record-only/no loaded ref | **CLOSE-AFTER-FE9.** Its post-P0/c9/dc successor checklist is preserved below; no branch delta. |
| `d9d3875c-cd47-4049-ad65-5028812941cd` | done, online / nothing | 0 / 0 / `9ec125a6` | 0; thread `019fa1ee-e863-79c1-99d8-f53b8cfb18c4`, record-only/no loaded ref | Deployment runbook completed at clean main `9ec125a6`; no branch delta. |
| `3d484355-4635-4e33-b5f0-e5cdb1de5dfc` | review, online / merge | 0 / 0 / `304814a0` | 0; thread `019fa204-cbaf-70e1-8c50-1adeae42e15d`, record-only/no loaded ref | Explicit classification: deferred `CLOSE-AFTER-ARCHIVE-FIX`, not close-first. Ahead 0/dirty 0; the durable MBP ledger is preserved on main at `304814a0`. Do not replace that historical report; close only after the reported deferral is cleared. |
| `a2ee3a8e-ea57-43de-a0ef-9d25fbf2f162` | done, online / nothing | 0 / 0 / `67983325` | 0; thread `019fa254-09cc-7dc1-8368-148f2d7f1b57`, record-only/no loaded ref | Live ThinkPad graph-cache activation verification completed at main `67983325`; no branch delta. |
| `ae16f8e5-8841-4951-9094-a2d990e962a0` | done, online / nothing | 0 / 0 / `d78aa819` | 0; thread `019fa25a-e8df-7852-96d5-0cf3dfefcbb0`, record-only/no loaded ref | Mac deployment completed at exact main `d78aa819`; no branch delta. The dashboard URL is historical evidence, not a session deep-link owner. |
| `5c7c1125-850b-4a99-afb0-d4d599585747` | done, offline / nothing | 0 / 0 / `3894f016` | 0; thread `019fa287-7ac5-76d0-808d-abe5d7352bb3`, record-only/no loaded ref | Read-only c9 review branch is an ancestor of main; its BLOCK was superseded by `ba040720` landing and `ebb32aed` ALLOW. No unique work remains. |

## Runtime and host evidence

### Manager checkpoint after exact shell removal

The manager removed only the exact zero-child tmux shells for `dd69b378`, `4132dcaf`, and `6c4eea5d`; their
records, worktrees, and branches were preserved. The shared app-server PID `3114077` and the production
`:8787`/`:9443` endpoints remained healthy, but the public API still projects all three rows as
`working/online`. This is stale lifecycle/liveness projection, not evidence that their work is gone.

The manager also exact-stopped the archived runtimes for `206ab57c`, `9a1eb40b`, and `25745879`: their tmux
shells and Claude PID `1920147` are gone, while each record/worktree/branch was preserved and the shared
app-server remained healthy. `206ab57c` now projects offline; the two headless archived records `9a1eb40b`
and `25745879` remain addressable online until the archive projection fix lands.

The follow-up resource sample at `2026-07-27T09:39:26.639Z` measured app-server RSS `2,608.4 MiB`, PSS
`2,032.1 MiB`, CPU `12.9%`, healthy `refCount=67`, host swap `2,048 MiB` used, and `9` findings.
The manager-provided resource-census close-first candidate set was:
`c115afbe`, `518ceed0`, `eb8126bd`, `dc9077ab`, `ba040720`, `b2aa74d1`, `44da65b5`, `eed69846`,
`d9d3875c`, `a2ee3a8e`, `ae16f8e5`, and `ebb32aed`. The other clean rows (`296fa2e5`, `b3e1d382`,
`25745879`, `3adfb668`, and `093e1d7e`) remain separately classified `CLOSE-AFTER-ARCHIVE-FIX` and are not
substituted into this close-first set. Defer `484a29ac`, `5c7c1125`, and `3d484355` as explicitly reported.
Deeper transcript reconciliation overrides candidate membership where noted below: `44da65b5`, `25745879`,
`093e1d7e`, and `b5acb442` are now `CLOSE-AFTER-FE9`; `0e6a1bc4` is `CLOSE-AFTER-FE9`; and `c3579cc6`
remains KEEP for its unresolved human decision.

### Exact current-main/API re-probe

At `2026-07-27T09:44:45.590Z`, `main` was `c88745420181492e45cb72f2f6817686a6c5f10e` while this
checkpoint branch was `cbe18cf2720bddc0514dad22996f453dc53b333b`. The public API returned 38 rows and 15
archived rows. The one-shot `session review --json` results below are the current evidence for those candidate
and deferred rows; deeper transcript evidence below reconciles conflicts, so no candidate list is treated as
exact without that reconciliation. All rows reported `lint.errorCount=0` and eval phase `updating`.

| id | API status / liveness / archived | proposal | ahead / dirty / conflicts / diff entries | current classification |
| --- | --- | --- | --- | --- |
| `c115afbe-3c13-4b40-b8de-c712a918d966` | close-pending / offline / true | close | 0 / 0 / false / 0 | close-first |
| `518ceed0-7244-46cb-8bf1-621b63df92f5` | close-pending / offline / true | close | 0 / 0 / false / 0 | close-first |
| `eb8126bd-9867-4467-bc1b-0861295316f2` | close-pending / offline / true | close | 0 / 0 / false / 0 | close-first |
| `dc9077ab-de7e-4411-8447-2c7c371172fb` | close-pending / online / false | close | 0 / 0 / false / 0 | close-first after archive cold-close |
| `ba040720-374f-49df-bc73-904123f12a64` | close-pending / offline / false | close | 0 / 0 / false / 0 | close-first, but exact loaded-thread guard still applies |
| `b2aa74d1-f05c-483f-93ce-b058f9256c54` | done / offline / true | nothing | 0 / 0 / false / 0 | close-first |
| `44da65b5-f338-4564-9c9e-c9fd2c1bde75` | done / offline / true | nothing | 0 / 0 / false / 0 | CLOSE-AFTER-FE9 after historical final-note preservation |
| `eed69846-6a0e-4589-b936-14344be7f860` | done / offline / true | nothing | 0 / 0 / false / 0 | close-first |
| `d9d3875c-cd47-4049-ad65-5028812941cd` | done / online / false | nothing | 0 / 0 / false / 0 | close-first after archive cold-close |
| `a2ee3a8e-ea57-43de-a0ef-9d25fbf2f162` | done / online / false | nothing | 0 / 0 / false / 0 | close-first after archive cold-close |
| `ae16f8e5-8841-4951-9094-a2d990e962a0` | done / online / false | nothing | 0 / 0 / false / 0 | close-first after archive cold-close |
| `ebb32aed-75ca-4302-a8a0-f3e7562339c5` | done / offline / false | nothing | 0 / 0 / false / 0 | close-first |
| `484a29ac-8241-4cb3-9778-2b85b73964ae` | done / offline / true | nothing | 18 / 0 / true / 17 | deferred; unique session-console lineage |
| `5c7c1125-850b-4a99-afb0-d4d599585747` | done / offline / false | nothing | 0 / 0 / false / 0 | deferred; c9 review evidence preservation |
| `3d484355-4635-4e33-b5f0-e5cdb1de5dfc` | review / online / false | merge | 0 / 0 / false / 0 | deferred `CLOSE-AFTER-ARCHIVE-FIX`; durable ledger preserved on main |

The separate `9a408324-1cf1-47db-9b01-4e9c001e70f5` finding is also recorded: a public `stop` attempt
returned `rc=0` but produced no lifecycle transition. The current API still reads `close-pending`/`online`
with proposal `close`, and the current review is ahead 0, dirty 0, conflict-free, diff 0. This is a
false-success/no-transition finding; it is not close authority and is outside the 15/16 target population.

### Historical closure-enabling handoffs

These are deliberately minimal facts copied from final notes, with source session ids. They are historical
operational evidence, not current host state and not authorization to repeat the operations.

- **`44da65b5-f338-4564-9c9e-c9fd2c1bde75` deployment/recovery:** exact main `dc76dd4b`; tarball SHA256
  `bf45f2313846d19631c12689ce644b2dd7f25679d0381e857b9a09ce0f113653`, installed on `mbp-tail`. Only
  `zcode-backend`/`zcode-web` were restarted. Final API steady state was bounded HTTP 200 with
  `sources.spex.ok=true`; new-start EMFILE/watcher-failed counts were zero. The first cold graph request
  timed out at 20s while the cold build completed at 83.2s; six subsequent steady-state rounds returned 200
  in 6.4-100.4ms. No product changes or MR reruns.
- **`25745879-20cc-467c-8ea0-c7104435b145` production rollout:** merged runtime milestone main `6b70a7a8`;
  stale backend process group `600688` was replaced by supervisor PID `1213267`, backend instance
  `320df25d-3bc1-4c19-8df5-c6ee2faad485`, child PID `1213410`; gateway PID `2811853` stayed unchanged.
  `/health` on `:8787` and `:9443` returned 200. CLI text/JSON and `/api/resources` agreed on 18 owners,
  backend id, findings, and shared-reference fields. Codex app-server PID/start `3114077/588077020` and
  loaded protection 69 before/after (then 70 after a new thread) were retained; unknown was 0. Warm graph/
  eval reads returned 200; residual idle-CPU and descriptor pressure remained reported, not hidden.
- **`093e1d7e-5bdf-4963-bf4f-b5c11cfbc550` successor checklist:** after archive/runtime P0 and c9/dc
  stabilization, inspect `agent/anchor-drift-independent` (ahead 8), `node/bm-prime` (ahead 3),
  `node/graph-cache-48c0` (ahead 1), and `node/session-console-eval-refresh` (ahead 1) without waking
  nonexistent sessions; use commits, author/Session trailers, spec/eval/evidence lineage, merge base, and
  dirty/untracked state to decide independent validity; compare against current main and active c9/dc/dd;
  make explicit MERGE/CHERRY-PICK/DROP decisions; salvage only independently valid work into clean owned
  commits after manager review; never delete/prune branches, worktrees, detached pins, or active branches.

The three source rows are now `CLOSE-AFTER-FE9`, not permanent KEEP/SALVAGE, because these closure-enabling
facts have a durable receiving owner in this census. The source records, worktrees, and branches remain until
the gated close path is separately authorized.

The healthy resource probe measured host memory `31,576.2 MiB` total, `17,737.4 MiB` used, `2,047.9 MiB`
swap used, and `27.7%` host CPU. Totals were `6,727.1 MiB` RSS and `113.6%` sampled CPU. The shared Codex
app-server instance was `codex-app-server`, PIDs `3114065`/`3114077`, start tokens `588077014`/`588077020`,
RSS `2,417.1 MiB`, PSS `2,030.1 MiB`, CPU `19.8%`, over its `2,048 MiB` RSS budget, with `refCount=68`.
The snapshot also reports backend `320df25d-3bc1-4c19-8df5-c6ee2faad485` at `1,199.8 MiB` RSS and the
unattributed project cost `14.5 MiB`. These are budget findings, not mutation authority.

Loaded governed references relevant to this queue:

| session | thread | status / turn | consequence |
| --- | --- | --- | --- |
| `ba040720-374f-49df-bc73-904123f12a64` | `019fa29a-de6d-7a11-aff0-87b21e6108fc` | awaiting / idle | Protective; blocks close until exact owner releases it. |
| `fe9cbbfa-f987-4b01-8b7c-f569d49e966a` | `019fa283-fedd-7b30-986e-973e4696ce55` | active / active | Explicitly protected; do not touch. |
| `c9add95b-02f6-466c-a665-24cea11c8f93` | `019f9e98-379a-7210-aa8a-e6f54a123084` | active / active | Explicitly protected; do not touch. |
| `9f835e9e-52d6-405f-9035-005d321c8ba2` | `019f88ca-c003-75b2-8586-4efba2dfce8a` | asking / idle | Explicitly protected top-level session; do not touch. |

The remaining candidate Codex records are `record-only` at this sample; their records remain visible and
headless-addressable, but they do not protect the shared process. The shared app-server also contains many
loaded unowned threads; the count is included in `refCount=68`, so an unhealthy or changed probe must fail
closed rather than be reconstructed from this table.

## Ordered queue after the archive cold-close fix

1. Deploy and verify the archive-to-offline fix. Re-run `spex session ls --all --json`, `spex session review`
   for the exact id, `spex session resources --json`, worktree/branch ancestry, and external-reference checks.
2. Keep `9f835e9e`, `c9add95b`, `fe9cbbfa`, `206ab57c`, `c3579cc6`, `b5acb442`, `dd69b378`, `6c4eea5d`, and
   `ba040720` out of the close batch; the latter only becomes eligible after its loaded idle thread is gone.
3. Salvage `9a1eb40b`, `484a29ac`, `4132dcaf`, `6ca5e599`, and `fbf4770c` one at a time. A receiving owner must
   acknowledge the exact branch commits, evidence hashes/files, and child lineage before any close attempt.
4. After a fresh probe, close only the reconciled close-first rows recorded above, one at a time. Defer
   `484a29ac`, `5c7c1125`, and `3d484355` until their reported review/lineage conditions are explicitly cleared.
   The separately classified rows (`296fa2e5`, `b3e1d382`, `25745879`, `3adfb668`, `093e1d7e`, `7093c143`)
   do not enter the close-first batch without their own classification and fresh exact-owner checks.
5. Abort the batch on any identity mismatch, unknown/unhealthy probe, newly loaded thread, dirty worktree, new
   external reference, or branch ancestry change. Never use a command-name kill, guessed owner, or automatic
   close/archive route.

Checkpoint status: this ledger and its governing spec are committed together on the census branch. The ledger
does not authorize the queue or claim that the archive P0 has landed.
