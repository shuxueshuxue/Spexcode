---
title: guidance-catalog
status: active
hue: 180
desc: A deterministic, immutable index of active plugin guidance plus CLI help and guides, exportable without duplicating authoritative prose.
code:
  - spec-cli/src/guidance-catalog.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/index.ts
  - spec-cli/src/guidance-catalog.test.ts
---
# guidance-catalog

## raw source

SpexCode has one guidance source for each human-readable contract: active plugin `spec.md` bodies, the CLI help
registry, and the CLI guide registry. The product-side catalog is an index over those sources, not another prompt
text store. A consumer can export the index as a stable JSON bundle and follow each entry's source path to read the
authoritative prose.

## expanded spec

`GuidanceCatalog` gathers every active plugin surface (`system`, `command`, `hook`, `skill`, `agent`, and `review`)
through the existing field-driven loaders. A plugin that serves multiple surfaces has one index entry per surface,
but all entries point at the same source path and content hash; no body is copied into the catalog. The catalog also
indexes the complete `spex help` map and every registered `spex guide` page from their existing registries.

The JSON bundle is schema-versioned and immutable. It contains a fixed `schemaVersion`, the source-of-truth git
`revision`, entries sorted by stable kind/id/source path, and each entry's source path, source revision, and SHA-256
hash of the rendered guidance. It contains no timestamps, random ids, or embedded guidance bodies. A `bundleHash`
is the SHA-256 of the canonical bundle payload, so identical inputs produce byte-identical JSON and different source
revisions/content cannot masquerade as the same export.

The CLI command `spex guidance` prints this JSON; `spex guidance --out <path>` writes the same bytes. The backend
route `GET /api/guidance` returns the same object. Both are read-only and deterministic; unknown flags, missing
output paths, a malformed plugin tree, or an unavailable git revision fail loudly through the normal CLI/server
error path. The public docs server and materialized harness artifacts remain outside this catalog.
