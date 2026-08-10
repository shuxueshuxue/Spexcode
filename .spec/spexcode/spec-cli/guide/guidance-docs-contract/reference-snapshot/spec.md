---
title: reference snapshot
status: active
hue: 200
desc: The committed spec tree becomes a deterministic, sealed Reference documentation snapshot that a consumer can render without a product checkout.
code:
  - scripts/reference-snapshot.mjs
related:
  - scripts/docs-release.mjs
  - scripts/reference-snapshot.test.mjs
---
# reference snapshot

## raw source

The product's `.spec` tree remains the source of truth for Reference documentation. A documentation consumer
receives a complete, deterministic rendered snapshot of that tree, never a checkout or a request to run the
product's renderer.

## expanded spec

[[guidance-docs-contract]] owns the immutable release envelope and consumer handoff. This node owns the
Reference projection inside that envelope. Given one clean, committed product revision, it walks the current
`.spec` tree in a stable path order and emits exactly one UTF-8 JSON payload named `reference-snapshot.json`.
The same committed tree produces byte-identical output on repeated runs.

The payload has schema `spexcode.reference-snapshot/v1`, declares its payload name and the exact source revision,
and carries a canonical bundle digest. It contains every rendered Reference page, a complete derived navigation
tree, and provenance sufficient to trace each rendered page back to its source spec path and source-byte digest.
Pages use safe, unique relative paths below `docs/reference`; a source directory with a leading dot uses the
existing public `dot-` spelling (for example `.plugins` becomes `dot-plugins`). Their rendered bytes, titles, and
source identities are explicit. The navigation is derived from those same pages, not maintained as a second
authored list.

The snapshot is self-contained: the consumer needs only the verified payload to replace `docs/reference` and its
derived Reference navigation. It never reads a product checkout, source directory, Git ref, local generator, or
network resource while applying the snapshot. A malformed tree, ambiguous page destination, unsupported source
file, or inconsistent canonical digest fails the producer loudly; it cannot yield a partial snapshot.

The snapshot is a read-only derived projection. It does not publish a GitHub release, choose a release version,
modify documentation files, or make Reference prose editable outside `.spec`. Publication identity, hashes, and
the atomic pairing with Guidance belong to [[guidance-docs-contract]].
