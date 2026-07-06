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

The dashboard surface [[spec-forge]] deferred: it shows, on each node, the **open issues that
work toward it**. [[links]] inverts a forge's open work into `node → { issues, prs }` and [[freshness]]'s
resident `ForgeCache` keeps that view fresh; this node owns the display fold, on the two planes' contract:
a node *defines*, an issue *does*, so the work appears **beside** the node, never *as* node state. A node's
status stays git-derived; an issue count is execution, and the two authorities never cross.

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
wiring around [[freshness]]'s pure cache) serves the dashboard without a blocking forge call on the request
path. Its contract: a view is **always instant** (the last successful reconcile), and a stale read triggers
a **background** reconcile (a TTL backs off both success and failure). The TTL sits **near the dashboard's
poll cadence** (~15s), so an externally-posted issue surfaces within about one poll — "post a github issue
→ it just appears" — without re-probing a forge-less repo every poll. The board
fold goes through the **unified Issue port** (spec-cli's [[issues]]): each node gets its **merged** issue
list — this cache's forge slice AND the local store's threads ([[local-issues]]) — every item in the one
Issue shape, attached **only when there are any**: the full set (open + closed) as `issues` for the
node-info **Issues tab** ([[work-pane]]), the open subset as `openIssues` for the glance badge. This node
owns the forge slice into that fold; the merge itself is
[[issues]]'s. Closed forge issues link by the explicit `Spec:` marker (the transitive PR path sees only
open PRs). The slice is **silent by construction**: with no `gh`, no repo, or no auth the reconcile throws,
is swallowed, and the cache stays empty — the fold carries the local slice alone, no error. One exception
rides beside the TTL: a store-routed reply to a forge issue ([[issues]]) forces one refresh past
the TTL and AWAITS it (`refreshForgeNow`), so the next read carries the real read-back; the forced cycle is
a FULL re-list, never the incremental window — a since-read can lag a just-posted write and would advance
the watermark past it. Read-only throughout — the resident module never writes the forge (writes are the
[[port]] driver's) and never touches a node's git-derived status. Sibling folds ride the same pattern
(the [[yatsu-eval-tab]] eval timeline); this node owns only the issues slice.

**Frontend — one glance badge; the list lives in the focus panel.** When a node carries open issues, its
first row gains a single badge: the **count**, in a hue distinct from the status dot and the drift-badge
(so the three signals never blur), absent at zero. The detail —
each issue a card (store, kind, status, full concern, a forge permalink when it has one) — is read in the
[[focus-panel]] for the focused node, **beside that node's scenarios** (the node-info Issues tab keeps the
same list); no card pops on the node's own hover/focus. The badge renders in the node tile
([[node-graph]]), its copy through the shared translator `t` ([[settings]]); each issue's
number/state/title stay raw forge data.

Out of scope (future siblings): surfacing open **PRs** the same way; any live push of forge deltas
([[freshness]]'s deferred source layer). The badge's
visual proof lives with the tile's owner ([[node-graph]]); this node's contract is the fold.
