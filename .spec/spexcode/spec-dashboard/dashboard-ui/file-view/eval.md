---
scenarios:
  - name: addressable-governed-and-node-files
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Open one governed file from a spec chip and one node attachment from its attachment chip through the
      real browser. Read both file tabs, record their hashes and rendered bytes, and inspect the backend
      requests that supplied their windows.
    expected: >-
      Both arrive as FileView documents in the `#/file/<path>` address family. Governed paths use the source
      reader's policy; `.spec/<node>/<name>` attachment paths use the node-owned attachment endpoint without
      weakening that policy. The tab identity is the address, so re-opening a path activates the existing
      file tab and no duplicate reader is mounted.
---
# eval.md - file-view

Measure both file address families through the real browser and their backend window readers. The route is
the identity; FileView is the one reader for either source gate.
