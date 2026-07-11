---
scenarios:
  - name: proxy-target-precedence
    tags: [backend-api]
    description: >-
      Through the REAL Vite dev server (the product surface: it reads vite.config.js and proxies `/api` to
      the resolved backend), confirm the three-source precedence by starting the dev server three ways and
      sending a request through its `/api` proxy each time: (1) with `API_URL=<backend A>` set; (2) with NO
      `API_URL` but a `spexcode.json` carrying `dashboard.apiUrl=<backend B>` reachable by walking up from
      cwd; (3) with neither set. Observe which backend actually answers the proxied `/api/board` (run a tiny
      identifiable backend on A and B), and read the resolved proxy `target` for case (3).
    expected: >-
      `API_URL` wins whenever it is set (case 1 → backend A answers). With no env, the per-project
      `spexcode.json` `dashboard.apiUrl` found by walking up from cwd is used (case 2 → backend B answers).
      With neither, the target defaults to `http://localhost:8787` (case 3). The dashboard is only ever a
      thin same-origin caller of the ONE resolved backend; the WebSocket rides the same proxy (`ws:true`).
    code: spec-dashboard/vite.config.js
---
# yatsu.md — api-endpoint

Measured through the real Vite dev server (YATU): the config's `target = API_URL || projectApiUrl() ||
'http://localhost:8787'` is the one hop this node owns, so the proof drives the actual proxy — start the
dev server under each precedence source and watch which backend answers `/api`, rather than re-implementing
the resolution. The loss watched is a board pointed at the wrong backend (or a hardcoded one), which would
silently show another project's sessions.
