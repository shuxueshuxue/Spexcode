---
title: side-nav
status: active
hue: 210
desc: The modern-app skeleton — a left icon rail with one entry per top-level page (graph · sessions · evals · issues · settings), each page at its own URL (#/…, with list-page filter state in the hash's query string) so it can be bookmarked, reloaded, and history-walked; list→detail navigation is a history PUSH, browser Back the return path.
code:
  - spec-dashboard/src/SideBar.jsx#SideBar
  - spec-dashboard/src/SideBar.jsx#ENTRIES
related:
  - spec-dashboard/src/route.js
  - spec-dashboard/src/route.test.mjs
---

# side-nav

## raw source

The dashboard grew top-level surfaces — the spec graph, the session board, the evals feed, the issues
page, settings — but they were organized as one page with overlays: the board a full-screen modal over the
graph, the review surfaces tabs inside that modal, settings a popup. A user couldn't bookmark the session
board, reload the issues page, or see where they were. The standard modern-app skeleton answers all of it
at once: a **left sidebar** naming the pages, and a **URL per page**. The review surfaces are two peers,
each a GitHub-style LIST page + DETAIL page pair ([[evals-view]] / [[issues-view]]) — the human's
directive, verified against GitHub's live product: state in the URL, rows as links, click = push, Back
restores the list.

## expanded spec

- **One rail, five pages.** A slim always-visible icon rail on the app's left edge is the page switch:
  Spec Node Graph, Session Board, Evals, Issues, and Settings pinned at the bottom. Evals and Issues are
  distinct rail entries, each with its own glyph and i18n label — **Evals above Issues** (evals lead: the
  current measured loss is what review attends to first). The active page wears the accent; labels live in
  tooltips/aria (i18n'd), so the rail stays slim and the pages keep their space. The rail is chrome, not a
  page — it never scrolls away and never overlays content.
- **The URL is the page state — query string included.** Routes are hash paths — `#/graph` (home; any
  unknown hash lands here), `#/sessions` (+ `#/sessions/<sel>` deep-linking a tab), `#/evals` (+
  `#/evals/<node>/<scenario>`, the canonical eval DETAIL address — each segment encoded on its own so the
  path shape survives), `#/issues` (+ `#/issues/<id>`), `#/settings`. A LIST page's filter state rides a
  query string INSIDE the hash — for the review lists, ONE `?q=<raw token text>` param ([[review-query]];
  the default view stays bare) — so a filtered list is a copyable, Back-restorable address. Hash,
  deliberately not the History API: the dashboard ships as a static dist
  behind plain gateways with no index.html fallback, and a hash route needs nothing from any server.
  `route.js` is the whole route layer (parse — path + query, hash construction, navigate, one hashchange
  hook, legacy normalization); the object-level address vocabulary over it is [[address-routing]].
- **Pages push; list→detail pushes; filter changes push; automatic echoes replace.** Switching pages
  pushes a history entry. Opening a DETAIL page from its list is ALSO a push — measured on GitHub: history
  grows by one and browser Back restores the previous list URL, filters intact; the detail is a real
  place, not an echo. A HUMAN's list-filter change pushes too (GitHub's semantics — Back walks filter
  history), and a list re-derives its whole state from the URL on every hashchange, so Back replays it
  exactly. What REPLACES is automatic state-naming — a normalization or the session board's selected-tab
  echo. There
  is no fake in-app Back button anywhere; the browser's history is the return path.
- **Legacy review addresses normalize.** `#/sessions/<id>/eval[/<node>/<scenario>]` was the
  un-merged worktree evals' old home; its canonical form is now the [[evals-view]] family
  (`#/evals?q=is:eval state:current scope:<id>` / `#/evals/<node>/<scenario>?q=scope:<id>`). Likewise the
  review lists' old STRUCTURED filter params (`state/concluded/store/author/node/filer/verdict/
  freshness/kind/live/ok/session`) replay into the one `?q=` token text ([[review-query]]). The route
  layer rewrites each old shape with replace on arrival — old links keep working, no old shape is ever
  re-minted.
  The retired scoped `#/projects` admin route crosses a pathname boundary instead: arrival at
  `/p/<id>/#/projects` performs one full-page redirect to the canonical global `/projects` surface.
- **Pages are peers, not layers.** Navigation swaps which page fills the main area beside the rail;
  nothing dims or floats. Surfaces that must stay warm across switches (the graph's camera, the session
  board's live terminals) stay mounted and display-toggled — a route change may never cost a terminal
  its socket. True transient overlays (help, search, the node popup) remain modals *within* a page and
  close when the page changes.
- **Catalog-gated project switching, never project management.** Under the multi-project gateway
  ([[projects-hub]]) a `/p/<id>/` rail keeps the persistent current-project chip pinned above the five
  project-owned page entries. Its mark and label come from the route-matched [[project-identity]], never
  an initial derived from whichever board loaded last. A SUCCESSFUL catalog probe gives that chip a menu for same-tab project
  switching plus an "All projects" door to the global `/projects` hub; it never adds a Projects rail page
  or mounts project management inside the scoped shell. When the catalog is denied the chip still names
  the current project but carries no menu, so a direct-project guest never sees the fleet or any global
  admin affordance: the gate is absence of data, not a hidden element.
- **One global ⌥ vocabulary; Esc never switches pages.** Page switching is the **⌥ command family**,
  window-global on every page: `⌥1..⌥5` jump straight to a page in rail order (graph · sessions · evals ·
  issues · settings — the rail tooltips carry the hints), `⌥N` to the New Session composer, `⌥F` to the
  Evals list (the leading loss surface, so the letter door and the bare `f` agree) — matched by physical
  key (`e.code`, the mac ⌥-dead-key rule), ⌥-only so ⌘/⌃ chords stay the browser's. The family is reserved
  even over the console's raw-key nav mode (the same standing as its `⌥/⌘+I` toggle — a TUI never sees
  `M-1` or `M-f`). Graph-scoped doors stay: `Enter` → the session board, bare `f` → the Evals list, `,` →
  settings (and `,` toggles back). Issues has no bare-key board door — the rail, `⌥4`, or history.
  **Esc routes nothing** — pages are peers, not layers, so Esc only closes transient overlays *within* a
  page (search, the node popup, a console menu); leaving a page is navigation: the rail, `⌥digit`, or
  history. One vocabulary for mouse (rail), keyboard, and address bar.
