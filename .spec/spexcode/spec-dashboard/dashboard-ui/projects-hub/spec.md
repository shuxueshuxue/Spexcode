---
title: projects-hub
status: active
hue: 170
desc: The multi-project face of the dashboard — the Projects catalog page with graphical add/init/doctor/start/password/open flows, the /p/<id>/ pathname scope that makes every page a shareable project URL, the persistent project selector, and the ONE credential card shared by admin sign-in and project unlock.
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

One gateway now fronts many governed projects (the multi-project gateway contract: a root catalog at
`/projects`, every project surface under `/p/:projectId/*` — [[public-mode]] owns the server side). The
dashboard needed the client half: somewhere to see and manage the fleet of projects, addresses that make
one project shareable without revealing the rest, and one credential experience instead of a per-surface
zoo of prompts. UI only — routing/auth semantics stay on the gateway.

## expanded spec

**The pathname is the scope.** The same built SPA serves at the hub root `/` and at `/p/<id>/`; a scoped
page prefixes every `/api` call (fetch, SSE, terminal WebSocket) through the one seam in `project.js`, so
no feature module knows it is scoped and the address bar is always the shareable project URL — the form
the gateway can gate by path. Unscoped serving (vite dev, single-project `spex serve ui`) yields base `''`
and stays byte-identical to the pre-multi-project app; a dev proxy rule maps `/p/*/api` onto the one dev
backend so scoped pages are drivable without a gateway.

**One catalog page, two mounts.** `ProjectsPage` is the management surface: one row per project with a
live health dot (running / stopped / unreachable — the server's word, re-polled every few seconds while
mounted so appearance, disappearance, and health flips land on their own), and the graphical verbs —
add-repository (a path plus an EXPLICIT harness choice from the [[harness-adapter]] set, rendered with the
[[icon-system]] product marks), init for an uninitialized row, doctor (report shown verbatim), start, and
per-project password set/clear. Open is a plain link to `/p/<id>/#/graph`: switching projects is ordinary
same-tab navigation — extra tabs always optional, never required. The page mounts standalone as the hub
face (the shell shows it at `/` when there is no board but `/projects` answers — [[dashboard-shell]] owns
that boot pick) and again as the routed `#/projects` page inside a scoped dashboard ([[side-nav]] shows
that entry, and the rail's persistent current-project chip with its switcher menu, only when the catalog
probe succeeded).

**One credential card, two doors, no catalog leak.** `CredentialGate` is the single credential experience:
the admin sign-in (`POST /login`) and a project unlock (`POST /p/<id>/login`) are the same calm card with
different words; a gateway with no admin verifier renders its locked variant — no form, just the repair
path. It appears wherever a 401 strikes: the catalog answers `admin-login`/`locked` inside this page, a
scoped board answers `project-login` at the shell. An admin session bypasses project prompts because the
admin cookie authorizes every `/p/*` route server-side — the client never re-asks. A direct-project guest
never sees the catalog: the probe is denied, so the Projects entry, the switcher menu, and this page's
list simply never render — absence of data, not a hidden element.

**The contract lives in one module.** `projects.js` is the only place the catalog routes are spelled;
every reader is tolerant (a pre-gateway server's SPA-fallback HTML reads as "absent", unknown fields
default) so the same frontend runs against every deployment generation. All hub/credential/selector
styling reads the shared palette vars only — every theme preset skins these surfaces with no extra rules.
