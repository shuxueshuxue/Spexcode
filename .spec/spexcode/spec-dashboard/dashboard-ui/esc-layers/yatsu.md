---
scenarios:
  - name: confirm-peels-before-panel
    description: >
      Open the session console, right-click a session row, and click Close to raise the close-confirm
      modal over the open panel. Press Escape ONCE, then a SECOND time. Measure what each press closes
      (never click the red Close — Escape on the confirm cancels it harmlessly).
    expected: >
      The first Escape closes ONLY the confirm modal; the session console panel is still open behind it.
      The second Escape closes the panel, returning to the board. One layer peels per press, in reverse
      open order — never the confirm and the panel together on a single press.
    related:
      - spec-dashboard/src/SessionContextMenu.jsx
  - name: proof-peels-before-board
    description: >
      For a session in the review state, open its proof overlay (the cyan proof button or typed /proof) over
      the session console, then press Escape once.
    expected: >
      Escape closes ONLY the proof overlay; the session console behind it stays open. The board does not
      close. (Both faces drive the one overlay, opened from console or typed command.)
    related:
      - spec-dashboard/src/ReviewProof.jsx
---

# esc-layers — measurement

YATU through the real dashboard in a browser: drive the actual right-click → Close → Escape and
proof → Escape gestures a human makes, and watch which surface disappears on each press — never an
internal helper. Zero loss is exactly one layer peeling per Escape, topmost first.
