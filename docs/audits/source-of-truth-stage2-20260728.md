# Incremental spec lint phase attribution, stage 2

## Scope and pinned inputs

- Ledger baseline: `ac0868488e311f0485beae3cdd3fa1172069abb5` as already released on main.
- Pre-optimization source: `5cad89f6` (the ledger implementation plus this audit's living-spec commit).
- Optimized source: `7e0b6ce2`.
- Post-sync integrated source: `a8330cdc2d3638650dbc317087cc0060e45dd525`. The integrated A/B below
  supersedes the earlier pre-sync series in `raw/ab-*`.
- Fixed corpus: 8,266 commits at `b93577e2f1b7434afc991e446100eb3ea615c59b`, tree
  `d7e7a7aabc2fd2a6711642cebfb99659f10835cb`.
- Advance base: 6,266 commits at `6614e4f91e30c52f51623fce5d81178b472d90d8`, with the same tree.
- Runtime: Node 24.15.0; product surface: a fresh process running `node <source>/spec-cli/bin/spex.mjs spec lint`.
- Every variant/sequence used an implementation-owned HOME. Cold, exact-tip hit, and 6266 -> 8266 advance are
  distinct process/HOME states. A/B order alternated by repetition; the kernel page cache was not flushed.
- Raw logs, straces, CPU profiles, resource rows, and stdout/stderr are under
  `/home/jeffry/.cache/spexcode-audits/source-of-truth-stage2-20260728/`.

The strace/profile runs carry instrumentation overhead and are used only for phase attribution and counts. Product
wall/CPU/RSS below comes from untraced runs.

## Instrument positive control

The pinned Python fixture keeps the same anchored spec at both tips. At `e64730f` the code matches the version; at
`b11c261` one commit changes `src/calc.py#apply_rate` without re-versioning the spec. The clean/debt runs changed:

- exit status `0 -> 1` and exact `anchor-drift` finding count `0 -> 1`;
- V8 `anchorHitCommits` self samples `0 -> 1`, with the debt profile also exposing `hunksAtMany` while the clean
  profile exposes neither.

Therefore the profiler demonstrably observes a known anchor stage change before its phase samples are accepted.
See `raw/control-{clean,debt}.*`, `raw/control-profile-counts.txt`, and `profiles/control-{clean,debt}/`.

## Exact-tip phase attribution

The baseline hit trace performs zero immutable event walks. Its one topology walk, one ledger transaction, and later
anchor lookups give these non-additive phase readings (Git children overlap; V8 samples are approximately 1 ms each):

| Phase | Evidence | Baseline hit reading |
| --- | --- | ---: |
| process / tsx startup | first launcher exec -> first Git exec; app exec -> first Git exec | 0.963 s; 0.551 s |
| adoption + ledger identity setup | 13 short Git children before/around the pair build | 0.147 s summed child time |
| tree topology | one `ls-tree`; one `rev-list --parents` | 0.014 s; 0.452 s |
| ledger open / checksum / decode | lock-to-release window; ledger open count; V8 decode + key validation | 0.177 s; 1; 43 + 11 samples |
| rename lineage + version/ack projection | identified projector/index frames (`canonical` closure, `ancestorsOf`, both builders, merge parse/render) | at least 697 samples |
| spec + anchor parse | selected TS parser frames + spec `reId`; 16 batch object children + 11 hunk/merge-patch children | at least 361 samples; 0.532 s summed child time |
| finding / output | `specLint` + lint frames; stderr writes / bytes | at least 44 samples; 41 writes / 5,894 bytes |

The 41 output syscalls each took at most 11 microseconds in the hit trace; emission is not the remaining wall-time
driver. The two current-tip projectors are: they each rebuilt equivalent topology/path maps after the pair build had
already parsed the same `rev-list --parents` and `ls-tree` text. The exact hit's single largest JS frame is the rename
projector closure (409 samples), followed by ancestry projection (100), `buildIndex` (73), and `buildDriftIndex` (53).

A final declared cost control found one further repeated identity read after the pair projection was shared:
the unchanged second `evalTimeline` pass still spawned three identical `git for-each-ref refs/replace` children.
The ledger identity continues to use Git's canonical replacement targets, but now re-runs that command only when
the common-dir ref-storage bytes (`refs/replace`, `packed-refs`, or reftable) change. The 30-anchor control moved
from 3 second-pass children to 0; the 600-anchor control likewise produced 0 after 1,200 readings. A real replace
ref changed the selected ledger identity, and deleting it restored the original identity, so the zero-child result
does not come from an interpretation-stale memo.

Cold and advance traces preserve the released ledger shape:

| State | topology | immutable event walks | ledger I/O |
| --- | --- | --- | --- |
| cold | `ls-tree` 0.014 s; topology 0.416 s | history 2.004 s; merge 1.781 s; drift 3.519 s (parallel) | one missing open, one tmp open, one replacement |
| exact-tip | `ls-tree` 0.014 s; topology 0.452 s | zero | one read, zero tmp opens, zero replacements |
| advance | `ls-tree` 0.020 s; topology 0.469 s | history 0.056 s; merge 0.029 s; drift 0.133 s, each exactly `^6614e4f..b93577e` | one read, one tmp open, one replacement |

See `raw/baseline-{cold,hit,advance}.strace`, `.time`, `.resources.ndjson`,
`raw/baseline-child-durations.json`, and `raw/baseline-profile-top.json`.

## Minimal implementation and A/B

`buildIndexPair` now turns the current path listing into the all-path/spec-path sets once and turns topology into one
`{order, parents, reachable}` projection. History and drift consume those immutable structures instead of splitting
the same large strings into equivalent maps independently. Standalone single-index callers still use the same helper.
No cache, fallback, fingerprint, daemon branch, or semantic condition was added.

Post-sync untraced A/B at 8,266 commits (wall seconds / user+system CPU seconds / peak RSS KiB):

| State | Pre | Post | Wall change |
| --- | ---: | ---: | ---: |
| cold, n=3 median | 4.92 / 8.10 / 348720 | 5.10 / 8.21 / 329976 | +3.7% |
| exact-tip hit, n=3 median | 3.09 / 4.39 / 331908 | 3.02 / 4.25 / 322660 | -2.3% |
| advance, n=2 mean | 3.285 / 4.63 / 333330 | 2.990 / 4.34 / 329736 | -9.0% |

All 10 corresponding cold/hit/advance CLI pairs have equal exit status and byte-identical stdout and stderr. Cold
wall and CPU improvement is not demonstrated; the integrated sample is 3.7% / 1.4% slower while using 5.4% less
peak RSS. Exact-tip and advancing runs show modest directional CPU and memory savings, not a general performance
law. The implementation is justified primarily by removing two duplicate projections with one shared read-only
projection, not by a cold-speed claim. Full lint remains history-sensitive through current-tip topology, rename
projection, version/ack reachability, spec parse, and anchor judgment.

One attempted integrated oracle row is deliberately excluded: `raw/integrated-oracle-baseline.time` exited 1
because its source checkout no longer existed, so the candidate-only exit 0 says nothing about equivalence. The
replacement proof rebuilt the tracked CLI from an immutable, clean `03530ff24a27da6b6ec3cedcbf47ae169a0a88f5`
checkout. Candidate and baseline positive controls both exited 1 with one `anchor-drift`; at the 4,266, 4,766,
5,266, 6,266, and 8,266 tips they then had equal exit status and byte-identical stdout/stderr (0 / 5,894 bytes)
against the same `d7e7a7aa` tree. The self-contained summary and captured channels are in
`/home/jeffry/.cache/spexcode-audits/source-of-truth-stage2-salvage-20260728/`.

## Verification

- Positive control: pass (known anchor debt observed by output and profiler).
- Immutable-baseline five-tip oracle: 5/5 byte-identical after both positive controls passed.
- Post-sync fixed-corpus public CLI parity: 10/10 pairs byte-identical.
- Real-Git composite ledger scenario and `spec-cli/src/git.test.ts`: 26/26 pass.
- Off-history repeat controls: second pass 0 Git children at 30 anchors / 300 readings and at 600 anchors /
  1,200 readings; real add/remove `refs/replace` changed/restored ledger identity.
- `npx tsc --noEmit`: pass.
- `spex spec lint`: 0 errors; pre-existing warnings remain.
