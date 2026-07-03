---
title: side-nav
status: active
hue: 210
desc: The modern-app skeleton — a left icon rail with one entry per top-level page (graph · sessions · issues · settings), each page at its own URL (#/…) so it can be bookmarked, reloaded, and history-walked.
code:
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/route.js
---

# side-nav

## raw source

The dashboard grew four top-level surfaces — the spec graph, the session board, the issues page, settings —
but they were organized as one page with overlays: the board a full-screen modal over the graph, the
issues a tab inside that modal, settings a popup. A user couldn't bookmark the session board, reload the
issues page, or see where they were. The standard modern-app skeleton answers all of it at once: a **left
sidebar** naming the pages, and a **URL per page**.

## expanded spec

- **One rail, four pages.** A slim always-visible icon rail on the app's left edge is the page switch:
  Spec Node Graph, Session Board, Issues, and Settings pinned at the bottom. The active page wears the
  accent; labels live in tooltips/aria (i18n'd), so the rail stays slim and the pages keep their space.
  The rail is chrome, not a page — it never scrolls away and never overlays content.
- **The URL is the page state.** Routes are hash paths — `#/graph` (home; any unknown hash lands here),
  `#/sessions` (+ `#/sessions/<sel>` deep-linking a tab), `#/issues`, `#/settings`. Hash, deliberately not
  the History API: the dashboard ships as a static dist behind plain gateways with no index.html
  fallback, and a hash route needs nothing from any server. Four pages need no router dependency —
  `route.js` is the whole layer (parse, navigate, one hashchange hook).
- **Pages push, details replace.** Switching pages pushes a history entry (back walks pages); an
  in-page detail echo — the session board's selected tab — replaces, so tab-hopping never buries
  history. The echo makes every board tab a shareable address without making it a history landmine.
- **Pages are peers, not layers.** Navigation swaps which page fills the main area beside the rail;
  nothing dims or floats. Surfaces that must stay warm across switches (the graph's camera, the session
  board's live terminals) stay mounted and display-toggled — a route change may never cost a terminal
  its socket. True transient overlays (help, search, the node popup) remain modals *within* a page and
  close when the page changes.
- **One global ⌥ vocabulary; Esc never switches pages.** Page switching is the **⌥ command family**,
  window-global on every page: `⌥1..⌥4` jump straight to a page in rail order (the rail tooltips carry the
  hints), `⌥N` to the New Session composer, `⌥F` to issues — matched by physical key (`e.code`, the mac
  ⌥-dead-key rule), ⌥-only so ⌘/⌃ chords stay the browser's. The family is reserved even over the console's
  raw-key nav mode (the same standing as its `⌥/⌘+I` toggle — a TUI never sees `M-1` or `M-f`). Graph-scoped
  doors stay: `Enter` → the session board, bare `f` → issues, `,` → settings (and `,` toggles back).
  **Esc routes nothing** — pages are peers, not layers, so Esc only closes transient overlays *within* a
  page (search, the node popup, a console menu); leaving a page is navigation: the rail, `⌥digit`, or
  history. One vocabulary for mouse (rail), keyboard, and address bar.
