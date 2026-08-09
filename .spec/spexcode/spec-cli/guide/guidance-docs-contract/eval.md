---
scenarios:
  - name: sealed-guidance-release-emission
    tags: [cli]
    description: >-
      From a clean committed checkout, run the product guidance-release producer with the current repository,
      revision-derived release tag, and a temporary output directory. Parse both generated JSON files and hash the
      catalog file as bytes.
    expected: >-
      The exact `spex guidance` payload and adjacent `guidance-release.json` agree on source revision, catalog
      schema, and catalog asset name; the manifest names the producer repository/release/revision and its byte
      length, lowercase SHA-256, and GitHub release-asset retrieval identity match the downloaded-byte candidate.
      A dirty or mismatched revision and pre-existing output asset fail loud rather than creating an ambiguous tuple.
    code: scripts/guidance-release.mjs
    test: scripts/guidance-release.test.mjs
  - name: disabled-immutable-github-publishing
    tags: [cli]
    description: >-
      Inspect the guidance release workflow and its focused test, then use the test's workflow fixture checks to
      exercise the disabled-by-default predicate, the eligible-push filter, the manual bootstrap trigger, and the
      existing-release validation path.
    expected: >-
      No release job runs without repository variable `SPEXCODE_GUIDANCE_RELEASE_PUBLISH=true`; eligible
      guidance-source pushes to `main` retain their path filter, and a manual dispatch can bootstrap the first
      release without a later content change. A publish is scoped to a `guidance-<revision>` release, creates only
      the generated pair, and reruns download and compare both assets instead of overwriting them. The workflow
      contains no documentation deployment or public-docs request.
    code: .github/workflows/guidance-release.yml
    test: scripts/guidance-release.test.mjs
  - name: content-preserving-docs-migration-baseline
    tags: [cli]
    code: .spec/spexcode/spec-cli/guide/guidance-docs-contract/spec.md
    description: >-
      At the reviewed external documentation-consumer migration change, run its normal Verify command and strict
      MkDocs build. Inspect the checked-in snapshot manifest and consumer contract, comparing the declared paths,
      SHA-256 hashes, and category counts directly with the verified migration result.
    expected: >-
      Verification passes for 258 of 258 declared files: 16 public authored English and Chinese Guide/Blog Markdown
      pages, 3 theme assets, and 239 generated Reference Markdown pages. The consumer reads only its checked-in
      docs-owned snapshot, never a product checkout or `.spec` tree, and the baseline admits an advance only from a
      reviewed immutable producer snapshot. No automatic Reference producer snapshot protocol is claimed or used.
---
Measured through the real product CLI producer and the release workflow's checked publishing contract. The
workflow's remote GitHub write remains intentionally disabled until its repository variable is explicitly enabled.
The migration-baseline scenario measures the reviewed documentation consumer through its normal verification and
strict MkDocs build; it does not operate a product checkout, deployment, or future Reference producer protocol.
