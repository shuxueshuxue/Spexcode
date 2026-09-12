---
title: context-dock
status: active
hue: 205
desc: The right context dock — the routed spec node's open issues and its version history, collapsed until asked for.
code:
  - spec-dashboard/src/ContextDock.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/reviewPage.js
  - spec-dashboard/src/specHistory.js
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/ReviewShell.jsx
  - packages/spec-core/src/review/reviewQuery.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/spec-history-dock.e2e.mjs
  - spec-dashboard/test/split-region.e2e.mjs
---
# context-dock

The right-hand CONTEXT panel answers “what surrounds this thing?”. It is a property of the document being
read, not a second finding surface and not another tab — so it belongs to a REGION rather than to the window
([[workspace-shell]]): each region draws its own dock for its own document, at its own right edge, with its
own open/closed state. Two spec nodes read side by side therefore get two docks, each describing its own
node. The dock used to follow the routed document only, which left a held document with no context at all;
"context is a property of the document" and "there is one dock, and it belongs to the address bar" cannot
both be true, and the first is the one worth keeping.

The dock exists only for `#/spec/<id>`. Other route kinds have no context projection, so they render no dock
and no empty placeholder.

**The sections are the contract.** The ruling *"它要么就是 Scenarios，要么就是 Issues"* fixed a node's context
as facts ABOUT THE NODE ITSELF — what has been asked of it, what has been measured on it — and nothing drawn
from the graph around it. Nothing is measured on a node now. The reader then asked for the node's own past
beside the prose (*"在 Spec 的阅读界面上面右侧边栏里面，可以选择查看它的历史版本或者查看历史变更"*): how the
node came to say what it says is a fact about that node in exactly the same sense, so the dock carries two
sections.

- **ISSUES** lists the node's open issues through the SAME paged review request the Issues board serves
  ([[paged-review]]) with the node qualifier applied — the panel and the list it would link to are literally
  one query text, so neither can develop its own idea of what "open" or "this node's" means. Each row is a
  real `#/issues/<id>` anchor and leads with the shared issue-state primitive its list row leads with, never
  a dock-local glyph.
- **HISTORY** lists the node's versions newest first, from the SAME version log the popup's history pane
  reads ([[node-popup]]; one read module, `specHistory.js`). A row names its version (`v3`), its commit
  subject, its date and its `+N −N` in the one diff vocabulary ([[diff-marks]]), and offers the choice the
  reader asked for as two doors into the document ([[spec-view]]): the row itself opens that version's TEXT
  (`#/spec/<id>?version=<hash>`), and the `git-compare` door beside it opens the CHANGE that version made
  (`?version=<hash>&surface=diff`). The newest version's text is the current document, so its text door is
  the bare `#/spec/<id>` — which also makes the list the way back from any past version. The row the
  document is showing wears the selected wash and marks the door it is showing through as current; the
  pending-change face is not a version, so it marks no row. The log is re-read when the node re-versions,
  it never shows another node's log while a new node's loads, and a failed read is shown as an error, never
  as "no versions".

**BACKLINKS is retired, and the projection that fed it went with it.** The panel listed nodes whose prose
named this one plus nodes parented to it, and the ruling against it was about what a node's CONTEXT is: a
mention reverse-edge is a graph-navigation concept — who cites whom — not a property of the node the reader
has open, and mixing it in made the dock answer a third question nobody had asked here. The loader's
`mentions` projection existed for exactly this panel, so it was deleted in the same move
([[source-of-truth]], [[graph-lean]]): a thin frontend consumer dying is a reason to stop feeding it, not a
reason to keep shipping the field on every node forever. The `bodyMentions` parser stays — its real job is
[[spec-lint]]'s mention rule, which has to resolve a `[[name]]` whether or not anything draws the edge.

**Every row is a detail door on the workspace's tab semantics.** A plain click reads the issue — or the
version — in the focused tab; ctrl/⌘ opens it as its own tab ([[tab-strip]]). No row opens a second-level
panel inside the dock: everything listed here has a real detail address, and a document with an address
belongs in the strip rather than nested inside a sidebar. A version is not a new document but a face of the
node's own ([[tab-routing]]), so reading one replaces the spec tab's address instead of adding a tab, and the
276px column never has to hold a body or a diff.

**The dock starts CLOSED, and the number is the argument.** Measured at 1440 with the explorer docked:
opening it leaves the spec prose **383px** and forces the code column down from 620 to 536; closed, the same
document reads at **575px**. 383px is under a readable measure, and it is taken out of the column that was
already the scarce one. Context is a question the reader ASKS about the node they are reading — it is not
the reading — so it does not spend the reading's width until it is asked for.

That measurement is also why the section is a PANE and not an inline strip inside the prose. The
alternative considered was a paper-divider block appended to the document's own column, borrowing the review
lists' row rhythm; it looks lighter and is not, because it spends the prose column PERMANENTLY instead of on
demand — the same 383px problem with no toggle. A pane that is closed costs nothing, and when it is opened
its rows get a full 276px of their own rather than competing with the sentence beside them.

The dock width uses `useResizable('spex.ctxWidth', ...)` and keeps the same min/max and release-time
localStorage persistence as the other shell panes. Panel disclosure and the PRIMARY region's open state are
local preferences in localStorage; a held region's dock starts closed and remembers only while that document
is held, because a document sent right must not spend the other document's width uninvited. The dock defaults
CLOSED and each section defaults expanded, so asking for context once gets the reader everything rather than
a second round of clicks. A closed dock renders nothing
— no rail, no collapsed spine — so it adds no band to [[ui-state-model]]'s budget when it is not showing.
Getting there is a MOVEMENT, on the frame's one shared fold ([[dock-modes]]): the dock outlives the closed
state by exactly one `--dur-panel` and slides out, then unmounts, so the resting cost is still nothing while
the gesture is still visible. Because the fold animates width, the dock clips its own overflow, and its two
panels therefore scroll together inside it — the alternative to that scroller is not "no scroller", it is a
long issue list clipped out of reach. The resize grip stays outside the scroller so it cannot scroll away
from the edge it drags.
The open/close control belongs to the document area and stays at its REGION's right edge: one slot per region
paints it over that region's band while the dock is closed and over the context head while the dock is open. The
same `28px` target stays mounted through the dock's width animation, with the same `4px` right inset, so
opening and closing keep the pointer over the control without a replacement flash. The
workspace-shell rule says a control belongs to the region whose question it answers, and context is neither
the left finding rail nor ambient status, so this document-level control is the least surprising owner while
remaining reachable in both states. Both dock switches speak ONE vocabulary — the shared mirrored panel pair
— because they are the same kind of control: a dock's open/closed state. The rail's switch flips the pair as
the LEFT dock's layout state; this one holds `panel-right` fixed and carries its state in `aria-pressed` and
the active tint. The asymmetry is forced by the glyphs themselves: the pair has no empty-frame member, so a
flipping right-dock switch would have to draw `panel-left` — a panel on the region it does not own — to mean
"closed". A glyph that names the dock is readable in every combination; a glyph that pictures the wrong side
is not.

The component receives `{page, param, query}` from its region; it never reads the global address, which is
what lets the held region hand it a document the address bar does not name. The query
selects nothing in the dock — the dock is the same for every face of the node — it only says which version
row the document is showing. Its API context and state context remain separate by using the existing
board/workspace hooks rather than introducing a mixed context. A failed issues or history request is shown
as an explicit panel error; it is not silently rendered as an empty list. The history read lives in its own
light module rather than in the popup's component file, because the dock mounts with the shell and must not
pull the prose renderer into the shell's chunk.
