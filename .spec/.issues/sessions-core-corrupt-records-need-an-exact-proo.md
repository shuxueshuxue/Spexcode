---
concern: [[sessions-core]] corrupt records need an exact-proof quarantine path instead of permanently poisoning resource projection
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: sessions-core
created: 2026-07-28T20:29:00.693Z
---

Observed on a real governed store: the record was syntactically unreadable, while independent product/resource and Git/tmux probes showed zero adapter process, zero shared-runtime reference, no worktree, no branch, and no tmux session. Public close correctly refused destructive cleanup and preserved a byte-exact quarantine copy, but left the unreadable directory in the active session namespace; every later /api/resources read therefore remained unavailable.

The missing product boundary is not “delete corrupt JSON.” It is a public, auditable, reversible quarantine operation that can consume an exact multi-surface absence witness, move only the opaque record out of active projection, preserve original bytes and provenance, and still refuse whenever any owner/probe is live, ambiguous, or unknown. Resource projection should then become available without inventing a readable lifecycle or signaling an unproven process.
