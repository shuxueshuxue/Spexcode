---
scenarios:
  - name: hub-catalog-management
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ProjectsPage.jsx, spec-dashboard/src/projects.js, spec-dashboard/src/App.jsx]
    description: >
      Serve the dashboard over the REAL hub gateway (startHubGateway) fronting at least two real `spex
      serve` backends whose supervisors registered themselves (backend.json records), one of them gated.
      Open `/projects` in a real browser from loopback with no admin password configured, then:
      read the catalog and its bootstrap hint; SET the admin password through the header control and
      confirm the page stays signed in; set and clear a project password from its row drawer; watch a
      backend registered/killed OUTSIDE the page appear/flip health without a reload; follow a row's
      Open link.
    expected: >
      `/projects` renders the Projects hub: one row per KNOWN project with an honest liveness dot
      (running=green via the probed /p/:id/health; a host-validated dead/stopped backend reads a calm
      grey 'stopped' with Start as the row's primary action; red is reserved for an online-claimed
      backend the probe cannot reach), the gated rows wearing the lock. With no admin password the
      ungated hint shows; setting one through the UI succeeds and the very next catalog poll still
      answers (the hub rotated the setter's cookie — no logout). Project password set/clear round-trips
      (PUT/DELETE) and the row's lock badge follows. A registry change made outside the page lands via
      the poll without a reload. Open lands on /p/<id>/#/graph where the FULL classic dashboard renders
      that project's board through the scoped /p/<id>/api lane. Its rail carries the current-project
      chip and only the five project-owned page buttons; the chip's "All projects" action returns to
      `/projects`. Zero loss = the whole admin loop (see fleet, gate it, enter a project, come back)
      works in one tab through shareable pathname URLs, against the real gateway code.
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
  - name: hub-project-lifecycle
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/ProjectsPage.jsx, spec-dashboard/src/projects.js]
    description: >
      Serve the REAL host gateway (`startHostDashboard` — the hub + host extensions + the built SPA,
      one process) and, in a real browser at the hub face, take a THROWAWAY git repo through the whole
      graphical management workflow: register it by root path via the add drawer (plus one non-repo
      path for the refusal); open the offline row's setup drawer and run init — first confirming the
      button refuses with no harness chip picked, then with an explicit harness choice (and the
      optional preset left empty); run doctor; press Start; then follow Open. Repeat the visual pass at
      375px and in a second theme.
    expected: >
      The add drawer registers the repo (the row appears on the next poll, dot calmly 'stopped', Start
      as the primary action — never a dead Open); the non-repo path shows the host's own refusal
      verbatim inline. Init stays disabled until a harness chip is picked; run, it shows a pending
      state, then the spawned `spex init`'s real exit code and full transcript in place — a failure
      stays visible and the same button retries. Doctor renders its report the same way. Start boots
      the real detached `spex serve`: the button shows starting…, the row flips online (green dot,
      Open primary) once the record reconciles — no manual reload anywhere. Open lands on
      /p/<id>/#/graph with that project's board through the scoped lane. The same page is usable and
      calm at 375px and skinned correctly by other theme presets with no extra rules. Zero loss = a
      repo goes from unregistered to a browsable governed project entirely through the browser,
      against the real gateway code.
---
# projects-hub — measurement

YATU through a real browser against the REAL landed gateway, never by reasoning about the client code.
The full rig is `startHostDashboard` ([[host-gateway]]) — the hub's routing/auth, the host's reconciler
and management verbs, and the built SPA served from the one process; the earlier static-SPA stand-in is
retired now that the serving seam is landed. Everything the scenarios measure (authorization decisions,
cookie minting, registry, registration, the spawned spex verbs, proxying, the faces) is real product
code driving real throwaway repos.
