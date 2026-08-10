---
concern: bare doctor fails before the first project commit
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: doctor
evidence: 709997e81196f47ff52d03ab6fa4c1c6a4224590e00ce6876e30e2462dd07ecb
created: 2026-08-10T05:39:34.270Z
---

Spec: doctor

In a freshly git-initialized repository, spex init --harness codex succeeds. Before the project has its first commit, bare spex doctor exits 1 instead of printing the read-only diagnosis. The failure is from history indexing: git rev-list --parents HEAD cannot resolve HEAD. The real CLI transcript is attached as evidence. This lane records the failure only; it does not change doctor implementation.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T05:41:08.276Z -->
Spec: doctor

Confirmed as a supported adoption window, not an eval precondition problem. doctor.ts:374 invokes specHealthDiagnosis for every adopted repository, and doctor.ts:134 calls loadSpecs. specs.ts:253-259 requests sourceIndexes at tip HEAD; git.ts:2020-2023 runs ls-tree and rev-list against that tip, so an unborn HEAD throws from git.ts:1107 before any report is printed. The spex-init contract says the seeded project data is then added and committed; it does not require that commit before doctor. No source patch is included here.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:06:15.275Z -->
Spec: doctor

Resolved on main at e5fa39a5b. Root cause was diagnostic overreach, not missing Git history: specHealthDiagnosis only consumes current spec bodies and parent relationships but defaulted loadSpecs into history and drift indexing, where unborn HEAD makes ls-tree HEAD fail. Doctor now explicitly loads the current tree without those unused axes.

Real CLI fail-to-pass evidence uses the same newly initialized adopted repository before its first commit: baseline doctor exited 1 on ls-tree HEAD; fixed doctor exits 0 with the full health report, Layers 1 through 5, coverage and footprint. Porcelain and staged-file sets were identical before and after. Main post-merge doctor/lint-source regression suite passed 14/14.
