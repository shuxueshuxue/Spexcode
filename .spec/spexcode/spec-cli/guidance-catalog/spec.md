---
title: guidance-catalog
status: active
hue: 180
desc: A deterministic, immutable catalog projection of active plugin guidance plus CLI help and guides, exportable with exact content and an effective system-contract view.
code:
  - spec-cli/src/guidance-catalog.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/index.ts
  - spec-cli/src/guidance-catalog.test.ts
  - .spec/spexcode/spec-cli/guide/guidance-docs-contract/spec.md
---
# guidance-catalog

## raw source

SpexCode has one guidance source for each human-readable contract: active plugin `spec.md` bodies, the CLI help
registry, and the CLI guide registry. The product-side catalog is a read-only projection over those sources, not
another authoring store. A consumer can export one stable JSON payload that contains the exact rendered content and
source provenance, so it can render guidance without reading this checkout.

## expanded spec

`GuidanceCatalog` gathers every active plugin surface (`system`, `command`, `hook`, `skill`, `agent`, and `review`)
through the existing field-driven loaders. A plugin that serves multiple surfaces has one index entry per surface,
but each entry carries the exact rendered `content` from that loader plus the same authoritative source path, content
hash, and revision; there is no second editable source. The catalog also projects the complete `spex help` map and
every registered `spex guide` page from their existing registries with their exact rendered output.

The JSON bundle is schema-versioned and immutable. It declares the release contract's catalog schema identifier
`spexcode.guidance-catalog/v1` and named payload asset `guidance-catalog.json`, the source-of-truth Git revision,
entries sorted by stable kind/id/source path, and an `effectiveSystemContract` containing the exact
`surface:system` materialization output (trimmed bodies joined by blank lines in loader name order), its SHA-256,
and its ordered source entry ids. Each entry has source path, source revision, SHA-256, and exact content. It has no
timestamps, random ids, or repo-stored bundle file. `bundleHash` is the SHA-256 of the canonical bundle payload,
while the release manifest may separately hash the exact downloaded JSON bytes as required by
`spexcode.guidance-release/v1`.

The CLI command `spex guidance` prints this JSON; `spex guidance --out <path>` writes the same bytes. The backend
route `GET /api/guidance` returns the same object. Both are read-only and deterministic; unknown flags, missing
output paths, a malformed plugin tree, or an unavailable git revision fail loudly through the normal CLI/server
error path. The public docs server and materialized harness artifacts remain outside this catalog; only the export
contains the derived content projection.
