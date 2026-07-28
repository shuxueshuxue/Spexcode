# Incremental lint boundary audit, stage 3

## Scope

- Baseline source: `ac8253742f4ca74ea8dd6bd33d29be19204d36aa`.
- Candidate source: `7f4fe5ea87548e853dc04a15ebbad0b4c93446c0`.
- Changed mechanism: the process-local history/drift content key is `{HEAD, Git interpretation identity}`.
  A checkout root remains an LRU owner, but is not a second immutable-content dimension.
- Product surface is unchanged: no graph or dashboard code changed.

The default loss function is exact product equivalence: exit status plus raw CLI stdout and stderr must match.
For the cache-specific route, a same-HEAD linked-worktree request loses when it returns more than one history or
drift object, or when its cache has more than one content slot. A different HEAD or interpretation identity must
not share. The retained slow `sourceIndexesFull` path is the semantic oracle.

## Controls And Corpus

The real CLI positive control created an anchored source change: lint exited 1 and named `anchor-drift`; `spex
ack` exited 0 and the next lint exited 0. The parallel-version pending control used
`R--vA; R--h--vB; M(vA,vB)`: both parents were clean, while only the hit variant reported one anchor error at
the merge. The path-reuse control kept an old `src/a.ts` edit visible at the old base but absent from the
recreated `src/c.ts` lineage.

The performance corpus is a fresh bare Git repository with 8,200 linear commits, a fixed tree containing one
barely-governed TypeScript source file, and detached worktrees at commit 7,200 and 8,200. Each CLI invocation
used `node <candidate>/spec-cli/bin/spex.mjs spec lint` with its own `SPEXCODE_HOME`; timings are wall/user+sys
CPU/peak RSS from `/usr/bin/time`. The kernel page cache was not flushed, so only paired same-process shape
claims are used as decisions.

| State | Wall | CPU | Peak RSS | Ledger bytes | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| 8,200 cold | 2.32s | 2.74s | 132,364 KiB | 1,943,925 | exit 0 |
| 8,200 same-tip | 2.16s | 2.40s | 136,372 KiB | unchanged | exit 0 |
| 7,200 -> 8,200 advance | 2.31s | 2.60s | 135,676 KiB | 1,944,136 | exit 0 |
| 8,200 dirty working tree | 2.15s | 2.38s | 132,992 KiB | unchanged | exit 0 |
| exact pending tree | 2.36s | 2.89s | 146,232 KiB | transient | exit 0 |

Clean, dirty, and pending product channels were byte-identical after removing the measurement-only final time
line. Independent old/new CLI runs on the clean 8,200 tree were also byte-identical; their one-off readings were
2.57s/3.01s/161,232 KiB and 2.28s/2.58s/133,328 KiB respectively, not a general speed claim.

The exact-tip strace executed ten Git children: eight configuration/worktree probes plus one `ls-tree` and one
`rev-list --parents`; it executed no immutable event-history walk. A V8 CPU profile of this linear fixture had
1,749 idle samples out of 1,844, so it gives no justification for adding a JS topology representation merely to
remove a cheap Git child.

## Landed Route

After a ledger seed, two linked worktrees at the identical 8,200 commit were requested by four concurrent
consumers in one process.

| Version | Projection time | Peak RSS | History/drift identities | Content slots | Root owners |
| --- | ---: | ---: | ---: | ---: | ---: |
| root-inclusive baseline | 2,896.6 ms | 208,380 KiB | 2 / 2 | 2 / 2 | 2 / 2 |
| candidate | 1,448.8 ms | 187,024 KiB | 1 / 1 | 1 / 1 | 2 / 2 |

The code change is deliberately small: all three public index entry points now call one key helper. Root
ownership and interpretation invalidation remain unchanged. The permanent real-Git regression verifies object
identity, two root owners, one content slot, and the existing pending-cache isolation test still passes.

## Rejected Routes

### Persistent topology/reachability

`drift-numstat` already stores each commit's parents. A prototype decoded the 1,943,925-byte ledger, traversed
from the current tip, and exactly recovered 8,200 commits and 8,199 parent edges; `git rev-list --parents` saw
the same graph. The direct prototype cost 51.1 ms versus 23.5 ms for Git's walk before accounting for the
required exact date-order tie behavior. A ledger contains no per-tip full traversal ordering, while
walk-newest version selection observes Git's date-order ties. Persisting that order per tip costs O(H) on every
advance; inventing a different tie order changes findings. The route therefore has a proven closure parity but
no measured win or safe ordering representation, so no product cache was added.

### Persistent/layered rename lineage

The real path-reuse control demonstrates the cost boundary. After `a -> b`, recreate `a`, then `a -> c`, the
old edit must remain reachable for the old base but must not enter the current `c` lineage. A single current-path
map gives one of those answers wrong. Eagerly storing every projected answer requires revisiting every old event
when a later rename or an incomparable rename fork appears; lazily layering the rename edges retains the current
read-time traversal. This is cost conservation, not an unimplemented special case. The immutable event ledger
plus tip-relative projection remains the minimal exact representation.

### Git-native commit graph/bitmaps

On the same 8,200-commit corpus, `rev-list --parents` with a verified 482 KiB commit-graph took 0.01s in three
runs; `core.commitGraph=false` took 0.04-0.05s. Git already consumes this native acceleration when an adopter
has it. SpexCode must not write a commit-graph or require repository configuration, and Git's output still must
be parsed into the exact JS reachability/rename projector. It is an acceleration below the existing adapter
boundary, not a replacement for the semantic index.

## Conclusion

The landed shared-key fix buys back duplicated current-tip projection work without changing a verdict. The
remaining exact topology and lineage work is tip-relative information, with no demonstrated representation that
both preserves Git's ordering/rename algebra and improves the measured path. Future work should start from a new
profile with an adversarial branchy corpus; it must retain the same CLI byte-parity and positive controls before
changing this boundary.
