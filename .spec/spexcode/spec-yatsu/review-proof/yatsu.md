---
scenarios:
  - name: proof-renders
    description: >
      With a session in the review state, open its proof — via the dashboard proof action
      (the overlay) or by loading GET /api/sessions/:id/proof in a browser, or the file
      `spex review proof --out` writes. Check the self-contained HTML renders: the authored
      claim as the masthead, the gates checklist, and per changed node its yatsu evidence
      (verdict badge + the inlined screenshot/transcript), with a frontend node lacking a
      yatsu.md shown as an honest blind spot rather than omitted.
    expected: >
      One coherent dark proof document: a masthead with the claim + session/branch, a gate
      row (typecheck · lint · conflict · ahead), and an evidence section grouping the diff by
      node, each measured scenario showing its verdict and inlined evidence. Assets are
      data-URIs so no image is broken; layout is whole, not empty or garbled.
---
# review-proof yatsu

YATU: measure through the real product surface — load the rendered proof in a browser (the dashboard
overlay, the `/api/sessions/:id/proof` route directly, or the file `spex review proof --out` writes) and
look at it. The reading's evidence is a screenshot of that rendered page; the verdict compares it to the
`expected` whole-document shape above.
