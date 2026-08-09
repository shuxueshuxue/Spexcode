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
      exercise the disabled-by-default predicate and the existing-release validation path.
    expected: >-
      No release job runs without repository variable `SPEXCODE_GUIDANCE_RELEASE_PUBLISH=true`; a publish is scoped
      to a `guidance-<revision>` release, creates only the generated pair, and reruns download and compare both
      assets instead of overwriting them. The workflow contains no documentation deployment or public-docs request.
    code: .github/workflows/guidance-release.yml
    test: scripts/guidance-release.test.mjs
---
Measured through the real product CLI producer and the release workflow's checked publishing contract. The
workflow's remote GitHub write remains intentionally disabled until its repository variable is explicitly enabled.
