---
title: self-launch legacy inventory
status: active
hue: 280
desc: A base-pinned, file-access-backed ledger of every legacy facility the recordless self-launch path consumes or provably does not consume.
code:
  - docs/session-platform-m4-inventory.md
related:
  - docs/session-platform-m4-self-launch-cutover.md
  - docs/session-architecture-concept-map.md
  - docs/session-legacy-deletion-gate.md
  - docs/session-adopter-cutin-plan.md
  - spec-cli/hooks/dispatch.sh
  - spec-cli/hooks/harness.sh
  - spec-cli/src/materialize.ts
  - spec-cli/src/hooks.ts
---
# self-launch legacy inventory

This node owns the audit ledger for a user-self-launched session with no governed record and no resident Spex
backend. The ledger is pinned to one named Git base and distinguishes three outcomes for every G.1 and G.2 row:
an observed or source-proven consumer, a source-proven absence of a consumer, or an honestly unmeasured result.
Absence is never inferred from a search miss.

The inventory combines real materialized hook events with a descendant-complete kernel file-access trace and
source-level last-consumer evidence. Raw trace output is captured once and retained byte-for-byte in the external,
hash-pinned study archive; the product tree keeps only reproducible commands and the syscall lines required by its
claims. Evidence records both successful accesses and failed probes, because an `ENOENT` lookup is still a dependency
on the legacy path shape.

The ledger does not authorize or claim a product deletion. It may classify a row as an M4 deletion candidate only
when the normal recordless self-launch path consumes that facility today and M4 supplies a replacement for the same
behavior. Governed lifecycle, migration/import codecs, generated compatibility residue, and adapter-owned runtime
artifacts remain assigned to their own later milestones.
