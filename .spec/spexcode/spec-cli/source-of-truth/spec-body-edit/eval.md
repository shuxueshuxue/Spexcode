---
scenarios:
  - name: popup-body-edit-send-direct-create
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Through the real dashboard, select a body range in the node information popup and choose Edit & Send
      with a new session target. Inspect the created session's first prompt and the settled popup/session
      screenshots.
    expected: >-
      The selected body range is encoded as one code-selection attachment in the initial create request,
      the returned session opens immediately, and no empty launch composer or second send is required.
---
# eval.md - spec-body-edit

Measure the board's human body-edit dispatch lane at the popup surface, including the direct new-session
creation path and its lossless selected-range attachment.
