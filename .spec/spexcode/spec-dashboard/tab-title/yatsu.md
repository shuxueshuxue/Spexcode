---
scenarios:
  - name: tab-and-board-header-name-the-backend
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard (a real browser pointed at a backend), read `document.title` and the
      session-board left-list header after the first `/api/board` poll lands. Do it twice: once for a
      project whose `spexcode.json` sets NO `dashboard.title` (so the name defaults to the backend repo
      root's folder basename), and once with `dashboard.title` set in that `spexcode.json`. Also load the
      raw `index.html` (or the page before any board arrives) to see the pre-load fallback.
    expected: >-
      With no configured title, `document.title` is `<folder-basename> · SpexCode` and the board's left
      list header reads `// <folder-basename> {sessions}` (the translated header gains the project name).
      With `dashboard.title` set, both become `<configured-title> · SpexCode` and `// <configured-title>
      {sessions}` — the override names the project, the `· SpexCode` suffix stays. Before the first board
      (or if the backend is unreachable) the tab reads the plain `SpexCode` fallback shipped in index.html.
      Pointing the same board at a different `API_URL` re-derives the name from whichever backend it reached.
    code: spec-dashboard/index.html
    related:
      - spec-dashboard/src/data.js
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SessionInterface.jsx
---
# yatsu.md — tab-title

Measured through the real rendered dashboard (YATU): load it against a backend and read the actual
`document.title` and the board header the user sees, comparing to the project name the backend reports in
its `/api/board` `project` field. The loss watched is indistinguishable tabs/headers when several
per-project boards are open at once — every viewer must self-identify which backend it serves, defaulting to
the launch folder and overridable by `dashboard.title`.
