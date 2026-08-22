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
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
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
shareable as before. The strip renders from the first tab: it is where the current document's NAME lives,
and chrome that only appears when a second document exists would jump the layout at exactly the moment of
the reader's first hold.

**Looking is not holding.** The strip is the working set — what the reader has deliberately kept — and
browsing must never grow it. A plain navigation (an explorer row, a board double-click, a link) REPLACES
the active tab's slot, the way every workspace editor treats an unpinned pane; holding is the explicit
gesture, ctrl/⌘-click, which appends a new tab (`requestTab` — a one-shot latch the finding surfaces set
before navigating, consumed by the strip's own route subscription, so no finding surface ever touches the
strip's state). Before this boundary every glance became a tab and ten minutes of browsing turned the strip
into a history list — a different, worse widget. Appending also happens when there is no slot to replace:
the first document of a session is always kept.

**Identity is the canonical hash.** Two routes that print the same address *are* the same tab, so
re-opening an already-open document activates it instead of stacking a duplicate, and nothing has to dedupe
by hand. The current address is always in the strip — by replacement or by keep — because a strip that
claimed to show what is open while the reader looked at something absent from it would be lying.

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

**Two documents at once is the shell's** ([[workspace-shell]]): alt-clicking a tab sends its document to
the second pane. The strip only names the gesture; the pane is workspace state, not a tab.
