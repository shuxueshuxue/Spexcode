---
scenarios:
  - name: tab-and-board-header-name-the-backend
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard (a real browser pointed at a backend), read `document.title` and the
      graph HUD brand (the shell-prompt line pinned top-left over the node graph) after the first
      `/api/graph` poll lands. Do it twice: once for a project whose `spexcode.json` sets NO
      `dashboard.title` (so the name defaults to the backend repo root's folder basename), and once with
      `dashboard.title` set. Also load the page with the backend unreachable to see the pre-board
      fallback, and with a board that carries no project name to see the HUD's own fallback label.
    expected: >-
      With no configured title, `document.title` is `<folder-basename> · SpexCode` and the HUD brand
      reads `$ <folder-basename>` (both from the shared `projectTitle` helper). With `dashboard.title`
      set, they become `<configured-title> · SpexCode` and `$ <configured-title>` — the override names
      the project, the `· SpexCode` suffix stays. Before any board (or with the backend unreachable —
      the fail-loud panel showing) the tab reads the plain `SpexCode` fallback from index.html; a board
      that arrives without a project name mounts the HUD with its plain `spec-dashboard` label.
      Pointing the same board at a different `API_URL` re-derives title and brand from whichever
      backend it reached.
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
