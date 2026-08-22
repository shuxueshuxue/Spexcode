---
title: tab-strip
status: active
hue: 215
desc: Several documents open at once — the address grammar in the plural, not a second navigation model beside it.
code:
  - spec-dashboard/src/tabs.js
related:
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/styles.css
---
# tab-strip

**A tab is a route.** That is the whole design, and it is why this is not a new navigation mechanism: the
address layer already carried `page + param + query` and already made every destination copyable and
Back-navigable. Opening several at once is that grammar in the plural. A tab click calls the same
`navigate` a link does, so the two can never disagree about where they lead.

**The split of truth follows what workspace editors settled on.** The OPEN LIST is a local layout
preference — it survives reloads, it is not worth putting in a link, and two people opening the same
address should not inherit each other's tabs. The ACTIVE tab is the URL. So every address stays exactly as
shareable as before, and a reader who never opens a second document cannot tell this landed: the strip does
not render until there are two, because one tab is not a strip, it is the single-document frame the board
always had.

**Identity is the canonical hash.** Two routes that print the same address *are* the same tab, so
re-opening an already-open document activates it instead of stacking a duplicate, and nothing has to dedupe
by hand. The current address is always in the strip — navigating anywhere opens a tab — because a strip
that claimed to show what is open while the reader looked at something absent from it would be lying.

**Closing hands focus to the right-hand neighbour, else the left.** That is the rule every editor uses, for
the reason every editor uses it: the reader's eye is already where the closed tab was. Closing the last one
falls back to the board rather than leaving an empty frame.

`settings` is navigable but never accumulates. It is a destination people bounce off, not a document they
keep open, and a strip that filled with visits would stop being a list of what you are working on.

**Labels come from the board's own projections** — a node's title, a session's headline — never from a
second lookup table that could drift from them. A tab for a node carries the same four-state dot its tile
does, so the strip speaks the board's vocabulary rather than inventing a tab-specific one. When a selector
resolves to nothing (a node deleted, a session closed elsewhere) the raw selector shows: an address that
names nothing is still the address the reader typed, and blanking it would hide that.

**Not yet claimed:** two documents visible at once. The model makes it reachable — a second active tab and
the existing resizable-pane primitive — but nothing here implements it, and the inline expansion of a
governed file under its spec ([[source-view]]) already covers the case the split was first wanted for.
