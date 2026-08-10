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
