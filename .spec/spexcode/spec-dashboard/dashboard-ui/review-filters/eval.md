---
scenarios:
  - name: canonical-and-embedded-filters-are-one
    tags: [frontend-e2e, desktop, mobile]
    code: spec-dashboard/src/reviewFilters.js
    description: >-
      Record a real Chromium run against the live dashboard at desktop and 390px. On #/issues and #/evals,
      combine query, section, direct facet, and overflow choices; capture the visible identities and hash,
      drive Back, and open an active facet after its result reaches zero. Then open Spec Information on a
      node with long Issues and Eval panes. Use each compact search and overflow by pointer and keyboard,
      combine filters to a real empty result, clear them, switch away and back, and compare each result to
      the canonical adapter's matching fields. Finally open History, inspect the controls, toggle an older
      row, and use the down gesture to disclose the next row. Repeat the compact interactions at 390px and
      include both themes in the recording. File the dynamic run as video evidence.
    expected: >-
      Canonical and embedded Issues/Evals filtering agree for query, lifecycle/verdict, freshness,
      evidence, author/filer, store, node, and Live wherever those real fields exist. Canonical actions
      remain hash-query history pushes and Back restores their exact view; embedded actions leave the hash
      untouched and survive Spec Information tab switches. Node/scope and every other one-value dimension
      stay absent rather than becoming fake facets. The compact face is one shallow sticky search row plus
      one accessible overflow whose named radio groups, checked focus, arrow/Home/End roving, Escape return,
      active-value off-switch, and filtered-empty copy match the shared review primitives at desktop and
      390px without horizontal overflow in either theme. History has no expand-all control or replacement:
      only row headers and the normal one-at-a-time down gesture disclose older entries.
---

# measuring review-filters

YATU drives the real list routes and Spec Information tabs in one Chromium recording. Pure-function tests
are supporting proof for adapter equivalence and absent-field behavior; they do not replace the browser run.
