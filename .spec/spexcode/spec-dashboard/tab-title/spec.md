---
title: tab-title
status: active
hue: 190
desc: The browser tab names itself after the backend's launch folder, so every per-project viewer is self-identifying.
code:
  - spec-cli/src/board.ts
  - spec-dashboard/src/App.jsx
  - spec-dashboard/index.html
---
# tab-title

The dashboard is a project-agnostic viewer pointed at **one** backend per dev-server (the
[[api-endpoint]] seam), so when several projects each run their own backend the tabs are
otherwise indistinguishable. The tab carries its backend's identity instead: the board
payload exposes `project` — the basename of that backend's repo root, its launch folder —
and the frontend sets `document.title` to `<project> · SpexCode` whenever the board loads.
The title re-derives from whichever backend the viewer actually reached (it rides the same
`/api/board` poll), so pointing the same board at a different `API_URL` re-names the tab.

`index.html` ships a plain `SpexCode` `<title>` as the pre-load fallback — what the tab
reads before the first board arrives, and if the backend is unreachable.
