---
title: zswarm-adopter
status: active
hue: 280
desc: A repository-external clean consumer proves the published protocol stack can carry ZSwarm's six-operation runtime shape without any Spex runtime dependency or legacy storage authority.
code:
  - scripts/m5-zswarm-adopter.mjs
related:
  - spikes/zswarm-sabotage/consumer.mjs
  - spikes/zswarm-sabotage/trace-gate.mjs
  - spikes/zswarm-sabotage/evidence/fail-first/sha256.txt
  - spikes/zswarm-sabotage/evidence/pass/sha256.txt
  - .spec/spexcode/session-runtime/zswarm-cutover/spec.md
  - .spec/spexcode/session-runtime/spec.md
  - packages/session-protocol/package.json
  - packages/session-topology/package.json
---
# zswarm-adopter

The ZSwarm replacement proof runs from a clean consumer created outside this repository. The consumer installs
only packed `@spexcode/session-protocol` and `@spexcode/session-topology` artifacts. Both package resolution and the
installed dependency graph are measured from that consumer: no workspace resolution, `spexcode`,
`@spexcode/spec-cli`, or `@spexcode/session-core` may enter the process or installation closure.

The proof preserves the six observable operations of ZSwarm's current runtime-session bridge without preserving the
bridge itself. Registration initializes an externally owned address. Parent/child discovery uses neutral topology.
State publication writes ZSwarm role, workspace, metadata, revision, and state only to an adopter-owned table, then
resolves recipients and enqueues the complete notification in the same protocol transaction. Read returns that
adopter record. Drain repeatedly dequeues until the durable queue is empty and demonstrates the protocol's
at-most-once boundary. No adapter field extends a protocol row.

At least two independent writer processes publish into the same database and a third process opens SQLite read-only
and derives the committed adopter rows, topology edges, and pending messages without consulting a runtime process.
Completion is defined by exact committed row and message counts, exact bodies, a second empty drain, and zero pending
messages, never by elapsed time.

The same complete loop runs with three fixture-contained legacy roots: absent, non-writable, and populated with
plausible poison state. A full-process-tree `/usr/bin/strace -f -qq -e trace=%file,%process` reading must measure zero
legacy-selector hits in real filesystem syscall lines for every run. Its calibration reads the poison file and is
accepted only when that exact path appears in a real file syscall line; an `execve` argument occurrence cannot
calibrate the tracer. Missing tools, a failed capability vector, a failed traced command, an empty trace population,
or a failed calibration is `NOT-MEASURED`, never zero.

All mutation and cleanup is confined to one resolved `mktemp` fixture outside the repository. The runner refuses a
destructive target until its resolved path is proven to be a descendant of that fixture. It builds no importer for
ZSwarm, changes no external checkout, and introduces no outbox, observer, dispatcher, daemon, fallback, compatibility
alias, dual read, or dual write.
