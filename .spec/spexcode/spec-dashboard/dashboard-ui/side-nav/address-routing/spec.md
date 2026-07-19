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
- `session-eval` opens `#/evals?session=<id>` — or, with a node + scenario,
  `#/evals/<node>/<scenario>?session=<id>` — the session-SCOPED Evals pages ([[session-eval]] /
  [[evals-view]]). This is the address an MR/CI note pastes so a reviewer one-clicks into the live,
  remarkable, worktree-rooted reading of an un-merged branch. The old
  `#/sessions/<id>/eval[/<node>/<scenario>]` shape is LEGACY: the route layer normalizes it to this form
  on arrival ([[side-nav]]) and nothing mints it anymore.
- `issue` opens `#/issues/<issue-id>` — the issue's own DETAIL page ([[issues-view]]).
- `eval` opens `#/evals/<node>/<scenario>` — the eval's own DETAIL page, TRUNK-rooted ([[evals-view]]); a
  not-yet-merged session reading's address is `session-eval`, not this.

`addressHash(address)` is the href side: real anchors and copyable links get the canonical hash without
hand-rolled string assembly in components. `navigateAddress(address, callbacks)` is the SPA side: it follows
the same projection, with callbacks only for shell-owned state (`graph-node` focus and session tab selection).
Consumers may choose button or anchor chrome, but they do not decide the route vocabulary. That keeps review
objects first-class: issue and scenario references land on their owning review pages, never by accident on
the bound spec node or a node-popup tab.
