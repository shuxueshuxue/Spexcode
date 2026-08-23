---
scenarios:
  - name: retired-session-multi-select-surface
    tags: [frontend-e2e]
    test:
      path: spec-dashboard/src/subtractive-boundaries.test.mjs
      name: withdrawn session multi-select surface stays absent
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/SessionContextMenu.jsx, spec-dashboard/src/subtractive-boundaries.test.mjs]
    description: >
      Inspect the current session console contract and its focused regression assertions after the former
      duplicate session-list surface was withdrawn.
    expected: >
      The current dashboard has no SessionSelectBar, select-mode state, row checkboxes, or bulk-close
      lifecycle endpoint, and the retired component/E2E entry-point paths remain absent. Single-session close
      and the dock-owned row actions remain the only current lifecycle controls; a future batch-selection
      feature must introduce a new spec and scenario.
---

# session-multi-select - retired measurement

The former multi-select, bulk-close, row-reparent, and nested-count measurements described a withdrawn
session-list surface and must not be run against the current dashboard. The one scenario above is a narrow
regression assertion for that absence; it is not a product workflow.

The historical readings remain in `evals.ndjson` as an audit trail for the retired implementation. A future explicit
selection mode belongs to a new current spec and a new eval contract; it must not revive these scenario names.
