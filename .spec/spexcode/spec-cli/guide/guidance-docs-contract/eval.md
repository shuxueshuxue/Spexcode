---
scenarios:
  - name: sealed-docs-release-emission
    tags: [cli]
    description: >-
      From a clean committed checkout, run the product docs-release producer with the current repository,
      revision-derived release tag, and a temporary output directory. Parse all three generated JSON files and hash
      both payload files as bytes.
    expected: >-
      The exact `spex guidance` payload and deterministic Reference snapshot agree with adjacent `docs-release.json`
      on source revision, schemas, and payload names. The manifest names producer repository/release/revision and
      each payload's byte length, lowercase SHA-256, and GitHub release-asset retrieval identity matches its exact
      bytes. A dirty or mismatched revision and pre-existing output asset fail loud rather than creating a partial
      or ambiguous tuple.
    code: scripts/docs-release.mjs
    test: scripts/docs-release.test.mjs
  - name: disabled-immutable-github-publishing
    tags: [cli]
    description: >-
      Inspect the docs release workflow and its focused test, then use the test's workflow fixture checks to
      exercise the disabled-by-default predicate, the eligible-push filter, the manual bootstrap trigger, and the
      existing-release validation path.
    expected: >-
      No release job runs without repository variable `SPEXCODE_DOCS_RELEASE_PUBLISH=true`; eligible product-source
      pushes to `main` retain their path filter, and a manual dispatch can bootstrap the first release without a
      later content change. A publish is scoped to a `docs-<revision>` release, creates only the manifest, catalog,
      and Reference snapshot, and reruns download and compare all three assets instead of overwriting them. The
      workflow contains no documentation deployment or public-docs request.
    code: .github/workflows/docs-release.yml
    test: scripts/docs-release.test.mjs
  - name: content-preserving-docs-migration-baseline
    tags: [cli]
    code: .spec/spexcode/spec-cli/guide/guidance-docs-contract/spec.md
    description: >-
      At the reviewed external documentation-consumer migration change, run its normal Verify command and strict
      MkDocs build. Inspect the checked-in snapshot manifest and consumer contract, comparing the declared paths,
      SHA-256 hashes, and category counts directly with the verified migration result.
    expected: >-
      Verification passes for 258 of 258 declared files: 16 public authored English and Chinese Guide/Blog Markdown
      pages, 3 theme assets, and 239 generated Reference Markdown pages. The unified consumer reads only verified
      release assets, never a product checkout or `.spec` tree; its atomic update replaces only `docs/reference`
      and derived Reference navigation while preserving authored pages, theme assets, and Guidance rendering.
---
Measured through the real product CLI producer and the release workflow's checked publishing contract. The workflow's
remote GitHub write remains intentionally disabled until its repository variable is explicitly enabled. The
migration-baseline scenario measures the reviewed documentation consumer through its normal verification and strict
MkDocs build; it does not operate a product checkout or deployment.
