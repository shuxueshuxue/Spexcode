---
title: zswarm legacy inventory
status: active
hue: 188
desc: Base-pinned, source-backed inventory of the external ZSwarm consumer of the legacy session bridge.
code:
  - docs/session-platform-m5-zswarm-inventory.md
related:
  - .spec/spexcode/session-runtime/zswarm-cutover/spec.md
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-protocol/runtime-session/spec.md
  - .spec/spexcode/session-protocol/concept-map/legacy-deletion-gate/spec.md
---
# zswarm legacy inventory

This node owns the M5 auditor ledger for the external ZSwarm adopter at z-code ref `b9b3fa701`. It records only
source and filesystem facts that can be pinned to that ref or to a read-only local path observation. It does not
modify z-code, claim a live swarm run, or authorize deletion in either repository.

The ledger distinguishes `CONSUMER`, `NO-CONSUMER`, and `NOT-MEASURED(reason)`. A source-level absence at the named
ref is not a claim about other z-code branches, releases, the macOS authoritative checkout, or an unobserved live
runtime. The external raw audit capture is retained once in the hash-pinned study archive and indexed by
`evidence/README.md`; it is never overwritten by a rerun.

The bridge is removable only after z-code has cut to the split protocol/topology/runtime composition and proves the
same public workflow with the old package unavailable. The repository-local deletion set is empty while the bridge
is still consumed by that external adopter.
