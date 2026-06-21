---
title: api-endpoint
status: active
hue: 260
desc: Where the dashboard proxies /api — a per-project `spexcode.json` default, overridable by the API_URL env.
code:
  - spec-dashboard/vite.config.js
---
# api-endpoint

The dashboard is a thin same-origin caller of one backend: the Vite dev server proxies `/api` (and the
live-terminal WebSocket, via `ws:true`) to that backend. **Which** backend is resolved at dev-server
start from three sources, highest precedence first:

1. `API_URL` env — an ad-hoc or remote endpoint, named at launch.
2. `spexcode.json`'s `dashboard.apiUrl` — the **per-project default**, found by walking up from cwd.
3. `http://localhost:8787` — the default backend.

Source (2) is what lets a project pin its endpoint **once, in the repo**, instead of passing a port on
every launch: in the normal layout the dashboard lives inside the repo, so the same `spexcode.json` that
governs lint also names the dashboard's backend. The env still wins, so a one-off or a remote backend
needs no file edit. The backend itself is chosen the other way — by the cwd `spex serve` runs in (the
[[portable-layout]] seam) and its `PORT` — so this node is only the dashboard→backend hop.
