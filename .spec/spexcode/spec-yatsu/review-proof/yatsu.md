---
scenarios:
  - name: proof-renders
    tags: [frontend-e2e, desktop]
    description: >
      Open a session's Eval tab in the console (the right pane's Terminal/Eval pair) in a real browser and
      read the DOM: the gates strip, the row list (blind spots vs measured, in-session vs earlier), where
      evidence bytes load, and the export link. Then follow the `proof ↗` link and check the self-contained
      HTML still renders whole (masthead, gates, evidence inlined, diff drill-down).
    expected: |
      The Eval tab shows the gates strip (lint · merge · ahead · committed, the spex-review numbers) and
      COLLAPSED scenario rows grouped by changed node — blind spots lead with the empty ring, then this
      session's own readings (codeSha ∈ branch commits) newest-first; earlier readings hide behind a count
      chip. NO evidence bytes load with the list (rows are tier-1 JSON; the blob request happens only when
      a row is selected and the shared annotator detail opens). The `proof ↗` link serves the
      self-contained export HTML: derived masthead, gate row, inlined evidence, per-file diff drill-down —
      whole, not garbled.
---
# review-proof loss

YATU through the real console: a session with real changes + readings, the Eval tab read from the live
DOM (rows, gates, request waterfall — the tier check is a NETWORK assertion), and the export artifact
opened as a plain document. Never asserted from the engine code.
