---
title: tab-title
status: active
hue: 190
desc: The project's self-identifying name (a configured dashboard.title, else the backend's launch folder) names the browser tab and the session-board list header, so every per-project viewer shows which backend it serves.
code:
  - spec-dashboard/index.html
related:
  - spec-cli/src/graph.ts
  - spec-cli/src/layout.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/SessionInterface.jsx
---
# tab-title

The dashboard is a project-agnostic viewer pointed at **one** backend per dev-server (the
[[api-endpoint]] seam), so when several projects each run their own backend the tabs are
otherwise indistinguishable. The tab carries its backend's identity instead: the board
payload exposes `project`, and the frontend sets `document.title` to `<project> · SpexCode`
whenever the board loads. The name re-derives from whichever backend the viewer actually
reached (it rides the same `/api/graph` poll), so pointing the same board at a different
`API_URL` re-names the tab.

`project` defaults to the basename of the backend's repo root — its launch folder — which
needs no configuration. A project that wants a hand-picked name sets `dashboard.title` in
its `spexcode.json` (the same per-project config block that holds `dashboard.apiUrl`); when
present it replaces the folder name. Either way the frontend keeps the `· SpexCode` suffix,
so the override names the project, not the whole title.

That name is read through a single frontend helper, `projectTitle(board)`, so any surface
that needs to say *which* project shares one source rather than re-deriving it. The **session
board**'s left-hand list header reuses it: the translated `// {sessions}` header ([[settings]])
gains the project name as `// <project> {sessions}`, self-identifying the board the way the tab
self-identifies the window — the same payoff when several project boards sit open at once. With no
name resolved it falls back to the plain translated header. The **graph HUD brand** — the shell-prompt
line pinned top-left over the node graph — reuses it too, reading `$ <project>` from the same helper so
the on-canvas identity matches the tab and board rather than a hardcoded package name; before the first
board loads it falls back to the plain `spec-dashboard` label.

`index.html` ships a plain `SpexCode` `<title>` as the pre-load fallback — what the tab
reads before the first board arrives, and if the backend is unreachable.

The `project` field is tab-title's only stake in `graph.ts`: it is produced by the shared `buildBoard`
([[sessions]]), which also assembles the tree and the session list and carries sibling per-node folds
([[dashboard-issues]] issues, [[eval-tab]] evals). A change there that leaves the `project`
derivation untouched — e.g. adding the eval fold — is that feature's stake, not tab-title's drift.
