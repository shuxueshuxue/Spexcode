---
scenarios:
  - name: drag-persists-width
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >
      Open the session console in a real browser with no stored width. Measure the session list, drag its
      divider ~120px rightward, reload, then double-click the divider and measure again.
    expected: >
      The initial width is 204px. Dragging visibly widens it within the 180–480px clamp and the widened width
      survives reload. Double-click returns it to 204px and clears the persisted override, matching the
      familiar editor-sash reset convention.
    code: [spec-dashboard/src/useResizable.js]
---
# resizable-panes — measurement

YATU: a real mouse-down/move/up sequence in a headless browser over the running dashboard, reading the
pane's `getBoundingClientRect().width` before/after/after-reload — never a unit test of the hook. File
with `spex yatsu eval resizable-panes --scenario drag-persists-width --image <png> --pass|--fail`.
