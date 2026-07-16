---
scenarios:
  - name: auth-boundary
    tags: [backend-api]
    description: >
      Through the running gateway (`spex serve --public --password X` on a throwaway port), exercise the
      password boundary over HTTPS with curl + a raw WebSocket upgrade: an unauthenticated request to a
      protected surface, a wrong password, the correct password, and the terminal socket with and without
      the minted auth cookie.
    expected: |
      Unauthenticated: GET /api/graph → 401; GET / → 302 to /login. POST /login with a wrong password → 401
      (the login page re-rendered with the error). POST /login with the correct password → 302 to / with an
      httpOnly, Secure auth cookie. With that cookie: GET / serves the dashboard index, GET /api/graph returns
      the proxied board JSON (200, application/json). A WebSocket upgrade to /api/sessions/:id/socket is
      destroyed with no response when the cookie is absent and completes (101 Switching Protocols) when it is
      present. A forged cookie value → 401. Only the public port listens externally; the supervisor and child
      stay on loopback.
    code: spec-cli/src/gateway.ts
  - name: login-page
    tags: [frontend-e2e, desktop]
    description: Load the gateway's /login in a browser, screenshot it, then submit a wrong password and screenshot the error state.
    expected: |
      A styled dark login card centred on a subtle gradient — the SpexCode wordmark with a lock glyph, a
      "Restricted access" heading + one-line subtitle, a single password field (monospace dots), a blue
      gradient "Sign in" button, and a "Trusted collaborators only" footer. A wrong password shows an inline
      red "Incorrect password — try again." banner above the field. It is a designed page, NOT the browser's
      native Basic-auth dialog.
    code: spec-cli/src/login-page.ts
  - name: open-no-password
    tags: [backend-api]
    description: >
      Run `spex serve --public` with NO password (no --password / SPEXCODE_PASSWORD) and drive the public
      endpoint: the startup line, an unauthenticated GET /, GET /api/graph, and whether any /login gate exists.
    expected: |
      Startup prints a loud "OPEN — no password" warning and the gateway logs "OPEN (no password)". With no
      cookie: GET / returns the dashboard (200, NOT a 302 to /login), GET /api/graph returns the proxied board
      JSON (200), and there is no /login gate — the login layer is absent entirely. The operator chose open
      access and was warned; nothing is silently gated or silently exposed.
    code: spec-cli/src/gateway.ts
  - name: gzip-transport
    tags: [backend-api]
    code: spec-cli/src/gateway.ts
    description: >-
      Against a real running gateway (authenticated), fetch /api/graph and a dist JS asset twice — with and
      without `Accept-Encoding: gzip` — and subscribe to /api/graph/stream WITH gzip accepted, then trigger
      a board change and time the event.
    expected: >-
      Compressible bodies come back `Content-Encoding: gzip` at a fraction of the plain size (board JSON
      and the JS bundle both under a third); the SSE stream carries NO content-encoding (the exclusion —
      an event must never sit in a zlib buffer) and the triggered event still arrives on the debounce
      scale. The upstream is untouched: only the gateway compresses.
  - name: stale-chunk-recovery
    tags: [backend-api]
    code: spec-cli/src/gateway.ts
    description: >
      Against a running gateway, fetch the three static classes and read their Cache-Control: GET /
      (index.html), GET a real hashed asset under /assets/, and GET a non-existent hashed chunk
      (/assets/IssuesPage-DEADBEEF.js) — the exact stale-chunk case a pre-rebuild browser hits.
    expected: |
      index.html (and any extensionless SPA route falling back to it) comes back `Cache-Control: no-cache`
      — revalidated every load so a redeploy is always picked up. A hashed asset under /assets/ comes back
      `Cache-Control: public, max-age=31536000, immutable`. A missing hashed chunk answers 404 (never HTML).
      Together these close the shell's reload recovery: after a dist rebuild the reload reaches the fresh
      index and the lazy issues-page chunk loads, instead of re-serving a cached index that points at a dead
      chunk hash forever.
  - name: gateway-full-loop
    tags: [frontend-e2e, desktop]
    description: >
      通过公网 gateway（bj01.ezfrp.com:20703）走完整用户环：登录页 → 密码登录 → dashboard graph 页 →
      sessions 页 → UI 表单创建 new session → worker 真实启动并走完生命周期。headless 浏览器驱动
      真实公网入口，不走 localhost。
    expected: |
      登录 302→/ 成功；graph 页渲染 SVG 节点树；new session 表单提交后 session 出现在 RUNNING 列表；
      对应 worker 进程真实启动、完成任务并自声明（ask/done）；全程无 5xx、无空白页。
    code: spec-cli/src/gateway.ts
---
# public-mode loss

YATU through the real product surface: run `spex serve --public` and drive the public HTTPS endpoint as an
outside visitor would — curl/raw-socket for the auth boundary (a transcript), a real browser for the login
page (a screenshot). Never assert the gate from an internal helper; cross it from the network face.
