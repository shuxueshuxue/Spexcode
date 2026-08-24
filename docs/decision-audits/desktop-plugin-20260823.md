# Desktop and Dashboard Plugin Decision

Status: bounded dashboard seam landed; external plugin ecosystem and packaged desktop remain deferred.

This checkpoint records the decision for inherited items 1.5, 2.2, and 2.3. It is a boundary
record, not an implementation claim.

## Dashboard plugin extensibility (1.5)

- **Decision:** the in-product view-extension seam is implemented and governed; external discovery,
  loading, isolation, and lifecycle remain deferred/non-goals for this release.
- **What exists:** `.spec/spexcode/plugin-system/` defines SpexCode's reflexive agent/dev-flow
  plugin surfaces (`system`, `command`, `hook`, `skill`, `agent`, and `review`). The shipped
  instances are discovered through the plugin roots and `/api/plugins`.
- **What exists in the dashboard:** `spec-dashboard/src/viewRegistry.js` owns the runtime
  extension boundary. `registerView`/`registerPlugin` validate lowercase names and component
  definitions before mutation, reject collisions, track owners, and unregister only views owned
  by the plugin. `spec-dashboard/src/builtInViewPlugins.js` registers Settings through that same
  seam; its route, resident-tab, rail, icon, and surface metadata remain shell-owned. Focused
  registry coverage is `23/23` on the current main line, including lazy component acceptance,
  atomic failure, collision, ownership, unregister, and route-contract checks.
- **What does not exist by design:** a dashboard-side external discovery/loader protocol,
  sandbox/isolation promise, version negotiation, or plugin lifecycle beyond explicit in-process
  registration and unregister. The view registry is an extension seam, not a second router.
- **Re-entry condition:** a future product decision must name the external source, ordering,
  lifecycle/failure semantics, isolation, and compatibility policy before adding any loader or
  browser-facing registration door.

## Desktop product and web coexistence (2.2/2.3)

- **Decision:** deferred/non-goal for this release; keep the existing shell as a measured spike.
- **What exists:** `spec-desktop/` wraps `spex serve` plus the dashboard in an Electron window.
  The current spec deliberately keeps it outside root workspaces so normal contributors do not
  install Electron, and documents Linux cgroup containment plus unsupported Windows/macOS
  containment.
- **What does not exist:** a release product. There is no root workspace integration, installer or
  signed artifact, electron-builder/forge pipeline, publish inclusion, or cross-platform process
  containment proof.
- **Reason:** shipping a desktop product would create packaging, update, signing, and process
  ownership obligations beyond the browser+CLI product. The current implementation must remain a
  packaging of that existing path, not a second feature surface.
- **Re-entry condition:** approve a distribution target and support matrix, then add packaging,
  update/signing, crash/reap, and web/desktop parity gates before promoting the spec from `pending`.

## Current product-level evidence

Measured against the shared dashboard at `http://127.0.0.1:5199` on 2026-08-23:

- `band-budget.e2e.mjs`: 32/32 visited states pass; theorem `3 <= B <= 5` holds over 72
  enumerated states; tab strips exercised 2 and 3 rows while remaining one band.
- `keep-alive.e2e.mjs`: 7/7 checks pass; warm-switch worst case 145 ms; six-pane idle script
  cost is 0.0152 s per 10 s (budget 0.05 s), and 0.0251 s with a hidden live session.

Raw JSON and screenshots are filed in the session evidence directory
`desktop-plugin-decision-20260823` (band-budget and keep-alive subdirectories). These measurements
support the current browser shell and CPU/band contracts; they do not promote either deferred
decision to implemented scope.
