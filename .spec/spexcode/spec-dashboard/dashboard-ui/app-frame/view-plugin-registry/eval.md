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
  - name: built-in-settings-plugin-consumer
    description: >
      Install the dashboard's settings extension descriptor into an isolated registry, then inspect the
      product startup source that installs the same descriptor into the live registry.
    expected: >
      Settings is owned by the dashboard-settings plugin with its canonical resident workspace metadata,
      while the product startup invokes registerPlugin and does not seed settings into the core view map.
    tags: [frontend-e2e]
    test: spec-dashboard/src/viewRegistry.test.mjs
    code: [spec-dashboard/src/builtInViewPlugins.js, spec-dashboard/src/views.jsx, spec-dashboard/src/viewRegistry.test.mjs]
---

Measure the registry contract with the focused dashboard test. This is an auxiliary contract check for the
extension seam; browser surface and routing proof remains covered by [[view-registry]]'s address scenario.
