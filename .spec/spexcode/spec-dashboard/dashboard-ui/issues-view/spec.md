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
  - spec-dashboard/src/reviewFilters.js
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
  hash PUSH, and Back returns to the list URL with its query intact. All list state is [[review-chrome]]'s
  ONE token query (`is:issue state:open` by default; the [[review-query]] engine): a human's edit, tab,
  or menu pick PUSHES the canonical address — bare `#/issues` for the default view, exactly
  `?q=<raw text>` otherwise — and the list re-derives its whole state from the URL on every hashchange,
  so Back replays text, page-address form, rows, and scroll exactly. Page is the shared [[review-chrome]]
  hash-query view state: initial/filter reset omits page; pagination to page 1 writes `page=1`; page follows
  `q` when present; direct open/refresh/Back preserve the explicit form. Legacy structured params
  (`state/concluded/store/author/node/live/q`) replay at the route layer as a REPLACE into that token
  text; old deep links keep working and the old shape is never re-minted. The list reads the ONE server
  paged-review contract after merged-store source selection and filtering; it never downloads the merged
  issue population to filter or slice in React. A detail address
  naming no issue renders the shell's honest not-found with a link to the list. Esc routes nothing
  ([[side-nav]]).
- **One merged list, store-tagged — RESIDENT, never cold-fetched.** The source is [[issues]]'s
  `mergedIssues` — which excludes eval-remark threads ([[eval-issue-split]]: a scenario-scoped concern is
  a remark and lives on the Evals pages). It is app-held state beside the board: the page renders
  from the backend's resident snapshot; freshness inherits the board's pattern (push-signal throttled
  refresh that DEFERS, never drops; the 15s cold lane; ETag/revision reuse), and a write forces the
  refresh. The browser requests only its current 25-row slice. Rows render **in API
  order** — stores interleaved newest first, no salience ranking. Bare query words search the
  concern/id/originator/node facts; the metadata header's **Open / Closed sections + counts** are the
  lifecycle switch — token surgery on `state:` only, every other token preserved, counts computed under
  the rest of the query (default Open; every non-open state belongs to Closed, and a concrete concluded
  spelling like `state:landed` matches that status honestly). Matching and options come from the
  [[review-filters]] Issue adapter — page code only bridges the parsed token text into that engine.
  Menus exist only for the low-cardinality
  data the model actually has: the store pick and the source-session presence facet
  (`session:present|missing` — [[live-session-filter]]); store stays directly reachable at 390px while
  presence lives in [[review-chrome]]'s semantic secondary Filters menu — filter/funnel + localized text
  + chevron, never a kebab/action affordance. Its stable active-group count reads the presence token.
  At 390px an active Store face condenses visually to the selected store while retaining its fully
  qualified accessible name, so Open/Closed, Store, and Filters never overlap. Originator and spec node are HIGH-cardinality: `author:` /
  `node:` tokens, hand-typed or completed from the input's bounded inline autocomplete — no enumerating
  dropdown; an unknown or historical value still submits and yields the honest filtered zero. An ACTIVE
  menu value whose data option disappeared keeps its cheap All off-switch — and the visible text is
  always the canonical release — so data disappearance cannot trap the list behind an invisible filter.
  New remains the page-title action. No assignee/labels/project
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
  title, led by the shared compact **back anchor** — a REAL `#/issues` href derived from the canonical
  address ([[address-routing]]'s one back helper), never `history.back`, identical on a pushed visit and
  a direct open; browser Back still restores the exact filtered list. Status band: the same shared
  issue-state primitive as the list mark, now with its label. MAIN
  column: the **markdown-rendered body** (SpecBody — the
  one spec dialect, no raw `##`/pipes) then the reply thread, with the **composer docked at the column's
  foot**. SIDE rail — every value through [[review-chrome]]'s ONE SideValue metadata primitive
  (min-width:0 shrink, single-line ellipsis, full text on the tooltip; information type explicitly
  labeled, never guessed from a bare token): the issue's OWN id under a localized **Issue** label (the
  full slug, truncatable — a bare `#slug` reads as a node), the store tag, the ORIGINATOR + liveness (a
  local thread's `by` is a session id — a
  live one is a click-through chip to `#/sessions/<id>`, painted by the board's STATUS_COLOR join; a
  forge login stays a plain labeled value), the spec-node refs under their localized label (click
  focuses the graph), and a forge permalink
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
- **Issue cards enter this page, never the forge.** Every compact card in the node Issues tab is the SAME
  `IssueCard` whose canonical href is `#/issues/<issue-id>`; a forge permalink is
  detail-side metadata only. Long content clamps inside the card.
- **Honors the switch.** When the issues workflow is OFF (`enabled: false`), the page shows the muted
  "off" state — the dashboard reflects the one source of truth.
