---
title: outbound
status: active
hue: 280
desc: The outbound mirror direction — project a spec node OUT as a PR-shaped mirror object (title, node/<id> head, main base, status labels). Read-only, zero network.
code:
  - spec-forge/src/outbound.ts
  - spec-forge/src/outbound-proof.ts
---
# outbound

The **outbound mirror** direction of [[spec-forge]] — the twin of the inbound triage import. Where the
[[port]]'s `listPending()` projects pending nodes OUT as issue rows, the outbound mirror projects a node
OUT as a **PR-shaped** object, so collaborators who haven't adopted SpexCode still see motion on their
host.

The non-negotiable contract holds here too: **git/`.spec` is the single source of truth; a mirror is
only a projection and NEVER flows back as authority.** Everything is a one-way read OUT of the graph —
pure functions, zero network, zero writes, no mutation of any node's version or status.

**Surface:**

- `mapStatus(status) → labels` — the single mapping from a node's derived 4-state status
  (pending/active/merged/drift) to vendor-neutral mirror labels every host shares; a driver renames them
  onto its own vocabulary later.
- `mirrorNode(node) → MirrorPR` — project ONE node as a PR-shaped mirror: title, head branch `node/<id>`,
  base `main`, body from the node's intent, labels via `mapStatus`. `MirrorPR` is the outbound twin of
  `IssueRow` — the small, stable common subset a node collapses to on every host.

A node maps to a mirror PR honestly: a **pending** node has no branch yet, so its head is null and it
mirrors as a draft — a mirror with nowhere to point, rather than a fake branch.

This slice keeps the port interface stable (it adds a new file, touching neither `port.ts` nor any
driver). Out of scope: real network/API wiring and per-host label vocabularies (later siblings).
