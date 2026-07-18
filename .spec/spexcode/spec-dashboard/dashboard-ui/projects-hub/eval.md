---
scenarios:
  - name: hub-catalog-management
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ProjectsPage.jsx, spec-dashboard/src/projects.js, spec-dashboard/src/App.jsx]
    description: >
      Serve the dashboard behind a server speaking the multi-project gateway contract (GET /projects with
      at least two projects in different health states; /p/:id/api/* proxied to a real spex backend). Open
      the ROOT address in a real browser. Then exercise the graphical management flows: open the
      add-repository form and read its harness choice; run doctor on a row and read its report; follow a
      row's Open link.
    expected: >
      The root address renders the Projects hub (no board, no rail): one row per catalog project showing a
      health dot mapped to the semantic accents (running=green, unreachable=red), name, and path, with the
      catalog re-polled live (a project registered/removed server-side appears/disappears without a
      reload). The add form requires a path and an explicit harness choice rendered with the harness
      product marks. Doctor prints its report verbatim in the row's drawer. Open lands on /p/<id>/#/graph
      where the FULL classic dashboard renders that project's board through the scoped /p/<id>/api lane,
      with the rail carrying the current-project chip and the Projects entry. Zero loss = the whole
      multi-project loop (see fleet, manage, enter a project, come back) works in one tab through
      shareable pathname URLs.
  - name: project-scope-unlock
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/CredentialGate.jsx, spec-dashboard/src/projects.js]
    description: >
      Same rig, with one project password-protected and the visitor holding no cookies. Open that
      project's direct URL (/p/<id>/#/graph) in a real browser. Submit a wrong password, then the right
      one. Separately, sign in as admin at the root and open the same project URL.
    expected: >
      The direct URL renders the unified credential card (project face — the same visual card the admin
      sign-in uses), never the board and never an eternal spinner. A wrong password shows the inline
      error; the right one unlocks in place and the project's board renders without a manual reload. The
      catalog is never revealed to the project-scope visitor: no Projects rail entry, no switcher menu
      list. An admin session opens the same URL with NO prompt (the admin scope bypasses project gates).
      Zero loss = one credential experience covers both doors, and a shared direct project link exposes
      exactly one project.
---
# projects-hub — measurement

YATU through a real browser against a server speaking the gateway contract, never by reasoning about the
client code. Until the gateway side ([[public-mode]]) ships, the rig is a thin contract stub in front of
REAL `spex serve` backends — the stub carries only the agreed routes (/projects, /p/:id/api proxy, the
two login posts); everything the scenarios measure (faces, gating, scoped board, live poll) is the real
frontend against real project data. Re-measure against the real gateway once it lands.
