---
scenarios:
  - name: prose-only-file-chips
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Through a real browser, open a spec node with governed files and attachments. Capture the settled
      spec document before any chip click, then click a governed chip and inspect the route and tab strip;
      click a second chip, and finally alt-click the file tab. File the before/after screenshots with
      `spex eval add spec-view --scenario prose-only-file-chips --image <png> --pass`.
    expected: >-
      The initial spec document is full-width prose with no `.specview-code`, no automatic source reader,
      no split divider, and no `spex.docSplit` storage key. A chip is a real `#/file/<path>` link: its file
      tab is focused while the spec tab remains in the working set. A second chip changes the same file
      slot rather than stacking a duplicate, and alt-click still sends that file document to the shell's
      second pane. Attachment chips use the `.spec/<node>/<name>` logical file address and remain readable
      through their node-owned API gate.
---
# eval.md - spec-view

Measure the document boundary and file-chip handoff through the real browser. The scenario deliberately
checks the absence of the old split before checking the new address, so a source pane that merely moved
elsewhere cannot pass.
