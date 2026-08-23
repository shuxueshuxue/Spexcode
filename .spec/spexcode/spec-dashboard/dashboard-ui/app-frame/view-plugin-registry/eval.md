---
scenarios:
  - name: plugin-registration-contract
    description: >
      Run the dashboard view-registry contract test with a core view and a plugin view, then exercise
      duplicate-name rejection, invalid definitions, and plugin removal.
    expected: >
      The core view remains owned by core, the plugin view is discoverable through the same registry,
      invalid or colliding registrations leave no partial entries, and removal deletes only plugin-owned views.
    tags: [frontend-e2e]
    test: spec-dashboard/src/viewRegistry.test.mjs
    code: [spec-dashboard/src/viewRegistry.js, spec-dashboard/src/viewRegistry.test.mjs]
---

Measure the registry contract with the focused dashboard test. This is an auxiliary contract check for the
extension seam; browser surface and routing proof remains covered by [[view-registry]]'s address scenario.
