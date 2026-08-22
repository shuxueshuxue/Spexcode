---
title: tab-strip
status: active
hue: 215
desc: Several documents open at once — the address grammar in the plural, not a second navigation model beside it.
code:
  - spec-dashboard/src/tabs.js
related:
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/EmptyView.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/styles.css
---
# tab-strip

**A tab is an object route.** Board faces are finding surfaces; the strip holds only object-shaped addresses:
`#/spec/<id>`, `#/file/<path>`, `#/sessions/<id>[?surface=…]`, `#/sessions/new`,
`#/evals/<node>/<scenario>`, and `#/issues/<id>`. `#/graph` (including `#/graph/<node>` focus), bare
`#/sessions`, bare `#/evals`, and bare `#/issues` are never tabs. This is why the strip is empty on a fresh
`#/graph` load and why returning to the graph does not mint a tab.

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

**There is no address-replacement semantic.** Once a resident tab exists, its address is immutable. The only
exception is the single preview slot, and its type fence is deliberately narrow:

- only `spec` and `file` documents may be preview;
- `sessions`, `evals`, and `issues` details are always resident;
- opening a preview replaces only the previous preview, never a resident tab;
- localStorage migration marks every legacy tab resident.

The type fence is the strongest protection: session/terminal capability is absent from the preview type, so a
session can never be accidentally displaced by document browsing. This follows orca's
`canReplacePreviewContentType` principle: capability that is absent in the type is not a runtime convention
that can drift.

**Looking is not holding.** Explorer single-click opens a spec/file in preview; ctrl/⌘-click, row double-click,
graph node double-click, and tab double-click promote/open a resident tab. Graph node single-click remains
focus-only. Opening another document from a preview promotes the current preview first, then appends the new
resident document. The slot rule is complete:

| gesture | destination | result |
| --- | --- | --- |
| explorer single-click | spec/file | replace the one preview slot, or append it when empty |
| resident navigation | any document kind | append a tab; never replace an existing address |
| preview navigation | spec/file | replace only the previous preview |
| ctrl/⌘, double-click, or promotion | any document kind | append/promote a resident tab |

The mode latch is consumed by the strip's own route subscription, so finding surfaces do not touch strip state.
The object-only registry still means a fresh `#/graph` or bare list route never creates a tab.

**Identity is the canonical hash.** Two routes that print the same address *are* the same tab, so
re-opening an already-open document activates it instead of stacking a duplicate, and nothing has to dedupe
by hand. The current address is always in the strip — by replacement or by keep — because a strip that
claimed to show what is open while the reader looked at something absent from it would be lying.

**A preview is visibly italic and weakened.** It is still a real route and can be copied, reloaded, closed, or
promoted; the visual treatment names its replaceable status without inventing another tab kind.

**Closing hands focus to the right-hand neighbour, else the left.** That is the rule every editor uses, for
the reason every editor uses it: the reader's eye is already where the closed tab was.

**Closing the LAST tab yields the explicit empty state**, `#/empty` — not the graph. The graph is a
finding surface, not the floor the workspace falls onto: navigating to it on a close meant a gesture that asked for
nothing put a document on screen, and the board appeared to surface from underneath the reader's own work,
which is the disorientation this rule exists to remove. An empty workspace is a real state and it says so —
the frame stays whole (rail, dock, status bar), the content area names the state, and it offers the three
ways back into a document: search, the explorer, and the graph as an ordinary anchor like any other
document's. `empty` is an ADDRESS so the state can be landed on, reloaded and left, but it is not a
document ([[view-registry]]): a tab for it would be the one address that contradicts the strip it sits in.
Only closing the last tab mints it — a fresh load with no tabs still opens the graph, because starting with
nothing held is not the same event as putting your last document down.

`settings` is navigable but never accumulates. It is a destination people bounce off, not a document they
keep open, and a strip that filled with visits would stop being a list of what you are working on.

**Labels come from the board's own projections** — a node's title, a session's headline plus its i18n face
suffix — never from a
second lookup table that could drift from them. A tab for a node carries the same four-state dot its tile
does, so the strip speaks the board's vocabulary rather than inventing a tab-specific one. When a selector
resolves to nothing (a node deleted, a session closed elsewhere) the raw selector shows: an address that
names nothing is still the address the reader typed, and blanking it would hide that.

**Two documents at once is the shell's** ([[workspace-shell]]): alt-clicking a tab sends its document to
the second pane. The strip only names the gesture; the pane is workspace state, not a tab.
