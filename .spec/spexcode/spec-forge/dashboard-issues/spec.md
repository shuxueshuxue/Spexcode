---
title: dashboard-issues
status: active
hue: 280
desc: Surfaces each node's bound OPEN issues on the dashboard — one glance badge (count) that reveals a popover of the issues on hover/focus. Fed by a resident ForgeCache folded into /api/board; non-blocking and silent without a forge.
code:
  - spec-forge/src/resident.ts
  - spec-cli/src/board.ts
  - spec-dashboard/src/SpecNode.jsx
---
# dashboard-issues

The dashboard surface [[spec-forge]] deferred as a sibling: it shows, on each node, the **open issues that
work toward it**. The data path already exists end to end — [[links]] inverts a forge's open work into
`node → { issues, prs }` and [[freshness]]'s `ForgeCache.view(nodeIds)` keeps that view fresh. **Only
display is missing**, and this node owns just that, on the two planes' contract: a node *defines*, an
issue *does*, so the work appears **beside** the node, never *as* node state. A node's status stays
git-derived; an issue count is execution, and the two authorities never cross.

## raw source

Surface each spec node's bound open issues on the dashboard. Backend: fold each node's open-issue
count + list into the board via a resident `ForgeCache`, served on the existing `/api/board` nodes —
non-blocking (serve the last reconcile, refresh in the background) and silent when there's no forge/`gh`
(no badge, no error). Frontend: one glance badge (count, hue distinct from the status dot, like the
drift-badge), only when > 0; on hover **or** focus, reveal one popover of each issue (num, state, title,
url). No second detail pane — one surface. The badge is WORK, distinct from the derived status dot.

## expanded spec

**Backend — a resident cache, folded into the board.** A process-lifetime `ForgeCache` (the resident
wiring around [[freshness]]'s pure cache) serves the dashboard without a blocking forge call on the
request path. Its contract: a view is **always instant** (the last successful reconcile), and asking for a
view opportunistically triggers a **background** reconcile when the cache is stale (a TTL backs off both
success and failure, so a forge-less repo is not re-probed every poll). The board folds each node's open
issues — number, state, title, url — onto that node, but **only when there are any**. It is **silent by
construction**: with no `gh`, no repo, or no auth the reconcile throws, is swallowed, and the cache stays
empty — so the board reads exactly as before, no badge and no error. Read-only throughout: the fold never
touches a node's git-derived status.

**Frontend — one glance badge, one popover.** When a node carries open issues, its first row gains a
single badge: the **count**, in a hue distinct from the status dot and from the drift-badge (so the three
signals never blur). Status dot = derived state; drift-badge = code ahead of spec; this badge = **bound
work**. The badge is absent at zero. On **hover or keyboard focus** it reveals one small popover listing
each issue — number, state, title — each a clickable link to its url. That popover is the **only** detail
surface this feature adds: no second detail pane, no extra route. Clicking an issue link opens the forge,
never the node's session.

Out of scope (future siblings, per node granularity): surfacing open **PRs** the same way (PRs already
read on the board as session/overlay state); any live push of forge deltas (that is [[freshness]]'s
deferred source layer). Frontend behaviour here is asserted by contract, not visually verified — there is
no browser/e2e harness yet.
