---
scenarios:
  - name: one-attachment-row-in-both-homes
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      In a real browser drag-select governed source lines and open the send card, then inspect the attachment
      row it carries in the composer's preview slot: the file-diff mark, the address, the inclusive line range,
      and the remove control. Compare that row with the one the New Session seed queue renders for a queued
      selection.
    expected: >-
      Both homes render the same `selection-attachment` row (mark · address · `lines a–b` · one icon-only ✕),
      the ✕ wears the shared quiet icon-button face (no browser-default button box, accessible name present),
      and removing it clears the selection in the card / dequeues one token in the New box — never a second
      chip dialect and never a second dispatch path.
---
# eval.md - selection-attachment

Measured through the real dashboard: the row is product surface in two homes, so a reading comes from the
rendered card, not from the component source.
