---
title: context-dock
status: active
hue: 205
desc: The right context dock — the routed spec node's scenarios and open issues, collapsed until asked for.
code:
  - spec-dashboard/src/ContextDock.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/score.jsx
  - spec-dashboard/src/reviewPage.js
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/ReviewShell.jsx
  - packages/spec-core/src/review/reviewQuery.js
  - spec-dashboard/src/styles.css
---
# context-dock

The right-hand CONTEXT region answers “what surrounds this thing?”. It is a property of the document being
read, not a second finding surface and not another tab. The dock therefore follows the shell's routed
`{page, param}` for the **primary** document. In a split layout it deliberately continues to follow the
primary route and never follows the second pane: context answers the document the reader routed to, while
the second pane is an independently held document.

The dock exists only for `#/spec/<id>`. Other route kinds have no context projection, so they render no dock
and no empty placeholder.

**There are two sections, and the count is the contract**: *"它要么就是 Scenarios，要么就是 Issues"*. A node's
context is what has been ASKED of it and what has been MEASURED on it — the two things that are true of this
node and nothing else.

- **SCENARIOS** joins the current node's declared scenario names with the latest result rows from the shared
  eval review projection. The join uses `scenarioStates` and the existing score badge vocabulary. Each row
  is a real `#/evals/<node>/<scenario>` anchor. An unmeasured declaration remains visible with the missing
  score state; a latest reading supplies pass, fail, or stale state.
- **ISSUES** lists the node's open issues through the SAME paged review request the Issues board serves
  ([[paged-review]]) with the node qualifier applied — the panel and the list it would link to are literally
  one query text, so neither can develop its own idea of what "open" or "this node's" means. Each row is a
  real `#/issues/<id>` anchor and leads with the shared issue-state primitive its list row leads with, never
  a dock-local glyph.

**BACKLINKS is retired, and the projection that fed it went with it.** The panel listed nodes whose prose
named this one plus nodes parented to it, and the ruling against it was about what a node's CONTEXT is: a
mention reverse-edge is a graph-navigation concept — who cites whom — not a property of the node the reader
has open, and mixing it in made the dock answer a third question nobody had asked here. The loader's
`mentions` projection existed for exactly this panel, so it was deleted in the same move
([[source-of-truth]], [[graph-lean]]): a thin frontend consumer dying is a reason to stop feeding it, not a
reason to keep shipping the field on every node forever. The `bodyMentions` parser stays — its real job is
[[spec-lint]]'s mention rule, which has to resolve a `[[name]]` whether or not anything draws the edge.

**Every row is a detail door on the workspace's slot semantics.** A plain click reads the scenario or issue
in the current slot; ctrl/⌘ holds it as its own tab ([[tab-strip]]). No row opens a second-level panel
inside the dock: everything listed here has a real detail address, and a document with an address belongs in
the strip rather than nested inside a sidebar.

**The dock starts CLOSED, and the number is the argument.** Measured at 1440 with the explorer docked:
opening it leaves the spec prose **383px** and forces the code column down from 620 to 536; closed, the same
document reads at **575px**. 383px is under a readable measure, and it is taken out of the column that was
already the scarce one. Context is a question the reader ASKS about the node they are reading — it is not
the reading — so it does not spend the reading's width until it is asked for.

That measurement is also why the two sections are a PANE and not an inline strip inside the prose. The
alternative considered was a paper-divider block appended to the document's own column, borrowing the review
lists' row rhythm; it looks lighter and is not, because it spends the prose column PERMANENTLY instead of on
demand — the same 383px problem with no toggle. A pane that is closed costs nothing, and when it is opened
its rows get a full 276px of their own rather than competing with the sentence beside them.

The dock width uses `useResizable('spex.ctxWidth', ...)` and keeps the same min/max and release-time
localStorage persistence as the other shell panes. Panel disclosure and the dock's open state are local
preferences in localStorage; the dock defaults CLOSED and each section defaults expanded, so asking for
context once gets the reader everything rather than a second round of clicks. A closed dock renders nothing
— no rail, no collapsed spine — so it adds no band to [[ui-state-model]]'s budget when it is not showing.
Getting there is a MOVEMENT, on the frame's one shared fold ([[dock-modes]]): the dock outlives the closed
state by exactly one `--dur-panel` and slides out, then unmounts, so the resting cost is still nothing while
the gesture is still visible. Because the fold animates width, the dock clips its own overflow, and its two
panels therefore scroll together inside it — the alternative to that scroller is not "no scroller", it is a
long issue list clipped out of reach. The resize grip stays outside the scroller so it cannot scroll away
from the edge it drags.
The open/close control lives in the document-area top bar beside the tabs: the workspace-shell rule says a
control belongs to the region whose question it answers, and context is neither the left finding rail nor
ambient status, so a document-level context control is the least surprising owner while still remaining
reachable when the dock is closed. Both dock switches speak ONE vocabulary — the shared mirrored panel pair — because they are the same kind of
control: a dock's open/closed state. The rail's switch flips the pair as the LEFT dock's layout state; this
one holds `panel-right` fixed and carries its state in `aria-pressed` and the active tint. The asymmetry is
forced by the glyphs themselves: the pair has no empty-frame member, so a flipping right-dock switch would
have to draw `panel-left` — a panel on the region it does not own — to mean "closed". A glyph that names the
dock is readable in every combination; a glyph that pictures the wrong side is not.

The component receives `{page, param}` from `Shell`; it never reads the global address. Its API context and
state context remain separate by using the existing board/workspace hooks rather than introducing a mixed
context. A failed eval projection is shown as an explicit panel error; it is not silently rendered as an
empty scenario list.
