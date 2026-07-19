---
title: projects-hub
status: active
hue: 170
desc: The multi-project face of the dashboard — the Projects admin page over the hub's landed contract (catalog, probed health, password management), the /p/<id>/ pathname scope that makes every page a shareable project URL, the persistent project selector, and the ONE credential card shared by admin sign-in and project unlock.
code:
  - spec-dashboard/src/ProjectsPage.jsx#ProjectsPage
related:
  - spec-dashboard/src/project.js
  - spec-dashboard/src/projects.js
  - spec-dashboard/src/CredentialGate.jsx
  - spec-dashboard/src/project.test.mjs
  - spec-dashboard/src/projects.test.mjs
  - spec-dashboard/vite.config.js
---
# projects-hub

## raw source

One gateway now fronts many governed projects — [[gateway-hub]] landed the server contract (a root
catalog at `/projects`, every project surface under `/p/:projectId/*`, [[gateway-auth]]'s two signed
scopes). The dashboard needed the client half: somewhere to see and manage the fleet, addresses that make
one project shareable without revealing the rest, and one credential experience instead of a per-surface
zoo of prompts. UI only — routing/auth semantics stay on the gateway.

## expanded spec

**The pathname is the scope.** The same built SPA serves at the hub root `/` and at `/p/<id>/`; a scoped
page prefixes every `/api` call (fetch, SSE, terminal WebSocket) through the one seam in `project.js`, so
no feature module knows it is scoped and the address bar is always the shareable project URL — the form
the gateway gates by path. Unscoped serving (vite dev, single-project `spex serve ui`) yields base `''`
and stays byte-identical to the pre-multi-project app; a dev proxy rule maps `/p/*/api` onto the one dev
backend so scoped pages are drivable without a hub.

**One admin page over the landed contract, two mounts.** `ProjectsPage` renders the hub's registry — one
row per project the machine's backends have REGISTERED (a project appears by running `spex serve` in its
repo; there is deliberately no add/init/doctor/start verb here, because the catalog carries none — the
empty state says exactly that). Each row shows a probed health dot (the client pings `/p/:id/health`
through the authorized proxy lane — 'ok' is running, a 502/redirect/timeout is unreachable; the registry
itself has no health field), the gating state, a password set/clear drawer (`PUT`/`DELETE
/projects/:id/password`), and Open as a plain link to `/p/<id>/#/graph` — switching projects is ordinary
same-tab navigation, extra tabs always optional. The header owns the ADMIN password (`PUT`/`DELETE
/projects/admin-password`): `adminGated:false` renders the bootstrap hint — management is
implicit-loopback-only until a password exists, and the hub keeps the setter signed in by rotating their
cookie in the set response. Freshness is a plain poll (catalog every few seconds, health re-probed per
row), so registration, disappearance, and health flips land on their own. The page mounts standalone as
the hub face (the shell shows it at `/` when there is no board but `/projects` answers —
[[dashboard-shell]] owns that boot pick) and again as the routed `#/projects` page inside a scoped
dashboard ([[side-nav]] shows that entry, and the rail's persistent current-project chip with its
switcher menu, only when the catalog probe succeeded).

**One credential card, two doors, no catalog leak.** `CredentialGate` is the single credential
experience: the admin sign-in (`POST /login`) and a project unlock (`POST /p/<id>/login`) are the same
calm card with different words — the same JSON `{password}` post the hub's own designed login page
speaks. Denial is read from the status, exactly as the hub answers: 401 wants credentials
('admin-login' on the catalog, 'project-login' on a scoped api), 403 is the locked admin surface — the
card's locked variant is a dead end by design, naming the loopback repair path. It appears wherever a
401 strikes in-app; an admin session bypasses project prompts because the admin cookie authorizes every
`/p/*` route server-side. A direct-project guest never sees the catalog: the probe is denied, so the
Projects entry, the switcher menu, and this page simply never render — absence of data, not a hidden
element.

**The contract lives in one module.** `projects.js` is the only place the hub routes are spelled; every
reader is tolerant (a pre-hub server's SPA-fallback HTML reads as "absent", unknown fields default) so
the same frontend runs against every deployment generation. All hub/credential/selector styling reads
the shared palette AND typography tokens only — every theme preset skins these surfaces with no extra
rules. Graphical registration/init flows (with an explicit harness choice) return to this node when the
hub grows those verbs; until then the UI offers no dead affordances.
