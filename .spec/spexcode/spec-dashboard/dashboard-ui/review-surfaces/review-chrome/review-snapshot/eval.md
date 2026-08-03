---
scenarios:
  - name: atomic-review-snapshot
    test: spec-cli/src/reviewSnapshot.test.ts
    tags: [backend-api]
    code: [spec-cli/src/reviewSnapshot.test.ts]
    description: >
      Run the focused review-snapshot test together with graph and paged-review source tests. Publish two
      distinct Issue/Eval generations and inspect the graph projection contract.
    expected: >
      Publication replaces both domains as one whole generation; readers never observe a mixed pair. Graph
      summary tests expose counts only, while the server snapshot retains the row inputs used by pagination.
---

# measuring review-snapshot

The snapshot is process memory with no browser surface. Its focused atomic replacement test is paired with
the Chromium graph-row audit in [[review-chrome]].
