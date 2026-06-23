---
scenarios:
  - name: proof-renders
    description: >
      With a session in the review state, open its proof — via the dashboard proof action
      (the overlay) or by loading GET /api/sessions/:id/proof in a browser, or the file
      `spex review proof --out` writes. Check the self-contained, fully-derived HTML renders:
      a masthead headline derived from the node/branch, the gates checklist, and per changed
      node its yatsu evidence (verdict badge + the inlined screenshot/transcript), with a
      frontend node lacking a yatsu.md shown as an honest blind spot. Then DRILL a changed
      file (spec.md included): its row expands to the coloured unified diff, and a further
      toggle shows the full original ↔ new content side by side.
    expected: >
      One coherent dark proof document with no agent-authored content: a masthead with the
      derived node/branch headline + session/commits, a gate row (typecheck · lint · conflict
      · ahead), and an evidence section grouping the diff by node, each measured scenario
      showing its verdict and inlined evidence. Each changed file expands to its unified diff
      (additions green, deletions red) and further to the full before/after comparison. Assets
      are data-URIs so no image is broken; layout is whole, not empty or garbled.
---
# review-proof yatsu

YATU: measure through the real product surface — load the rendered proof in a browser (the dashboard
overlay, the `/api/sessions/:id/proof` route directly, or the file `spex review proof --out` writes) and
look at it. The reading's evidence is a screenshot of that rendered page; the verdict compares it to the
`expected` whole-document shape above.
