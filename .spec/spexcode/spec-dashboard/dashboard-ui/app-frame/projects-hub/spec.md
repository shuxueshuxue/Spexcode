---
title: projects-hub
status: active
hue: 170
desc: The multi-project face of the dashboard — one global /projects admin page over the hub's landed contract, /p/<id>/ pathname scope for shareable project URLs, the persistent project selector, and one credential card shared by admin sign-in and project unlock.
code:
  - spec-dashboard/src/ProjectsPage.jsx#ProjectsPage
related:
  - spec-dashboard/src/PageScroll.jsx
  - spec-dashboard/src/main.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/project.js
  - spec-dashboard/src/projects.js
  - spec-dashboard/src/CredentialGate.jsx
  - spec-dashboard/src/IdentityIcon.jsx
  - spec-dashboard/src/project.test.mjs
  - spec-dashboard/src/projects.test.mjs
  - spec-dashboard/test/projects-new-project.e2e.mjs
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
backend so scoped pages are drivable without a hub. The canonical scoped address ends in `/`: the hub
redirects a bare `/p/<id>` before serving the shell, and relative production assets resolve inside that
scope while the gateway serves only `/assets/...` requests from the same static fallback; extensionless
scoped backend routes such as `/health` remain backend probes.

**One global admin page over the landed contract.** `ProjectsPage` renders the host's reconciled
KNOWN-project view ([[host-gateway]]): a repo enters the fleet by running `spex serve` in it, or through
the page's dedicated Add Project modal. The modal is a focused host-folder picker, not another inline
drawer: an editable absolute-path bar and parent/home navigation select one directory while a bounded list
shows its child folders. A typed missing path becomes a clear New project command, which creates that
directory, initializes Git, runs the neutral `spex init --harness none` foundation, and registers it through
the host's one add workflow. The selected folder's
actual state drives a compact setup section. An existing Git
repo can be added as-is; a plain folder requires an explicit checked Git initialization choice. SpexCode
initialization is independently optional, recognizes an already-initialized repo, and requires explicit
harness targets before submit. One submit runs the host's unified add workflow; it stays pending through
the requested real `git init` / `spex init`, keeps the modal open on failure with the command's full
transcript, and closes only after the catalog row truly exists.
Each row shows its [[project-identity]] icon/title and liveness — the host's instance-validated `online`
refined by a probed `/p/:id/health` dot
when online, while an offline row calmly reads *stopped*, never probed into a false red — the gating
state, a password set/clear drawer (`PUT`/`DELETE /projects/:id/password`), and one primary action per
state: Open when online (a plain link to `/p/<id>/#/graph` — switching projects is ordinary same-tab
navigation, extra tabs always optional) or Start when offline (`POST /projects/:id/serve` answers only
when the booted backend's record reconciles online, so success means reachable). A row's settings gear
edits the project's ONE portable settings source directly: it loads the raw root `spexcode.json`
(`{}` when absent) into a monospace text editor and saves only a valid top-level JSON object through
`GET|PUT /projects/:id/config`. Saving is atomic and revision-guarded, so a concurrent disk edit is a
visible conflict instead of silent loss; `spexcode.local.json` is deliberately outside this browser
surface because it holds host-specific paths and may hold secrets. The raw JSON editor is the drawer's
work area: about half the viewport tall on desktop, with sensible bounds, and a large viewport-constrained
mobile height that leaves its controls reachable without overlap. Inside that same project details drawer,
the final, low-emphasis action is **Remove project registration**. It opens a warning rather than
acting immediately, names the project, and states that the checkout and source files remain. One explicit
confirmation button submits the canonical `REMOVE <project title>` phrase to `DELETE /projects/:id`; the page
does not expose a local-directory delete command. The project row also exposes a trash icon that opens this same
warning, and the icon never bypasses server-side safety checks.
Online backends and active sessions are shown as server-side blockers with their repair reason, so the user is
never nudged into deleting around live work. Identity editing remains a
quiet secondary disclosure: its compact current mark and edit button reveal the shared
searchable, source-filtered icon browser only on request. The global gateway equivalent sits in the page's low-priority
settings/details area, never as a prominent picker block. A project pick changes only its existing
`dashboard.icon`, while the global pick changes only the one host `gateway.icon`; both use the shared
[[icon-presets]] resolver and Iconify catalog, re-collapse after a successful choice, and surface revision conflicts. The separate setup action runs the
real repo verbs (`POST /projects/:id/init|doctor`): init demands the EXPLICIT harness choice
(nothing picked, nothing run), while preset policy comes from the edited `spexcode.json` rather than a
second one-off input; every run renders its exit code and full transcript in place, a failure stays on
screen, and the same button is the retry. The header owns
the ADMIN password (`PUT`/`DELETE /projects/admin-password`): `adminGated:false` renders the bootstrap
hint — management is implicit-loopback-only until a password exists, and the set response rotates the
setter's cookie so they stay signed in. Freshness is a plain poll — registration, a just-started
backend, and health flips land on their own. The complete reconciled list is shown ten rows at a time with
plain previous/next pagination; a shrinking list clamps back to its last valid page. The page mounts only as the global hub face at `/projects`
(the shell shows it when there is no board but `/projects` answers — [[dashboard-shell]] owns that boot
pick). A `notice` query parameter is a generic one-shot arrival message: the page sends it through the existing
transient error-notice viewport and immediately removes it from the address, so an OS integration failure can
land on the hub loudly without adding another error component or teaching the SPA about its source. A denied
global catalog is handled by that same shell-level credential card before the management
page mounts, so the denied probe is not repeated by a second page instance. A `/p/<id>/` shell contains only project-owned views and never mounts the page or advertises its
management controls in the rail. The old direct `/p/<id>/#/projects` address remains a compatibility door:
arrival performs one full-page redirect to `/projects`, leaving no duplicate in-shell admin route behind.
The status bar's compact project identity button is the scoped project's one project-changing control;
the rail carries no duplicate chip. Its catalog-backed switcher reflects instance-validated liveness:
online (or legacy/unknown) rows remain
switchable links, while an offline row is visibly stopped and non-navigable; the global `/projects` row is
the repair door for starting it. As a document-shaped global face, `/projects` consumes [[page-scroll]] directly: the page shell
defines the full viewport while the shared primitive owns its inset scrollbar, one-axis overflow, and
phone geometry. Drawers and bounded editors retain their own local overflow and never become competing
full-page scroll owners.

**One credential card, two doors, no catalog leak.** `CredentialGate` is the single credential
experience: the global `/projects` admin sign-in (`POST /login`) and a project unlock
(`POST /p/<id>/login`) are the same
calm card with different words — the same JSON `{password}` post the hub's own designed login page
speaks. Denial is read from the status, exactly as the hub answers: 401 wants credentials
('admin-login' on the catalog, 'project-login' on a scoped api), 403 is the locked admin surface — the
card's locked variant is a dead end by design, naming the loopback repair path. It appears wherever a
401 strikes in-app; an admin session bypasses project prompts because the admin cookie authorizes every
`/p/*` route server-side. A direct-project guest never sees the catalog or any global management control:
the probe is denied, so the switcher menu is absent and the project shell exposes only its current-project
identity and project-owned pages — absence of data, not a hidden element. The status-bar identity button
remains an explicit `/projects` login door when that catalog is denied, but never opens a fleet menu or leaks rows.
A denied catalog is an answered state: its five-second refresh pauses until the credential card reports an
unlock, so an unauthenticated browser does not hammer an already-denied route.

**The contract lives in one module.** `projects.js` is the only place the hub routes are spelled — the
catalog read, the password writes, the raw portable-config read/write, the credential posts, and the
management verbs (add / init / doctor / serve); every reader is tolerant (a pre-hub server's SPA-fallback HTML reads as "absent", a hub without
the host extension leaves `online` unknown and the UI falls back to probe-only health, unknown fields
default) so the same frontend runs against every deployment generation. All hub/credential/selector
styling reads the shared palette AND typography tokens only — every theme preset skins these surfaces,
the config/setup drawers, and the transcript block with no extra rules.
