---
scenarios:
  - name: deterministic-index-export
    tags: [cli, backend-api]
    description: >-
      Run the real `spex guidance` CLI twice in the same checkout and GET `/api/guidance` from the backend. Parse
      the JSON and compare the two CLI bytes with the backend object, including schemaVersion, sorted entries, and
      bundleHash.
    expected: >-
      Both CLI runs are byte-identical; the API object is equivalent; schemaVersion is present, bundleHash is a
      SHA-256 over the canonical payload, entries are stable-sorted, every source has a repo-relative path, hash,
      and revision, and no entry has a guidance body or generated timestamp.
    code: spec-cli/src/guidance-catalog.ts
    related: [spec-cli/src/index.ts, spec-cli/src/cli.ts]
  - name: active-surface-and-help-coverage
    tags: [cli]
    description: >-
      Build an independent inventory of active plugin nodes and the registered help/guide keys, then run
      `spex guidance --json` through the real CLI and inspect the catalog entries.
    expected: >-
      Every active plugin surface is represented (one row per declared surface, including hook/skill/agent/review),
      every help command and guide topic is represented, and each row points to the existing authoritative source
      path with a matching content hash. Pending plugins are absent.
    code: spec-cli/src/guidance-catalog.ts
    related: [spec-cli/src/specs.ts, spec-cli/src/help.ts, spec-cli/src/guide.ts]
  - name: catalog-does-not-copy-guidance
    tags: [cli]
    description: >-
      Inspect the serialized `spex guidance` bundle and the typed catalog entries, then compare their keys with the
      source loader output.
    expected: >-
      The bundle contains only catalog metadata and provenance (no `body`, `prompt`, or duplicated prose fields);
      changing an authoritative plugin/help/guide source changes its content hash and bundleHash on the next export,
      while the catalog's entry shape remains unchanged.
    code: spec-cli/src/guidance-catalog.ts
    related: [spec-cli/src/guidance-catalog.test.ts]
---
Measured through the real CLI and backend route (YATU). Source inspection and unit assertions only support the
product readings; the export itself is the evidence surface.
