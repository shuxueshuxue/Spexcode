---
title: side-nav
status: active
hue: 210
desc: The modern-app skeleton — a left icon rail with one entry per top-level page (graph · sessions · evals · issues · settings), each page at its own URL (#/…) so it can be bookmarked, reloaded, and history-walked.
code:
  - spec-dashboard/src/SideBar.jsx#SideBar
  - spec-dashboard/src/SideBar.jsx#ENTRIES
related:
  - spec-dashboard/src/route.js
---

# side-nav

## raw source

The dashboard grew top-level surfaces — the spec graph, the session board, the evals feed, the issues
page, settings — but they were organized as one page with overlays: the board a full-screen modal over the
graph, the review surfaces tabs inside that modal, settings a popup. A user couldn't bookmark the session
board, reload the issues page, or see where they were. The standard modern-app skeleton answers all of it
at once: a **left sidebar** naming the pages, and a **URL per page**. The review surfaces are two peers,
not one page with an in-page switcher — the human's directive: **evals and issues are two top-level
pages**, side by side with the graph and the board.

## expanded spec

- **One rail, five pages.** A slim always-visible icon rail on the app's left edge is the page switch:
  Spec Node Graph, Session Board, Evals, Issues, and Settings pinned at the bottom. Evals and Issues are
  distinct rail entries, each with its own glyph and i18n label — **Evals above Issues** (evals lead: the
  current measured loss is what review attends to first). The active page wears the accent; labels live in
  tooltips/aria (i18n'd), so the rail stays slim and the pages keep their space. The rail is chrome, not a
  page — it never scrolls away and never overlays content.
- **The URL is the page state.** Routes are hash paths — `#/graph` (home; any unknown hash lands here),
  `#/sessions` (+ `#/sessions/<sel>` deep-linking a tab; a tab address may carry the console's in-page
  entrance past the id — `#/sessions/<sel>/eval[/<node>/<scenario>]`, parsed as the route's `sub` segments
  and applied ONCE by the sessions page as [[address-routing]]'s `session-eval` address, then the echo
  normalizes back to the plain tab), `#/evals` (+ `#/evals/<node>/<scenario>`, the
  canonical eval address — [[evals-view]] owns what it selects; the route layer just carries the
  multi-segment param, each segment encoded on its own so the path shape survives), `#/issues`,
  `#/settings`. Hash,
  deliberately not the History API: the dashboard ships as a static dist behind plain gateways with no
  index.html fallback, and a hash route needs nothing from any server. Five pages need no router
  dependency — `route.js` is the page-route layer (parse, route hash construction, navigate, one hashchange
  hook). The object-level clickable-reference vocabulary that projects graph nodes, sessions, issues, and
  evals onto these page routes is the child [[address-routing]] contract, so page routing and app-object
  addressing do not blur into one over-owned file.
- **Pages push, details replace.** Switching pages pushes a history entry (back walks pages); an
  in-page detail echo — the session board's selected tab, the evals page's selected eval — replaces, so
  detail-hopping never buries
  history. The echo makes every board tab and every shown eval a shareable address without making it a
  history landmine.
- **Pages are peers, not layers.** Navigation swaps which page fills the main area beside the rail;
  nothing dims or floats. Surfaces that must stay warm across switches (the graph's camera, the session
  board's live terminals) stay mounted and display-toggled — a route change may never cost a terminal
  its socket. True transient overlays (help, search, the node popup) remain modals *within* a page and
  close when the page changes.
- **One global ⌥ vocabulary; Esc never switches pages.** Page switching is the **⌥ command family**,
  window-global on every page: `⌥1..⌥5` jump straight to a page in rail order (graph · sessions · evals ·
  issues · settings — the rail tooltips carry the hints), `⌥N` to the New Session composer, `⌥F` to the
  Evals page (the leading loss surface, so the letter door and the bare `f` agree) — matched by physical
  key (`e.code`, the mac ⌥-dead-key rule), ⌥-only so ⌘/⌃ chords stay the browser's. The family is reserved
  even over the console's raw-key nav mode (the same standing as its `⌥/⌘+I` toggle — a TUI never sees
  `M-1` or `M-f`). Graph-scoped doors stay: `Enter` → the session board, bare `f` → the Evals page, `,` →
  settings (and `,` toggles back). Issues has no bare-key board door — the rail, `⌥4`, or history.
  **Esc routes nothing** — pages are peers, not layers, so Esc only closes transient overlays *within* a
  page (search, the node popup, a console menu); leaving a page is navigation: the rail, `⌥digit`, or
  history. One vocabulary for mouse (rail), keyboard, and address bar.
