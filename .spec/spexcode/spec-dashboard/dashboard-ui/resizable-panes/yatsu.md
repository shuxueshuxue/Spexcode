---
scenarios:
  - name: drag-persists-width
    tags: [frontend-e2e, desktop]
    description: >
      Open the session board page in a real browser. Measure the session list's width, then mouse-drag
      its divider ~120px rightward and measure again; reload the page and measure a third time.
    expected: >
      The list visibly widens with the drag (second reading ≈ first + drag distance, within the clamp),
      and the widened width survives the reload (third reading ≈ second). Zero loss = the divider drags,
      clamps, and persists.
    code: [spec-dashboard/src/useResizable.js]
---
# resizable-panes — measurement

YATU: a real mouse-down/move/up sequence in a headless browser over the running dashboard, reading the
pane's `getBoundingClientRect().width` before/after/after-reload — never a unit test of the hook. File
with `spex yatsu eval resizable-panes --scenario drag-persists-width --image <png> --pass|--fail`.
