---
title: side-nav
status: active
hue: 210
desc: The modern-app skeleton — a left icon rail whose explorer and sessions entries are dock projection controls, while evals · issues · settings remain addressable page anchors.
code:
  - spec-dashboard/src/SideBar.jsx#SideBar
  - spec-dashboard/src/SideBar.jsx#ENTRIES
related:
  - spec-dashboard/src/route.js
  - spec-dashboard/src/route.test.mjs
---

# side-nav

## raw source

**A rail destination is not the same thing as an addressable kind**, and the rail now says so by reading
its own list. It read the full address list for as long as every address was a page; the moment documents
became addressable ([[view-registry]]), that stopped being true — `spec` and `file` are places you arrive
at by opening something, and there is no "go to the spec page" the way there is a sessions page. The first
version without the split threw `unknown icon: spec` while faithfully trying to draw a destination that
does not exist.

The dashboard grew top-level surfaces — the spec graph, the session board, the evals feed, the issues
page, settings — but they were organized as one page with overlays: the board a full-screen modal over the
graph, the review surfaces tabs inside that modal, settings a popup. A user couldn't bookmark the session
board, reload the issues page, or see where they were. The standard modern-app skeleton answers all of it
at once: a **left sidebar** naming the pages, and a **URL per page**. The review surfaces are two peers,
each a GitHub-style LIST page + DETAIL page pair ([[evals-view]] / [[issues-view]]) — the human's
directive, verified against GitHub's live product: state in the URL, rows as links, click = push, Back
restores the list.

## expanded spec

- **The rail is an ACTIVITY BAR, and it carries two kinds of entry.** Under the project chip sit the
  workspace's FINDING controls — the dock's two projection buttons, explorer and sessions. Search is NOT
  among them: a rail search button sits above both projections and can only open one, so it has to assert a
  scope the rail does not know. It moved into the two dock heads, where the row it sits in already says what
  it searches ([[dock-modes]]); the rail keeps only what it can answer for.
  Those two are plain buttons, not addresses: each selects a projection and is lit while that projection is
  the one in force. **Each wears what it LISTS**, not where its panel sits: explorer is a files mark,
  sessions a list of rows with status points. Explorer wore the left-panel frame back when the two dock
  toggles sat a few pixels apart and their whole message was which side they opened; on a rail of
  projections that frame reads as a card or a folder and says nothing about a file tree
  ([[icon-system]] keeps the mirrored panel pair for the dock toggles that actually mean a side). The lit
  button is a statement about the focused tab, not a memory of the last click: the dock follows what the
  reader holds ([[dock-modes]]), and a manual selection is a temporary override that lapses at the next
  focus change. Clicking the active projection collapses the dock, while clicking the other opens it on
  that projection; asking for sessions returns to the most recently held session tab when there is one, and
  otherwise arms the projection without minting anything. They render only inside a workspace (the cold
  review fast-path has no WorkspaceProvider). Below them sit the SINGLETON BOARDS, each a real anchor
  naming an address. The order is the mockup's and VS Code's alike: what helps you look, then where you
  can go.
- **One rail, three openers — evals, issues, settings.** A compact, always-visible **40px** icon rail on the app's left
  edge names the addressable kinds: Evals, Issues, and Settings pinned at the
  bottom. The spec-node graph is NOT among them: it is still addressable at `#/graph`, but the workspace
  stopped sending anyone there ([[node-graph]]), and a rail icon is exactly the kind of standing invitation
  that retirement means to withdraw. The dock's explorer tree is the path to a node now. Evals and Issues are
  distinct rail entries, each with its own glyph and i18n label — **Evals above Issues** (evals lead: the
  current measured loss is what review attends to first). The active page wears the accent; labels live in
  tooltips/aria (i18n'd), so the rail stays slim and the pages keep their space. **A tooltip names the key,
  and reads it from the keymap.** An entry declares the action id a key also reaches it by, and the printed
  chord is resolved at render from [[keyboard-nav]]'s registry — user rebinds included, all modifiers
  present, nothing if nothing is bound. It is never typed into the translated label: that is a copy of a
  binding no rebind can reach, and both dictionaries had drifted into three glyph dialects for the same
  modifier while the rail advertised a bare `/` for a chord that had moved. Each entry is an `<a>`
  carrying its page's address (`href="#/…"`), so middle-click/new-tab/copy-address come free and every
  modified click stays the browser's. The PLAIN click is **create-or-focus** — and it gets that for free
  from an ORDINARY navigation, because a singleton board is resident by ADDRESS ([[view-registry]]): the
  strip holds it and never spends the slot on it, whoever asked. The rail used to pin it by hand, and that
  is precisely how residency became a property of this button instead of the board — the status tally and a
  pasted link reached the same address and got the slot, so the board's own first row click evicted it. The
  interception that remains chooses nothing but the timing: the address it lands on is the same one the
  `href` names, so the address bar, a bookmark, ⌥digit and this click all still produce one hash
  navigation. Clicking Evals twice is one tab. The
  rail is chrome, not a page — it never scrolls away and never overlays content. And it is **inert chrome for pointer
  focus** ([[focus-return]]'s acquisition-side guard): a press on a rail entry or the project chip
  acts — the link navigates, the chip menu opens — without moving DOM focus, so the rail never
  becomes the focus-return ticket and closing an overlay can never land focus on the top-left chip
  (where, as a menu trigger, it would swallow the node popup's keys). Keyboard Tab still reaches
  every entry, and a Tab-focused control keeps its native Enter/Space activation. Desktop entries use a
  centered **32px** square target: the tight horizontal gutter keeps the rail subordinate to the page while
  retaining an unambiguous pointer and keyboard destination.
- **Static graph projection preserves the silhouette, not false doors.** [[public-spec-graph]] keeps the
  familiar rail so visitors can see the product's full shape, but only Spec Node Graph is an anchor. Sessions,
  Evals, Issues, and Settings render as muted `aria-disabled` icons with no `href`, handler, or keyboard
  route; they must neither navigate nor wake any live transport. The live dashboard's sessions entry is a
  dock projection button; the live dashboard retains three anchors.
- **The URL is the page state — query string included.** Routes are hash paths — `#/graph` or
  `#/graph/<node>` (a finding-surface focus, never a tab; addressable, but no longer where anything
  lands), `#/sessions` (the face an unknown hash resolves to, and the one a fresh window opens on) (+
  `#/sessions/<sel>` deep-linking an object tab), `#/evals` (+
  `#/evals/<node>/<scenario>`, the canonical eval DETAIL address — each segment encoded on its own so the
  path shape survives), `#/issues` (+ `#/issues/<id>`), `#/settings`. A LIST page's filter state rides a
  query string INSIDE the hash — for the review lists, ONE `?q=<raw token text>` param ([[review-query]];
  the default view stays bare) — so a filtered list is a copyable, Back-restorable address. Hash,
  deliberately not the History API: the dashboard ships as a static dist
  behind plain gateways with no index.html fallback, and a hash route needs nothing from any server.
  `route.js` is the whole route layer (parse — path + query, hash construction, navigate, one hashchange
  hook, legacy normalization); the object-level address vocabulary over it is [[address-routing]].
- **The rail is the finding layer; the strip is the working set.** Rail destinations are evals, issues and
  settings; explorer and sessions are dock projection buttons. What enters the strip is defined by
  [[tab-strip]]/[[view-registry]]: object addresses, plus those three boards as singleton tabs.
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
  (`#/evals?q=is:eval scope:<id>` / `#/evals/<node>/<scenario>?q=scope:<id>`). Likewise the
  review lists' old STRUCTURED filter params (`state/concluded/store/author/node/filer/verdict/
  freshness/kind/live/ok/session`) replay into the one `?q=` token text ([[review-query]]). The route
  layer rewrites each old shape with replace on arrival — old links keep working, no old shape is ever
  re-minted.
  The retired scoped `#/projects` admin route crosses a pathname boundary instead: arrival at
  `/p/<id>/#/projects` performs one full-page redirect to the canonical global `/projects` surface.
- **Pages are peers behind one boundary, not layers.** Navigation swaps which page fills the main area
  beside the rail; nothing dims or floats. Every routed page renders inside the same shell-owned pane with
  the same loading fallback — a page whose lazy chunk is still arriving shows that shared loading state in
  place, never a blank main area — and no lazy/loading intermediate ever touches the document head or
  unmounts the shell. Surfaces that must stay warm across switches (the graph's camera, the session
  board's live terminals) declare warmth: their pane stays mounted and display-toggles instead of
  unmounting — a property any page may claim, never a session-board special case — so a route change may
  never cost a terminal its socket, and a warm page's focus/scroll context survives Back into it. True
  transient overlays (help, search, the node popup) remain modals *within* a page and close when the page
  changes.
- **Only resolved identity reaches the tab.** `document.title` and the favicon belong to the shared shell
  alone ([[dashboard-shell]] holds the one writer; [[project-identity]] resolves the value) — no page,
  chunk, or loading state writes them. The shell writes the head only once the route-selected identity has
  actually resolved (a catalog row, or the board's own answer); while it is pending, the static boot
  document stands — the default mark and the raw project id are never written as placeholders. The browser
  remembers a favicon per page URL and re-resolves it on every same-document navigation, so a placeholder
  default written during one boot keeps flashing back on later navigations — foremost on the session
  board's freshly-minted per-tab addresses. A placeholder in the head is poisoning, not cosmetics.
- **Catalog-gated project switching, never project management.** Under the multi-project gateway
  ([[projects-hub]]) a `/p/<id>/` rail keeps the persistent current-project chip pinned above the five
  project-owned page entries. Its mark and label come from the route-matched [[project-identity]], never
  an initial derived from whichever board loaded last. Its 27px mark sits 2.5px inside the 32px rail hit
  target, halving the former 5px mark-to-border gap. It keeps the rail's neutral, borderless chrome at
  rest; the standard rail background appears only on hover or while its menu is open. A SUCCESSFUL catalog probe gives that chip a menu for same-tab project
  switching plus an "All projects" door to the global `/projects` hub. Every menu row leads with the
  catalog identity mark in one aligned slot — project marks for project rows, gateway mark for the global
  row — while its accessible name and current check remain intact. Online (and legacy/unknown) project
  rows remain native same-tab links; an explicitly offline row is a disabled status item with no project
  URL, so selecting a stopped backend cannot send the shell into a dead scope. It never adds a Projects rail page
  or mounts project management inside the scoped shell. When the catalog is denied the chip still names
  the current project and becomes a single `/projects` login door; it never opens a fleet menu or leaks
  catalog rows. A direct-project guest therefore gets an explicit repair path without seeing global data.
- **One global ⌥ vocabulary; Esc never switches pages.** Page switching is the **⌥ command family**,
  window-global on every page: `⌥1..⌥4` jump straight to a page in the keyboard's stable address order
  (sessions · evals · issues · settings — `⌥1` deliberately navigates to the sessions launch hero,
  even though the rail's sessions button only changes the dock projection). The digits are the RAIL's
  order, so the graph's retirement from the rail took `⌥1` with it rather than leaving a digit pointing at
  a withdrawn destination. `⌥N` to the New Session composer, `⌥F` to the
  Evals list (the leading loss surface, so the letter door and the bare `f` agree) — matched by physical
  key (`e.code`, the mac ⌥-dead-key rule), ⌥-only so ⌘/⌃ chords stay the browser's. The family is reserved
  even over the console's raw-key nav mode (the same standing as its `⌥+I` toggle — a TUI never sees
  `M-1` or `M-f`). Graph-scoped doors stay for whoever types the graph's address: `Enter` → the session
  board, bare `f` → the Evals list, `,` → settings. `,` toggles back out of settings onto **sessions** —
  the same face an unknown address resolves to, because a toggle has to return to somewhere the workspace
  still keeps. Issues has no bare-key board door — the rail, `⌥3`, or history.
  **Esc routes nothing** — pages are peers, not layers, so Esc only closes transient overlays *within* a
  page (search, the node popup, a console menu); leaving a page is navigation: the rail, `⌥digit`, or
  history. One vocabulary for mouse (rail), keyboard, and address bar.
