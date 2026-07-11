---
scenarios:
  - name: tab-and-board-header-name-the-backend
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard (a real browser pointed at a backend), read `document.title`, the
      session-board left-list header, and the graph HUD brand (the shell-prompt line pinned top-left over
      the node graph) after the first `/api/graph` poll lands. Do it twice: once for a project whose
      `spexcode.json` sets NO `dashboard.title` (so the name defaults to the backend repo root's folder
      basename), and once with `dashboard.title` set in that `spexcode.json`. Also load the raw `index.html`
      (or the page before any board arrives) to see the pre-load fallback.
    expected: >-
      With no configured title, `document.title` is `<folder-basename> · SpexCode`, the board's left list
      header reads `// <folder-basename> {sessions}`, and the HUD brand reads `$ <folder-basename>` (all
      three from the shared `projectTitle` helper). With `dashboard.title` set, they become `<configured-title>
      · SpexCode`, `// <configured-title> {sessions}`, and `$ <configured-title>` — the override names the
      project, the `· SpexCode` suffix stays. Before the first board (or if the backend is unreachable) the
      tab reads the plain `SpexCode` fallback from index.html and the HUD brand shows the plain `spec-dashboard`
      label. Pointing the same board at a different `API_URL` re-derives all three from whichever backend it reached.
    code: spec-dashboard/index.html
    related:
      - spec-dashboard/src/data.js
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SessionInterface.jsx
---
# eval.md — tab-title

Measured through the real rendered dashboard (YATU): load it against a backend and read the actual
`document.title` and the board header the user sees, comparing to the project name the backend reports in
its `/api/graph` `project` field. The loss watched is indistinguishable tabs/headers when several
per-project boards are open at once — every viewer must self-identify which backend it serves, defaulting to
the launch folder and overridable by `dashboard.title`.
