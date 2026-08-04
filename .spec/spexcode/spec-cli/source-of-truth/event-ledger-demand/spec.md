---
title: event-ledger-demand
status: active
hue: 205
desc: Foreground derived reads share the durable event ledger without queueing behind an unrelated writer's full build.
code:
  - spec-cli/src/git.ts#withEventCacheLock
  - spec-cli/src/git.ts#withEventLedgerBuild
related:
  - spec-eval/src/sessioneval.ts
  - spec-eval/src/sessioneval-ledger-demand.api.test.ts
---
# event-ledger-demand

## raw source

The event ledger is one durable truth, not one queue for every reader. A writer owns the project lock while it
derives missing immutable history and hunk facts and atomically replaces that ledger. A foreground product read
must consume the same integrity-checked representation without waiting for an unrelated writer's whole build.

## expanded spec

The ordinary build transaction remains the sole writer. It acquires the project-scoped lock, reads one complete
integrity-checked snapshot, lets every nested history and hunk consumer add facts to that build, rechecks the Git
interpretation identity, and performs at most one atomic replacement. Dead-owner recovery and bounded waiting
remain part of that writer contract.

A foreground derived read first attempts that exact transaction without waiting. If the lock is free, the read is
the writer and missing immutable facts become durable exactly as before. If a live writer already owns the lock,
the foreground read opens the ledger's current atomic snapshot, runs the same derivation against it, and discards
only the immutable additions that this read discovered. It never substitutes an empty verdict: a missing fact is
derived from Git through the ordinary adapter, malformed ledger contents are rejected as a whole snapshot, and
any Git interpretation identity movement retries the complete read. The concurrent writer may publish the same
immutable fact later; either answer has the same semantics because the ledger stores facts, not verdicts.

This is one read policy over one ledger format and one derivation engine. It adds no cache, generation, timeout,
path class, or background priority. Contention changes only who may persist newly derived immutable facts. A later
uncontended read still writes them through the ordinary transaction, so foreground availability does not turn the
durable ledger into a permanently read-only fast path.
