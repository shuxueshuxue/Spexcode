---
scenarios:
  - name: confirm-peels-before-panel
    tags: [frontend-e2e, desktop]
    description: >
      Open the sessions page, right-click a session row, and click Close to raise the close-confirm
      modal over the row context-menu's page. Press Escape ONCE, then a SECOND time. Measure what each
      press closes (never click the red Close — Escape on the confirm cancels it harmlessly).
    expected: >
      The first Escape closes ONLY the confirm modal — never the confirm and the surface beneath it on
      a single press. The second Escape is a page-level no-op: the stack is empty and sessions is a rail
      PAGE, not an overlay — [[side-nav]] demoted Esc to an overlay-closer (pages are peers, not layers),
      so the page stays with its hash untouched; leaving it is navigation (the rail, ⌥digit, or history),
      never Esc. One layer peels per press, topmost first, and with no overlay left the press falls
      through to nothing.
    related:
      - spec-dashboard/src/SessionContextMenu.jsx
  - name: layering-survives-hot-reload
    tags: [frontend-e2e, desktop]
    description: >
      With the close-confirm gesture working, trigger a Vite HMR update to escStack.js (or its importers)
      while the dashboard tab stays open — no page reload — then open the close-confirm again and press Escape.
      This is the deploy-into-an-open-tab path that re-evaluates the module under the live listener.
    expected: >
      Escape still peels ONLY the confirm; the page beneath stays. The hot-swap does not strip the layering — the
      listener and its stack stay one source of truth across the re-eval, never a live listener on a dead copy.
---

# esc-layers — measurement

YATU through the real dashboard in a browser: drive the actual right-click → Close → Escape gesture a
human makes, and watch which surface disappears on each press — never an internal helper. Zero loss is
exactly one layer peeling per Escape, topmost first, and a silent stack once empty (Esc never exits a
page — that vocabulary belongs to [[side-nav]]). The old proof-overlay scenario is retired: [[review-proof]]
was promoted to an always-available inline right-pane tab, so no proof layer floats above the console
anymore.
