---
title: guidance docs contract
status: active
hue: 200
desc: Guidance leaves the product repository only as a sealed, versioned catalog release; an independent documentation repository polls, verifies, reviews, and deploys that release without reading or writing product sources.
code:
  - scripts/guidance-release.mjs
related:
  - spec-cli/src/guide.ts
  - spec-cli/src/guidance-catalog.ts
  - scripts/guidance-release.test.mjs
  - .github/workflows/guidance-release.yml
  - .github/workflows/ci.yml
---
# guidance docs contract

## raw source

The product tree remains the source of truth for SpexCode guidance. Before documentation cutover, the existing
public authored Guide and Blog pages, theme assets, and generated Reference are imported as a hash-verified,
docs-owned snapshot. An independent documentation repository consumes that baseline and sealed artifacts rather
than this checkout, and its own review and deployment gates remain explicit.

## expanded spec

[[guide]] owns the guidance content. The product repository publishes that content for another repository as a
**release artifact**, never as a source checkout, a branch tip, a shared directory, a submodule, or a file-level
copy contract. The documentation repository neither reads `guide.ts` nor writes back to it; source changes flow
one way through the catalog producer. The catalog's internal schema and generation remain its own concern. This
node owns only the delivery envelope and the consumer protocol around that catalog.

### Content-preserving migration baseline

Before cutover, the existing public authored English and Chinese Guide and Blog Markdown pages, theme assets, and
generated Reference Markdown are imported into the documentation repository as a docs-owned snapshot. The import
preserves the page and asset bytes without prose rewrites. Its checked-in manifest names every source path and file
hash, with category counts for the 16 authored Guide/Blog pages, 3 theme assets, and 239 generated Reference pages;
the documentation repository verifies its own checked-in bytes against that manifest.

The documentation consumer never reads a product checkout, source directory, or `.spec` tree. It neither runs the
product Reference generator nor retains a product checkout as an input to build, verification, review, or
deployment. After import, the migration snapshot belongs to the documentation repository; the product repository
does not deploy it or write back to it.

The baseline can advance only through a reviewed immutable producer snapshot that identifies its source revision
and exact content hashes before it replaces the committed baseline. A checkout, moving branch or ref, server
filesystem copy, or local generator output cannot advance it. This migration baseline does not make Reference
snapshots automatically publishable, discoverable, or applied: a producer snapshot protocol for future Reference
changes remains separate work.

### Sealed source release

Each publishable guidance release has one immutable identity tuple:

- a producer release version and its exact source Git revision;
- a catalog schema identifier and one named catalog payload asset;
- the payload byte length and its lowercase SHA-256 digest; and
- a versioned release manifest whose fields name that tuple and the artifact retrieval location.

The manifest schema is `spexcode.guidance-release/v1`. A manifest is valid only when its schema is supported,
the source revision and release version are non-empty, the catalog schema and asset name are non-empty, the byte
length is a non-negative integer, and the digest is exactly 64 lowercase hexadecimal characters. The catalog
payload declares the same catalog schema and source identity as its manifest. The producer creates both from one
committed product revision, publishes them together under that version, and never replaces their bytes in place.
A correction is a new versioned tuple, not a mutable re-upload or a rewrite of a consumer lock.

The digest is over the exact downloaded catalog bytes, before decompression, rendering, or formatting. A source
release feed may help a consumer discover candidates, but it is not an authority to consume a moving `latest`
pointer: after choosing a candidate, every read is pinned to the release's immutable asset identity and verified
against the manifest. The product repository retains the generator input and the release provenance; the
artifact is a derived, read-only projection and can never become a second editable source of guidance.

### Product producer

`scripts/guidance-release.mjs` is the product-side producer. It runs the real `spex guidance` export from a
clean checkout at the supplied Git revision, writes its exact bytes as the payload named by that export, and
writes `guidance-release.json` beside it. The manifest has this one current shape:

- `schema: "spexcode.guidance-release/v1"`;
- `producer.repository`, `producer.release`, and `producer.revision`; and
- `catalog.schema`, `catalog.name`, `catalog.bytes`, `catalog.sha256`, and `catalog.retrieval`, where retrieval
  is the GitHub release-asset identity `{ kind, repository, release, asset }`.

The producer refuses a dirty checkout, a revision other than `HEAD`, a catalog whose declared revision or source
revision disagrees, an unsafe asset name, and an existing destination asset. Its byte count and digest are derived
from the exact written catalog buffer. It has no documentation-server client, deploy behavior, or writable
guidance source.

`.github/workflows/guidance-release.yml` runs for relevant guidance-source changes pushed to `main` and can be
manually dispatched to bootstrap the initial catalog release. Its single publish job is absent unless repository
variable `SPEXCODE_GUIDANCE_RELEASE_PUBLISH` is exactly `true`. That off-by-default gate is at job scope, before
checkout or credentials. For revision `R`, the producer release is tag `guidance-R`; the workflow either creates
that non-latest GitHub release with only the two generated assets, or, on a rerun, verifies its target revision,
complete asset-name set, and downloaded byte equality with the newly generated pair. It never uses an
overwrite/clobber upload. Publishing a correction therefore means a new committed revision and tag, never changing
an existing release asset. This workflow publishes source artifacts only: it does not deploy documentation or
contact a public documentation server.

### Consumer protocol

For the sealed Guidance catalog, the documentation repository configures the producer release feed and the catalog
schemas it accepts. Its poller does the following as one serialized update attempt. This protocol does not apply the
migration baseline or define the separate future Reference snapshot protocol.

1. Acquire a consumer-side concurrency lock scoped to that documentation repository and producer. The lock covers
   discovery, download, verification, rendering, and proposal creation, so two pollers cannot create competing
   updates for the same source tuple.
2. Read a candidate release manifest, pin its asset identities, download the manifest and catalog bytes, and refuse
   the candidate if any schema, source identity, size, payload declaration, or SHA-256 check disagrees. Network,
   parsing, and verification failures are visible failures; a poller must not reuse an older unverified payload as
   though it were current.
3. Compare the verified tuple with the documentation repository's committed consumer lock. An identical tuple is a
   no-op. A new tuple is rendered only in the documentation repository, and its source version, source revision,
   catalog schema, payload name, byte length, and SHA-256 are recorded in that lock.
4. Run the documentation repository's normal validation against that staged render, then open or update a review
   change that contains the render and the exact consumer lock. The review identifies the producer tuple; it does
   not claim that polling itself approved the content.

The lock is a provenance record, not a cache hint: review and deployment read it from the proposed or merged
documentation commit, never from a poller's workspace. A malformed, unsupported, or already-rejected release
cannot advance it. Rollback selects a previously reviewed, checksum-verified documentation commit or opens a new
reviewed change that records the selected older tuple; it never mutates a released source artifact.

### Review and deployment separation

Fetching a valid source release does not publish documentation. A human reviews the rendered documentation diff
and its locked producer tuple through the documentation repository's ordinary review path. Deployment runs only
from the approved, merged documentation commit after rechecking the lock and the repository's own validation; it
does not deploy directly from a source release, a polling workspace, or a producer branch.

`PUBLISH-BLOCKED` remains an unconditional consumer-side deploy stop. Polling may discover and prepare a review
while that marker exists, but no deploy path may remove, bypass, or reinterpret it. The product repository does
not inspect, delete, or otherwise operate the marker. This preserves a clear ownership boundary: the product
tree owns guidance intent and sealed releases; the documentation repository owns rendering, approval, its lock,
and deployment.
