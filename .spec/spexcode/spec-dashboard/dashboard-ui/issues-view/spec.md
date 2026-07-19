---
title: issues-view
status: active
hue: 200
desc: The dashboard's Issues surface as GitHub-style TWO pages sharing [[review-chrome]] — a ListView query + Open/Closed sections + real issue facets over structured anchor rows, and a standalone detail page whose thread writes route to the issue's own store.
code:
  - spec-dashboard/src/IssuesPage.jsx#IssuesPage
  - spec-dashboard/src/IssuesPage.jsx#IssuesListPage
  - spec-dashboard/src/IssuesPage.jsx#IssueDetailPage
  - spec-dashboard/src/IssuesPage.jsx#NewThreadForm
related:
  - spec-dashboard/src/Evidence.jsx
  - spec-dashboard/src/IssueCard.jsx
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/textarea.js
---

# issues-view

## raw source

Issues are one object over every store ([[issues]]), and a human wants **one place** to read them — an
agent's local taste issue and a GitHub issue on the same node belong on the same page. The human's
directive names the navigation model: **GitHub's own issues UI**, verified live — a LIST page whose whole
state lives in its URL, rows that are plain copyable links, a click that PUSHES history onto a standalone
full-page DETAIL, and browser Back that restores the exact filtered list. The earlier master-detail split
pane is gone; so is any in-page selection echo. The dashboard stays a **thin window** over the CLI's
truth: it renders what `/api/issues` returns, computes nothing, and every write goes through the SAME
verbs the CLI uses.

## expanded spec

- **Two pages, one route family — the shared [[review-chrome]].** `#/issues` is the list page (the
  [[side-nav]] rail entry and ⌥4 land here); `#/issues/<id>` is the detail page. Both are bookmarkable,
  reloadable, directly openable. Rows are REAL anchors to their detail address; clicking one is a normal
  hash PUSH, and Back returns to the list URL with its query intact. Filter state — the store pick, the
  concluded reveal, the [[live-session-filter]] chip — rides the hash's query string; a human's filter
  change PUSHES (GitHub's semantics), and the list re-derives its whole state from the URL on every
  hashchange, so Back replays it exactly. No pagination exists — `/api/issues` has no
  page semantics and the open list is small; none is invented. A detail address naming no issue renders
  the shell's honest not-found with a link to the list. Esc routes nothing ([[side-nav]]).
- **One merged list, store-tagged — RESIDENT, never cold-fetched.** The list is [[issues]]'s
  `mergedIssues` — which excludes eval-remark threads ([[eval-issue-split]]: a scenario-scoped concern is
  a remark and lives on the Evals pages). It is app-held state beside the board: the page renders
  instantly from it; freshness inherits the board's pattern (push-signal throttled refetch that DEFERS,
  never drops; the 15s cold lane; ETag 304s), and a write forces the refetch. Rows render **in API
  order** — stores interleaved newest first, no salience ranking. The shared ListView query searches the
  concern/id/originator/node facts; the metadata header's **Open / Closed sections + counts** are the
  lifecycle switch (default Open; every non-open state belongs to Closed). Real facets cover only data the
  issue model actually has: originator, store, spec node, and live-session involvement. Spec node is the
  desktop overflow facet; at 390px originator stays directly reachable while store/live join that same
  functional overflow menu. Every pick
  is canonical query state and a PUSH. New remains the page-title action. No assignee/labels/project
  theatre is invented for a model that has none. An actually empty issue store says there are no issues
  yet; a non-empty store reduced to zero by section/query/facets instead says this view has no matching
  issues, through [[review-chrome]]'s shared empty-state contract.
- **The row leads with the issue, never its plumbing.** A structured two-level row: the **status mark** (GitHub
  Primer's 16px `issue-opened` octicon in the semantic open green; every concluded state — local
  `landed`, forge `closed` — the `issue-closed` ring+check in the one closed purple; never a CSS dot),
  then the wrapping concern; under it the real issue identity, originator, and opened time; at the right
  the comment count and store/node facts that exist. At 390px those facts join the secondary line and the
  title may wrap without horizontal overflow. **The store is metadata, never identity**: it never leads a
  row and never sits on a title.
- **The detail page is [[review-chrome]]'s GitHub-grammar skeleton.** Header: the concern ALONE as the
  title. Status band: the same shared issue-state primitive as the list mark, now with its label. MAIN
  column: the **markdown-rendered body** (SpecBody — the
  one spec dialect, no raw `##`/pipes) then the reply thread, with the **composer docked at the column's
  foot**. SIDE rail: the store tag, the ORIGINATOR + liveness (a local thread's `by` is a session id — a
  live one is a click-through chip to `#/sessions/<id>`, painted by the board's STATUS_COLOR join; a
  forge login stays a plain label), the node chips (click focuses the graph), and a forge permalink
  labeled with the store's concrete display name ("Open on GitHub"/"Open on GitLab" — canonical
  display-name data, never a URL sniff, never the word "forge"; a local issue renders none). At phone
  width the side metadata reflows ABOVE the body in the one column. A forge issue's comments render as
  the SAME reply thread a local issue gets — store never changes the thread's shape.
- **A human writes from here — to the issue's OWN store.** The composer is the ONE shared thread-composer
  ([[event-detail]] docks the same component, `Thread.jsx`): a quiet bordered container, a borderless
  writing surface floored at two lines that auto-grows (`textarea.js`), the action row always visible —
  the `@`/`[[` trigger buttons opening the shared [[mentions]] autocomplete, the host lifecycle actions,
  and an icon-only Send at the row's end; a failed send surfaces its error in that row. **Close issue**
  and **Promote** live in that action row (GitHub's grammar — lifecycle acts on the conversation), each
  through the ONE store-routed verb; sign/accept/reject are not product verbs. Replies post as `'human'`
  via `replyIssue` — a local reply git-commits, a forge reply posts a REAL comment — then the list
  refetches. A reply that is a REMARK gets its resolve/retract verbs ([[remark-substrate]]); a
  `▶m:ss · step` first line is a time anchor; attached blobs render through the one shared evidence
  renderer. A `@session`/`@new` in any composer **dispatches** ([[mentions]]) and the one-line outcome
  echoes briefly as a page notice — a summons is never silent.
- **New opens local-first from the LIST page** — a centered pop-out (concern + optional body + one
  compact store picker naming each store's canonical label once); a `[[node]]` in the prose IS the node
  link (no separate ids field); a forge pick creates the real forge issue with the `Spec:` marker. The
  modal's autocomplete overlays above the pop-out; Esc/backdrop close only that layer.
- **Issue cards enter this page, never the forge.** Every compact card elsewhere (focus panel, node
  Issues tab) is the SAME `IssueCard` whose canonical href is `#/issues/<issue-id>`; a forge permalink is
  detail-side metadata only. Long content clamps inside the card.
- **Honors the switch.** When the issues workflow is OFF (`enabled: false`), the page shows the muted
  "off" state — the dashboard reflects the one source of truth.
