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
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/IssueCard.jsx
---
# address-routing

Clickable references in the dashboard name a product object first and a route second. A search row, an
IssueCard, or any future node/session/review reference should all produce the same
small **app address** shape, then let the shared address layer project it to the canonical destination.

The vocabulary is intentionally closed and mirrors the top-level pages [[side-nav]] already owns:

- `graph-node` focuses a node on `#/graph`; the focused id is shell view state, not a hash segment.
- `session` opens `#/sessions/<id>`.
- `session-eval` opens the scoped default list `#/evals?q=is:eval state:current scope:<id>` — or, with
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
  filtered to that node — `#/evals?q=is:eval state:current node:<id>`, [[review-query]]'s canonical token
  text (the default view + the `node` qualifier, minted via `nodeEvalQuery`) — the address every aggregate
  score/count affordance ([[eval-score-badge]]) mints. The list-filter grammar lives in this one projection
  and nowhere else.

`addressHash(address)` is the href side: real anchors and copyable links get the canonical hash without
hand-rolled string assembly in components. `navigateAddress(address, callbacks)` is the SPA side: it follows
the same projection, with callbacks only for shell-owned state (`graph-node` focus and session tab selection).
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
