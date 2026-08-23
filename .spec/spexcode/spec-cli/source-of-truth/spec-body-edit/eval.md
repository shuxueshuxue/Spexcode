---
scenarios:
  - name: body-edit-preconditions-refuse-stale-region
    tags: [backend-api]
    test: spec-cli/src/spec-body-edit.test.ts
    description: >-
      Exercise the body-edit writer's request and stale-region guards against the real spec-body module.
    expected: >-
      Invalid ranges are refused before a write, and a region whose source moved is rejected with the
      current body text instead of being merged or guessed.
---
# eval.md - spec-body-edit

Measure the governed body-edit writer's refusal boundary before the board's Edit Manually action commits a
replacement.
