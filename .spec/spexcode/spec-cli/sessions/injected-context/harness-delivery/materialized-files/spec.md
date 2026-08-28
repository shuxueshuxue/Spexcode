---
title: materialized-files
status: active
hue: 280
desc: The byte-equality writer for derived harness files — a correct target is left untouched, while a differing target is replaced exactly once.
code:
  - spec-cli/src/file-write.ts
related:
  - spec-cli/src/materialize.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/contract-filter.ts
  - spec-cli/src/plugin-harness.ts
  - spec-cli/src/materialize.test.ts
---
# materialized-files

Derived harness artifacts are a target state, not an instruction to write. The one writer compares the existing
bytes with the desired bytes and writes only on a difference; copied package files use the same rule. This gives
all materialize consumers one operational idempotence law: a correct target keeps its filesystem identity, while
a changed target receives exactly the requested bytes. It does not decide which paths belong to a materialize
pass or which stale paths to remove; those are the owning renderer's target map.

A changed target is replaced, never rewritten in place: the bytes land in a sibling staging file that is renamed
over the target, so a concurrent reader — codex re-reading its own `config.toml`, a harness loading its hooks
file — observes the old bytes or the new bytes and never a truncated middle. The replacement resolves a symlink
to the file behind it and keeps that file's mode, so a user-private `0600` config stays private across the swap.
