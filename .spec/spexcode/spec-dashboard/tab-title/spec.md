---
title: tab-title
status: active
hue: 190
desc: The browser tab names itself after the backend (its launch folder, or a configured name), so every per-project viewer is self-identifying.
code:
  - spec-cli/src/board.ts
  - spec-cli/src/layout.ts
  - spec-dashboard/src/App.jsx
  - spec-dashboard/index.html
---
# tab-title

The dashboard is a project-agnostic viewer pointed at **one** backend per dev-server (the
[[api-endpoint]] seam), so when several projects each run their own backend the tabs are
otherwise indistinguishable. The tab carries its backend's identity instead: the board
payload exposes `project`, and the frontend sets `document.title` to `<project> · SpexCode`
whenever the board loads. The name re-derives from whichever backend the viewer actually
reached (it rides the same `/api/board` poll), so pointing the same board at a different
`API_URL` re-names the tab.

`project` defaults to the basename of the backend's repo root — its launch folder — which
needs no configuration. A project that wants a hand-picked name sets `dashboard.title` in
its `spexcode.json` (the same per-project config block that holds `dashboard.apiUrl`); when
present it replaces the folder name. Either way the frontend keeps the `· SpexCode` suffix,
so the override names the project, not the whole title.

`index.html` ships a plain `SpexCode` `<title>` as the pre-load fallback — what the tab
reads before the first board arrives, and if the backend is unreachable.
