---
scenarios:
  - name: session-actions-live-in-shell-slot
    tags: [frontend-e2e, desktop]
    description: >-
      Through a real Chromium dashboard backed by a live graph, open a session document and inspect
      the rendered tab row, its right-edge action slot, the merge disabled state, and the session menu.
      Press Alt+I to open the Command Box, then navigate to a spec document and inspect the same shell row.
    expected: >-
      The session document has no `.si-tabbar`, `.si-toolbar`, or `.si-tool` chrome. Its tab row owns
      one `.tabstrip-actions` slot containing the resource picker, session menu, and merge action; an
      unavailable merge exposes the exact reason in its accessible label. The slot disappears on a spec
      document, while the shell tab row remains. Alt+I opens the Command Box through the console keyboard
      scope. Settled screenshots show the terminal or timeline directly below the one tab row.
    code: [spec-dashboard/src/documentActions.jsx, spec-dashboard/src/TabStrip.jsx, spec-dashboard/src/SessionInterface.jsx]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
---
# document-actions — measurement

Measure through the running dashboard in a real desktop browser (YATU). File the settled session and
spec screenshots plus the DOM assertions from `session-toolbar.e2e.mjs` with `spex eval add`.
