---
scenarios:
  - name: server-page-contract
    tags: [backend-api]
    test: spec-cli/src/reviews.test.ts
    code: [spec-cli/src/reviews.test.ts]
    description: >
      Run the paged-review source/unit contract: full-set counts/facets before a 25-item slice, stable
      revisions, GitHub overflow semantics, and the common trunk/scoped Eval item vocabulary.
    expected: >
      Every test passes. A response never exceeds 25 items; totals/counts/facets remain full-population;
      page 41 and 999999 stay requested with empty items and continuing prev/next; unchanged snapshots keep
      one revision; trunk and scoped Evals produce the same tagged row shape.
---

# measuring paged-review

The pure server operation is measured here. The HTTP and browser proof that response bytes contain only the
current page is measured through [[review-chrome]]'s product-level pagination scenario.
