---
title: address-routing
status: active
hue: 205
desc: A single dashboard address vocabulary for clickable references — graph nodes, sessions, issues, and evals — projected to canonical hash URLs and executed through one navigation helper.
code:
  - spec-dashboard/src/address.js
related:
  - spec-dashboard/src/route.js
  - spec-dashboard/src/route.test.mjs
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/IssueCard.jsx
  - spec-dashboard/test/graph-node-address.e2e.mjs
  - spec-dashboard/test/node-menu-copy-url.e2e.mjs
---
# address-routing

Clickable references in the dashboard name a product object first and a route second. A search row, an
IssueCard, or any future node/session/review reference should all produce the same
small **app address** shape, then let the shared address layer project it to the canonical destination.

The vocabulary is intentionally closed and mirrors the top-level pages [[side-nav]] already owns:

- `graph-node` focuses a node on `#/graph/<node-id>`; the node id is one independently encoded path
  segment, so an address copied from any node reference can be opened, reloaded, and history-walked without
  relying on the tab's remembered focus. Bare `#/graph` remains the graph home and keeps its tab-local
  remembered/root fallback; an id no longer present in the current board also falls back safely rather than
  blanking the graph. Desktop selects and expands the node's drill-down; phone restores its ancestor
  breadcrumb and opens that node's screen. The incoming node parameter is applied when the graph route
  changes, not enforced on every render: after a direct open, mouse/keyboard/programmatic focus moves remain
  usable as local, transient graph navigation and leave the address unchanged. A new explicit address
  navigation or a copy action names the target node; high-frequency board movement never makes the address
  bar flicker.
- `spec` opens the node's document at `#/spec/<node-id>`; the same independently encoded id is used by the
  search palette and prose references, so a document link is ordinary navigation and the tab strip places it in
  the spec slot. This is distinct from `graph-node`, which remains the legacy focused graph address.
- `session` opens `#/sessions/<id>`; a session face is the query axis on that same document address:
  `#/sessions/<id>?surface=conversation|terminal|diff|resource:<resourceTabKey>`. A bare session address keeps
  its existing meaning — the per-session base-surface preference — while the explicit query is the only visible
  selector and is written only by a user navigation gesture. Resource faces are ordinary session object tabs:
  their canonical address is the tab identity, opening dedupes/focuses it, and closing it never tears down the
  session's tmux/PTY. `surface=evals` is deliberately not a new
  session face: route arrival REPLACES it with the canonical scoped Evals list `#/evals?q=scope:<id>` (the
  same projection as [[session-eval]]), so one session reading has one Evals address family. Unknown face
  values are ignored and the bare session resolution applies.
- `session-eval` opens the scoped default list `#/evals?q=is:eval scope:<id>` — or, with
  a node + scenario, `#/evals/<node>/<scenario>?q=scope:<id>` — the session-SCOPED Evals pages ([[session-eval]] /
  [[evals-view]]). This is the address an MR/CI note pastes so a reviewer one-clicks into the live,
  remarkable, worktree-rooted reading of an un-merged branch — and the address every session DOOR wears:
  the console tab bar's and the phone session header's eval entries are REAL anchors whose href is this
  projection, and the scoped Evals pages mint every scoped href (rows, queue neighbors, the detail's way
  back to the scoped list) through it too. Only that scoped list exposes the separate real anchor back
  to `#/sessions/<id>`; details first return to their canonical scoped list, so the scope grammar lives
  here and nowhere else. The old
  `#/sessions/<id>/eval[/<node>/<scenario>]` shape is LEGACY: the route layer normalizes it to this form
  on arrival ([[side-nav]]) and nothing mints it anymore.
- `issue` opens `#/issues/<issue-id>` — the issue's own DETAIL page ([[issues-view]]).
- `eval` opens `#/evals/<node>/<scenario>` — the eval's own DETAIL page, TRUNK-rooted ([[evals-view]]), path
  only (the detail hash carries no list filters); a not-yet-merged session reading's address is
  `session-eval`, not this. **Scenario-less**, `eval(nodeId)` is the node's AGGREGATE entry: the Evals LIST
  filtered to that node — `#/evals?q=is:eval node:<id>`, [[review-query]]'s canonical token
  text (the default view + the `node` qualifier, minted via `nodeEvalQuery`) — the address every aggregate
  score/count affordance ([[eval-score-badge]]) mints. The list-filter grammar lives in this one projection
  and nowhere else.
- `hash` is the address a caller ALREADY HOLDS. It is the one kind that names no object, and it exists for
  the surface that received a canonical href from one of the kinds above and must now act on it — a review
  row hands its own `href` to its context menu, and the menu copies THAT. The alternative is to rebuild an
  address object from the row's data, which mints the same address a second way: two paths that agree today
  and are free to disagree tomorrow, which is exactly what this closed vocabulary exists to prevent. It is
  a pass-through, never a parser: nothing here inspects or rewrites the hash it was given.

`addressHash(address)` is the href side: real anchors and copyable links get the canonical hash without
hand-rolled string assembly in components. `navigateAddress(address, callbacks)` is the SPA side: it follows
the same projection; graph-node focus is applied by the graph route itself, while the warm session page may
take its immediate selection callback. This makes a direct open, a review-node reference, and a palette pick
the same transaction instead of giving graph focus a second state channel.
`addressUrl(address)` is the clipboard side: it resolves that canonical hash against the browser's current
document URL, preserving its origin and project pathname (`/p/<id>/`) without a public-host setting. A copy
action therefore hands over a URL a recipient can open in the same deployment, not a bare hash or a local-only
address.
`detailBackHash(page, scopeId)` is the review details' **return gate** — the compact back anchor's href
([[review-chrome]]'s DetailShell), derived ONLY from the detail's own canonical address: `#/issues` from
an issue detail, the bare `#/evals` from a TRUNK eval detail, and the scoped DEFAULT list (the same
`session-eval` projection the doors mint, `scope:` token kept) from a SCOPED eval detail — "back" always
means the list on the detail's own data-source axis. The scope never diverts the back arrow to the
session console: a worktree-rooted reading reaches the terminal only through the scoped LIST's icon-only
door ([[evals-view]]). The helper takes no history, referrer, or session-presence input
at all, so a pushed visit and a direct open share one destination by construction.
Consumers may choose button or anchor chrome, but they do not decide the route vocabulary. That keeps review
objects first-class: issue and scenario references land on their owning review pages, never by accident on
the bound spec node or a node-popup tab.

Review list addresses also carry the ONE pagination grammar. Page follows `q` when one exists. Pagination
anchors preserve q and change only page, including minting explicit `page=1` when returning to the first
page. Any query builder removes page before it PUSHES, so a new filtered population begins at the omitted
page-1 form. Direct open, refresh, Back, and Forward retain an explicit `page=1`; the two page-1 forms are
action/history state, not a canonical-address error. Automatic legacy normalization and invalid/non-positive
page repair REPLACE; human pagination/filter actions PUSH.

`copyText(text)` is the clipboard path itself, and `copyAddress` is its address-shaped caller. A reader is
also offered plain subjects to copy — a repository path from the explorer's row menu ([[file-tree]]) — and
they take the same Clipboard-API-then-textarea route, so a denied or insecure clipboard degrades identically
wherever a copy is offered instead of once per surface.
