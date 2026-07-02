---
title: dashboard-issues
status: active
hue: 280
desc: Surfaces each node's bound issues on the dashboard — an OPEN-count badge on the tile, plus the full set folded onto the node for the focus panel and the node-info Issues tab. Owns the FORGE slice (a resident ForgeCache) of the board's unified Issue fold; non-blocking and silent without a forge.
code:
  - spec-forge/src/resident.ts
related:
  - spec-cli/src/board.ts
  - spec-dashboard/src/SpecNode.jsx
---
# dashboard-issues

The dashboard surface [[spec-forge]] deferred as a sibling: it shows, on each node, the **open issues that
work toward it**. The data path already exists end to end — [[links]] inverts a forge's open work into
`node → { issues, prs }` and [[freshness]]'s resident `ForgeCache` keeps that view fresh. **Only
display is missing**, and this node owns just that, on the two planes' contract: a node *defines*, an
issue *does*, so the work appears **beside** the node, never *as* node state. A node's status stays
git-derived; an issue count is execution, and the two authorities never cross.

## raw source

Surface each spec node's bound open issues on the dashboard. Backend: fold each node's open-issue
count + list into the board via a resident `ForgeCache`, served on the existing `/api/board` nodes —
non-blocking (serve the last reconcile, refresh in the background) and silent when there's no forge/`gh`
(no badge, no error). Frontend: one glance badge on the tile (count, hue distinct from the status dot, like
the drift-badge), only when > 0; the issue LIST is read in the [[focus-panel]] for the focused node
(alongside that node's scenarios — Issues and Scenarios as equal citizens), not in a card popped on the node.
The badge is WORK, distinct from the derived status dot.

## expanded spec

**Backend — a resident cache, folded into the board.** A process-lifetime `ForgeCache` (the resident
wiring around [[freshness]]'s pure cache) serves the dashboard without a blocking forge call on the
request path. Its contract: a view is **always instant** (the last successful reconcile), and asking for a
view opportunistically triggers a **background** reconcile when the cache is stale (a TTL backs off both
success and failure, so a forge-less repo is not re-probed every poll). The board fold goes through the
**unified Issue port** (spec-cli's [[issues]]): each node gets its **merged** issue list — this cache's
forge slice AND the local forum's threads ([[proposals]]) — every item in the one Issue shape (id, store,
kind, concern, status, url), attached **only when there are any**: the full set (open + closed) as
`issues` for the node-info **Issues tab** ([[work-pane]]), and the open subset as `openIssues` for the
glance badge and hover card. This node owns the forge slice into that fold (the resident cache and its
freshness contract); the merge itself is [[issues]]'s. Closed forge issues link by the explicit `Spec:`
marker (the transitive PR path sees only open PRs). The forge slice is **silent by construction**: with no
`gh`, no repo, or no auth the reconcile throws, is swallowed, and the cache stays
empty — the fold then carries the local slice alone, no error; a forge-less repo with no local threads
reads exactly as before. One targeted freshness exception rides beside the TTL: when a reply lands on a
forge issue through the store-routed write ([[issues]]), that one issue's fresh comment thread is folded
straight into the cache, so the writer's next read shows the reply without waiting out the TTL.
Read-only throughout — the resident module itself never writes the forge (the write is the [[port]]
driver's); the fold never touches a node's git-derived status. This fold is one of several the board carries — the eval timeline
([[yatsu-eval-tab]]) rides the same pattern. dashboard-issues owns only its issues slice, so that
sibling's churn there is that feature, not this node's drift.

**Frontend — one glance badge; the list lives in the focus panel.** When a node carries open issues, its
first row gains a single badge: the **count**, in a hue distinct from the status dot and from the drift-badge
(so the three signals never blur). Status dot = derived state; drift-badge = code ahead of spec; this badge =
**bound work**. The badge is absent at zero. The detail — the full list, each issue a card (store, kind,
status, full concern, and a forge permalink when it has one) — is read in the [[focus-panel]] for the
focused node,
**beside that node's scenarios**, so the two stateful kinds of bound work share one surface and neither is
privileged. (The node-info Issues tab keeps the same list as the deep view.) There is no longer a card popped
on the node's own hover/focus. The badge renders inside the node tile ([[node-graph]]) and draws its copy
through the shared translator `t` ([[settings]]); each issue's own number/state/title stay raw forge data.

Out of scope (future siblings, per node granularity): surfacing open **PRs** the same way (PRs already
read on the board as session/overlay state); any live push of forge deltas (that is [[freshness]]'s
deferred source layer). Frontend behaviour here is asserted by contract, not visually verified — there is
no browser/e2e harness yet.
