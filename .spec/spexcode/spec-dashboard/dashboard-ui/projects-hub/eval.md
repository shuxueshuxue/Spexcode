---
scenarios:
  - name: hub-catalog-management
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ProjectsPage.jsx, spec-dashboard/src/projects.js, spec-dashboard/src/App.jsx]
    description: >
      Serve the dashboard over the REAL hub gateway (startHubGateway) fronting at least two real `spex
      serve` backends whose supervisors registered themselves (backend.json records), one of them gated.
      Open the ROOT address in a real browser from loopback with no admin password configured, then:
      read the catalog and its bootstrap hint; SET the admin password through the header control and
      confirm the page stays signed in; set and clear a project password from its row drawer; watch a
      backend registered/killed OUTSIDE the page appear/flip health without a reload; follow a row's
      Open link.
    expected: >
      The root address renders the Projects hub: one row per REGISTERED project with a probed health dot
      (running=green via /p/:id/health, unreachable=red), the gated rows wearing the lock. With no admin
      password the ungated hint shows; setting one through the UI succeeds and the very next catalog
      poll still answers (the hub rotated the setter's cookie — no logout). Project password set/clear
      round-trips (PUT/DELETE) and the row's lock badge follows. A registry change made outside the page
      lands via the poll without a reload. Open lands on /p/<id>/#/graph where the FULL classic
      dashboard renders that project's board through the scoped /p/<id>/api lane, with the rail carrying
      the current-project chip and the Projects entry. Zero loss = the whole admin loop (see fleet,
      gate it, enter a project, come back) works in one tab through shareable pathname URLs, against the
      real gateway code.
  - name: project-scope-unlock
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/CredentialGate.jsx, spec-dashboard/src/projects.js]
    description: >
      Same rig, with one project password-protected and the visitor holding no cookies. Open that
      project's direct URL (/p/<id>/#/graph) in a real browser. Submit a wrong password, then the right
      one. Separately, sign in as admin at the root and open the same project URL.
    expected: >
      The direct URL renders the unified credential card (project face — the same visual card the admin
      sign-in uses; the scoped api answered 401), never the board and never an eternal spinner. A wrong
      password shows the inline error; the right one unlocks in place (the hub minted the project-scope
      cookie) and the project's board renders without a manual reload. The catalog is never revealed to
      the project-scope visitor: no Projects rail entry, no switcher menu list. An admin session opens
      the same URL with NO prompt (the admin scope authorizes every /p/* route). Zero loss = one
      credential experience covers both doors, and a shared direct project link exposes exactly one
      project.
---
# projects-hub — measurement

YATU through a real browser against the REAL landed gateway (`startHubGateway` + `gateway-auth` + real
`spex serve` backends and their registry records), never by reasoning about the client code. The one
stand-in allowed is static SPA serving in front of the hub (the hub is API-only until the serving seam
lands) — a thin wrapper that serves the built dist and forwards /projects, /login, and /p/* to the hub
verbatim, cookies untouched. Everything the scenarios measure (authorization decisions, cookie minting,
registry, proxying, the faces) is real product code.
