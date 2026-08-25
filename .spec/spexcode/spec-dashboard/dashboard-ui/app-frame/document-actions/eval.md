---
scenarios:
  - name: session-actions-live-in-shell-slot
    tags: [frontend-e2e, desktop]
    description: >-
      Through a real Chromium dashboard backed by a live graph, open a session document and inspect
      the rendered tab row, its right-edge action slot, and the session menu. Press Alt+I to open the
      Command Box, type `/mer`, inspect the resolved command source, then navigate to a spec document and
      inspect the same shell row.
    expected: >-
      The session document has no `.si-tabbar`, `.si-toolbar`, or `.si-tool` chrome. Its tab row owns
      one `.tabstrip-actions` slot holding the document's whole action set: the resource picker, the Eval
      door, the surface and diff switches, the available lifecycle actions, and Command Box — while
      rename/close live on the tab's context menu, not in the slot. Merge has no action button or disabled
      witness in any lifecycle state; `/merge` appears once as a `[preset]` and inserts the agent workflow
      token. The slot's members are not all buttons: the Eval door is a real
      anchor drawn by the document itself, and it must still match the slot's control height, so the row
      reads as one band. The slot disappears on a spec document, while the shell tab row remains. Alt+I
      opens the Command Box through the console keyboard scope. Settled screenshots show the terminal or
      timeline directly below the one tab row.
    code: [spec-dashboard/src/documentActions.jsx, spec-dashboard/src/TabStrip.jsx, spec-dashboard/src/SessionInterface.jsx]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
---
# document-actions — measurement

Measure through the running dashboard in a real desktop browser (YATU). File the settled session and
spec screenshots plus the DOM assertions from `session-toolbar.e2e.mjs` with `spex eval add`.
