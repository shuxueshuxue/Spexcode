---
title: event-ledger-demand
status: active
hue: 205
desc: Foreground derived reads share the durable event ledger without queueing behind an unrelated writer's full build.
code:
  - spec-cli/src/git.ts#withEventCacheLock
  - spec-cli/src/git.ts#withEventLedgerBuild
  - spec-cli/src/git.ts#withEventLedgerDemand
  - spec-cli/src/git.ts#gitObjectInterpretation
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
remain part of that writer contract. Lock authority is one exact process generation: PID, cross-platform process-start
token, and a per-acquisition nonce. A reused PID is dead authority, an unreadable identity (including an EPERM process
whose start token cannot be read) is unknown and fails loudly, and a lock that disappears after a losing create is a
normal release race that retries acquisition rather than inventing an unknown owner.

A foreground derived read first attempts that exact transaction without waiting. If the lock is free, the read is
the writer and missing immutable facts become durable exactly as before. If a live writer already owns the lock,
the foreground read opens the ledger's current atomic snapshot, runs the same derivation against it, and discards
only the immutable additions that this read discovered. It never substitutes an empty verdict: a missing fact is
derived from Git through the ordinary adapter, and a malformed ledger is rejected as a reusable snapshot and rebuilt
from Git. Git failures, unknown lock ownership, and repeated Git interpretation identity movement remain loud. The
concurrent writer may publish the same immutable fact later; either answer has the same semantics because the ledger
stores facts, not verdicts.

Demand is an ambient, lazy acquisition policy. Observer recovery waits, content revision reads, stable-cut replay, and
the non-ledger parts of review payload assembly take no lock; any nested history/hunk consumer enters the same demand
policy at its ordinary ledger seam. Each transaction therefore encloses only immutable ledger derivation, including a
cold review payload's real lint consumer, while the post-observer generation and content-revision fences remain after
derivation. List, summary, and export all inherit that policy, and a replay that needs no ledger fact never consults an
unrelated writer lock.

This is one read policy over one ledger format and one derivation engine. It adds no cache, generation, timeout,
path class, or background priority. Contention changes only who may persist newly derived immutable facts. A later
uncontended read still writes them through the ordinary transaction, so foreground availability does not turn the
durable ledger into a permanently read-only fast path.
