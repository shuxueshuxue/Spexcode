---
title: guidance docs contract
status: active
hue: 200
desc: Product-derived Guidance and Reference leave the product repository only as one sealed, versioned docs release; an independent documentation repository verifies, reviews, and deploys that tuple without reading product sources.
code:
  - scripts/docs-release.mjs
related:
  - .github/workflows/docs-release.yml
  - scripts/docs-release.test.mjs
  - scripts/reference-snapshot.mjs
  - .github/workflows/ci.yml
---
# guidance docs contract

## raw source

The product tree remains the source of truth for SpexCode Guidance and Reference. The existing public authored Guide and Blog pages, theme assets, and historical generated Reference stay docs-owned until one verified, immutable product docs release advances the derived content. An independent documentation repository consumes that release without reading or writing a product checkout, and its own review and deployment gates remain explicit.

## expanded spec

[[guide]] owns Guidance content; [[reference-snapshot]] owns deterministic rendering of the `.spec` tree into Reference pages. This node owns their delivery envelope and documentation consumer protocol. The product repository publishes both projections only as one **docs release artifact**, never as a source checkout, branch tip, shared directory, submodule, file-level copy contract, or local-generator instruction. The documentation repository neither reads `guide.ts` nor `.spec`, and it never writes either back. Source changes flow one way through the unified producer.

### Content-preserving migration baseline

Before cutover, the existing public authored English and Chinese Guide and Blog Markdown pages, theme assets, and generated Reference Markdown are imported into the documentation repository as a docs-owned snapshot. The import preserves page and asset bytes without prose rewrites. Its checked-in manifest names every source path and file hash, with category counts for the 16 authored Guide/Blog pages, 3 theme assets, and 239 generated Reference pages; the documentation repository verifies its own checked-in bytes against that manifest.

The consumer never reads a product checkout, source directory, or `.spec` tree. It neither runs the product Reference generator nor retains a product checkout as an input to build, verification, review, or deployment. After import, the migration snapshot belongs to the documentation repository; the product repository does not deploy it or write back to it.

The authored Guide, Blog, and assets remain untouched by a derived-content update. The historical Reference snapshot remains committed and deployed until a valid unified docs release passes consumer verification, rendering, validation, and review; a failed or unavailable candidate leaves it in place. A verified release replaces only `docs/reference` and the Reference navigation derived from the snapshot. A checkout, moving branch or ref, server filesystem copy, or local generator output cannot advance either baseline.

### Sealed docs release

Each publishable release has one immutable identity tuple: a producer release version and exact source Git revision; a Guidance catalog schema and named catalog payload; a Reference snapshot schema and named snapshot payload; the byte length, lowercase SHA-256 digest, and immutable retrieval identity of each payload; and one versioned release manifest naming the full tuple.

The manifest schema is `spexcode.docs-release/v1`; its asset name is `docs-release.json`. A valid manifest has one non-empty producer repository, release, and revision, and exactly the two asset declarations `catalog` and `reference`. Each declaration has a non-empty schema and safe asset name, a non-negative integer byte length, a 64-character lowercase hexadecimal digest, and a GitHub release-asset identity `{ kind, repository, release, asset }` that agrees with the producer. The payloads declare the same source identity, schemas, and asset names as their manifest. The producer creates all three bytes from one committed product revision, publishes them together under that version, and never replaces their bytes in place. A correction is a new versioned tuple, not a mutable re-upload or consumer-lock rewrite.

The digest is over exact downloaded asset bytes before parsing, rendering, or formatting. A release feed may help discover candidates, but it never authorizes a moving `latest` pointer: after discovery every manifest and payload read is pinned to that release's immutable asset identity and verified. The product retains generator inputs and provenance; these artifacts are derived, read-only projections and never editable second sources.

`spexcode.guidance-release/v1`, `guidance-release.json`, and a catalog-only consumer lock are retired contract shapes. Neither producer nor consumer accepts them as a compatibility path: accepting one would permit Guidance to advance without the Reference snapshot. No source release asset reached GitHub under the old shape, so this is a deliberate replacement, not a migration protocol.

### Product producer

`scripts/docs-release.mjs` is the product-side producer. From a clean checkout at supplied `HEAD` revision, it runs the real `spex guidance` export and the [[reference-snapshot]] renderer, writes their exact bytes as `guidance-catalog.json` and `reference-snapshot.json`, and writes `docs-release.json` beside them. The manifest contains `schema: "spexcode.docs-release/v1"`; `producer.repository`, `producer.release`, and `producer.revision`; `catalog.schema`, `catalog.name`, `catalog.bytes`, `catalog.sha256`, and `catalog.retrieval`; and `reference.schema`, `reference.name`, `reference.bytes`, `reference.sha256`, and `reference.retrieval`.

The producer refuses a dirty checkout, revision other than `HEAD`, payload source-identity disagreement, unsafe or duplicate asset names, and any existing destination asset. It derives every size and digest from exact written buffers. It has no documentation-server client, deploy behavior, or writable Guidance/Reference source.

`.github/workflows/docs-release.yml` runs for relevant Guidance, Reference, producer, and hook-prompt registry changes pushed to `main`, and can be manually dispatched to bootstrap the first docs release. Its sole publish job is absent unless repository variable `SPEXCODE_DOCS_RELEASE_PUBLISH` is exactly `true`. That off-by-default gate is at job scope before checkout or credentials. For revision `R`, the release tag is `docs-R`; the workflow either creates that non-latest GitHub release with exactly `docs-release.json`, `guidance-catalog.json`, and `reference-snapshot.json`, or on rerun verifies target revision, complete asset-name set, and downloaded byte equality with the newly generated trio. It never overwrites or clobbers assets. This workflow publishes source artifacts only: it does not deploy documentation, contact a public documentation server, or modify external docs.

### Consumer protocol

The documentation repository configures the producer release feed and catalog and snapshot schemas it accepts. Its poller performs one serialized update attempt.

1. Acquire a consumer-side concurrency lock scoped to documentation repository and producer. The lock covers discovery, download, verification, rendering, and proposal creation, so two pollers cannot propose competing updates for the same source tuple.
2. Read a candidate `docs-release.json`, pin manifest, catalog, and Reference asset identities, and download all three. Refuse it if any schema, provenance, size, payload declaration, immutable identity, or SHA-256 check disagrees. Network, parsing, and verification failures are visible failures; the poller never reuses an older unverified payload as though current.
3. Compare the fully verified tuple with the committed unified consumer lock. An identical tuple is a no-op. A new tuple atomically stages exact catalog and Reference payloads, rendered Guidance, rendered `docs/reference`, derived Reference navigation, and the lock. The lock records producer version and revision plus both schemas, names, byte lengths, digests, and immutable GitHub identities.
4. Run normal documentation validation against staged render, then open or update a review change naming the producer tuple. Polling does not approve content.

The consumer applies verified Reference without a product checkout: it replaces only `docs/reference` and its derived navigation. It preserves migrated Guide, Blog, assets, and Guidance rendering outside their own verified catalog path. The lock is provenance, not a cache hint: review and deploy read it from proposed or merged docs commit, never poller workspace. A malformed, unsupported, old-shape, or rejected release cannot advance it. Rollback selects a previously reviewed, checksum-verified docs commit or opens a reviewed change recording an older full tuple; it never mutates a source artifact.

### Review and deployment separation

Fetching a valid docs release does not publish documentation. A human reviews the rendered documentation diff and locked tuple through the documentation repository's ordinary review path. Deployment runs only from approved, merged documentation commit after rechecking lock and validation; it does not deploy from source release, polling workspace, or producer branch.

`PUBLISH-BLOCKED` remains an unconditional consumer-side deploy stop. Polling may discover and prepare a review while that marker exists, but no deploy path may remove, bypass, or reinterpret it. The product repository does not inspect, delete, or otherwise operate the marker. This preserves the ownership boundary: product owns Guidance/Reference intent and sealed releases; docs owns rendering, approval, one atomic lock, and deployment.
