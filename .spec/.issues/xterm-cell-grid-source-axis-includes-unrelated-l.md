---
concern: xterm cell-grid source axis includes unrelated live-view selection patch
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: xterm-cell-grid, live-view
created: 2026-08-10T12:55:59.981Z
---

Spec: xterm-cell-grid, live-view

`xterm-cell-grid` directly governs the whole `spec-dashboard/scripts/patch-xterm-sync-resize.mjs`, but commit `31edc24319` added `shouldForceSelection() => true` patches for the live-view mouse-delivery contract. That changes pointer/report routing, not the cell-box geometry xterm-cell-grid owns; nevertheless spec lint marks xterm-cell-grid drifted.

Do not acknowledge this as a cell-grid contract change. Split the installer source into named, independently anchorable patch groups (or an equivalently narrow structural boundary) so the renderer-cell owner tracks only its DOM-width patches and live-view tracks its mouse-selection patches. Preserve ordered idempotent installation and the current exact upstream-shape loud failure. Verify with existing patch/install tests plus the relevant real-browser live-view evidence before filing any fresh claim.
