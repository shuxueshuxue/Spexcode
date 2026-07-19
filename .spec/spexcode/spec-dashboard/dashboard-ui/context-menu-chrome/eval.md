---
scenarios:
  - name: session-menu-compact-icon-chrome
    tags: [frontend-e2e, desktop]
    description: >
      In the running dashboard, open Sessions and right-click a live row. Screenshot the complete menu and
      inspect its real DOM/computed styles: labels and icons, row/font/icon sizes, groups, separator, hover
      and keyboard-focus states, danger treatment, and viewport bounds. Repeat on an offline or queued row.
    expected: |
      Every visible action keeps its text beside a small monochrome linear registry icon; there is no emoji
      or component-local SVG. Type is restrained, rows are compact but tappable, and the longest label fits.
      A hairline separator isolates the danger-tinted close action. Theme tokens skin the surface and states,
      focus is visible, and hiding attach on a non-live row leaves no dangling separator.
    related: spec-dashboard/src/SessionContextMenu.jsx
  - name: node-menu-compact-icon-chrome
    tags: [frontend-e2e, desktop]
    description: >
      On the running graph, right-click a spec node with a session overlay and screenshot the complete menu.
      Inspect the four fixed verbs, destructive boundary, overlay-session group, icons, typography, hover,
      focus, and viewport bounds; then repeat on a node without an overlay.
    expected: |
      The node menu uses the exact same compact icon-led row geometry as the session menu. Fixed verbs carry
      semantic registry icons, delete is separated and danger-tinted, and overlay sessions form a final group
      with their existing status glyphs. A node without overlays has no empty final group or dangling divider.
      Fixed command text fits; long session headlines ellipsize without overflow. No emoji or one-off SVG
      appears, and theme-native hover/focus states stay readable.
    related: spec-dashboard/src/NodeContextMenu.jsx
---

# context-menu-chrome — YATU

Measure through the real browser surface a user right-clicks. Computed geometry and DOM structure are
auxiliary readings; the screenshot of the fully rendered menu is the static product evidence.
