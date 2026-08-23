# Desktop and Dashboard Plugin Decision

Status: deferred, explicitly not a current product commitment.

This checkpoint records the decision for inherited items 1.5, 2.2, and 2.3. It is a boundary
record, not an implementation claim.

## Dashboard plugin extensibility (1.5)

- **Decision:** deferred/non-goal for this release.
- **What exists:** `.spec/spexcode/plugin-system/` defines SpexCode's reflexive agent/dev-flow
  plugin surfaces (`system`, `command`, `hook`, `skill`, `agent`, and `review`). The shipped
  instances are discovered through the plugin roots and `/api/plugins`.
- **What does not exist:** a dashboard view/plugin registry. `spec-dashboard/src/views.jsx`
  still owns a compile-time `VIEWS` object; there is no public `registerView` or equivalent
  runtime extension contract.
- **Reason:** adding a registry would widen the dashboard routing and packaging contract. No
  consumer, lifecycle, isolation, or compatibility policy has been approved for that scope.
- **Re-entry condition:** define the registry owner, discovery and ordering rules, lifecycle and
  failure behavior, and a real browser proof before changing this decision.

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
