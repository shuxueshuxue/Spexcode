---
scenarios:
  - name: confirm-peels-before-panel
    tags: [frontend-e2e, desktop]
    description: >
      Open the session console, right-click a session row, and click Close to raise the close-confirm
      modal over the open panel. Press Escape ONCE, then a SECOND time. Measure what each press closes
      (never click the red Close — Escape on the confirm cancels it harmlessly).
    expected: >
      The first Escape closes ONLY the confirm modal; the session console panel is still open behind it —
      never the confirm and the panel together on a single press. The second Escape is a page-level no-op:
      since [[side-nav]] demoted Esc to an overlay-closer (Esc routes nothing — pages are peers, not
      layers), the session page stays at #/sessions/<id> with the panel open; leaving it is navigation
      (the rail, ⌥digit, or history), never Esc. One layer peels per press, and with no overlay left the
      press falls through to nothing.
    related:
      - spec-dashboard/src/SessionContextMenu.jsx
  - name: layering-survives-hot-reload
    tags: [frontend-e2e, desktop]
    description: >
      With the close-confirm gesture working, trigger a Vite HMR update to escStack.js (or its importers)
      while the dashboard tab stays open — no page reload — then open the close-confirm again and press Escape.
      This is the deploy-into-an-open-tab path that re-evaluates the module under the live listener.
    expected: >
      Escape still peels ONLY the confirm; the panel stays. The hot-swap does not strip the layering — the
      listener and its stack stay one source of truth across the re-eval, never a live listener on a dead copy.
  - name: proof-peels-before-board
    tags: [frontend-e2e, desktop]
    description: >
      For a session in the review state, open its proof overlay (the cyan proof button or typed /proof) over
      the session console, then press Escape once.
    expected: >
      Escape closes ONLY the proof overlay; the session console behind it stays open. The board does not
      close. (Both faces drive the one overlay, opened from console or typed command.)
    related:
      - spec-dashboard/src/SessionEval.jsx
---

# esc-layers — measurement

YATU through the real dashboard in a browser: drive the actual right-click → Close → Escape and
proof → Escape gestures a human makes, and watch which surface disappears on each press — never an
internal helper. Zero loss is exactly one layer peeling per Escape, topmost first.
