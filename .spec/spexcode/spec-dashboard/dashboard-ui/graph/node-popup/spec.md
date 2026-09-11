---
title: node-popup
status: active
session: sess-merge
hue: 335
desc: The `i` node popup — a reference lens on node intent; live work belongs to sessions.
code:
  - spec-dashboard/src/NodeView.jsx
related:
  - spec-dashboard/src/IssueCard.jsx
  - spec-dashboard/src/NodeDiagram.jsx
---
# node-popup

## raw source

The spec and the work it guides are one loop, but they have different durable identities. A node owns
current intent and its history; a session owns a live worktree, agent, and terminal. A terminal therefore
cannot be a node pane: one session can change several nodes, several sessions can touch one node, and the
live surface must survive board navigation. The board makes intent immediately readable; the session
interface is where that intent is changed in place.

## expanded spec

**The popup is the keyboard's lens; the document is the mouse's destination.** Since the workspace gained
a real document area ([[spec-view]]), the popup is no longer the only reading surface — it is the *skim*
surface, kept because its Shift+nav follow-the-focus walk (ten sibling docs in ten keypresses,
[[keyboard-nav]]) has no document-area equivalent. The gestures that mean "take me to read this properly" —
a node **double-click** on the board, the node menu's *view details* — leave the board and open the node as
a document instead of raising the popup. `i`/Enter keep the lens.

The node popup is the `i` surface: a fixed pop-out (`min(900px,90vw) × min(600px,84vh)`) with tabs, opened
over the board and dismissed with `Esc`. It is **reference-only** (`NodeView.jsx`) — no `work` pane, no
embedded terminal — and it is a **lens on the focus, not a pinned document**: the popup renders whichever
node currently holds board focus (keyed to it, remounting on change), so a focus move while it is open —
[[keyboard-nav]]'s Shift+nav walk — swaps the reference in place instead of forcing close-move-reopen; that
is how a run of sibling docs is read. Across such a move the **pane selection survives**: the new node opens
on the pane being read, and only when it lacks that pane does the popup fall back to the node's *own*
default — the first of its real tabs — which is exactly what keeps the edit-leads rule below intact (a
mid-change node greets with its edit tab even if the previous node was showing spec). The intent half is
the **spec doc** — an information board. A **stat bar** carries the
node's at-a-glance signals, the same the tile speaks: derived **status**, **version**, and the **drift**
count when a governed file outran the spec ([[source-of-truth]]) — so drift lives in the popup too, not
only on the tile. Below it the governed
files are the document's own chips: a `code:` entry links to the file's `#/file/<path>` document
([[spec-view]], [[file-view]]). Ordinary activation navigates the current slot to that independent file
document; the tab model supplies held navigation when the reader asks for another tab. Under them, what the
node **carries** ([[node-attachments]]): the rest of its own folder — an evidence directory, a raw
capture, a note beside the spec — uses the same file-document address grammar behind its node-owned API gate.
The popup remains a reference lens; it does not embed a source reader or make prose and code one screen.
A node that carries a diagram shows it next, inline and focusable, the same component the document uses
([[node-diagram]]). Then the body as a living current-state document (the two
labelled parts — raw source / expanded spec — when authored that way, else the flat body). Neither part is
an agent-authored *current state* — what's-done is read from the derived status, never narrated, because
agents hallucinate completion. The proof and
evolution of that intent live in the **history** tab.
An **issues** tab lists the unified issue work bound to this node — local and forge, open and closed alike,
with both counts on the tab face (the board shows only the lean counts; see [[dashboard-issues]]). Opening
the tab requests page 1 from [[paged-review]] with the fixed `node:` qualifier; no issue row rides the board.
Each entry is the shared compact `IssueCard`, clamped inside the popup and routed to the internal Issues
page selection (`#/issues/<issue-id>`), not directly to the forge. A long pane earns an **extremely compact
embedded face of the canonical Issues filter**: the same query parsing, conjunctive facet semantics, and
real issue fields as [[issues-view]], projected through shared configuration/data adapters rather than a
popup-only filter implementation ([[review-filters]]). Short lists skip the affordance entirely. Its state belongs to the pane,
survives tab switches while the popup stays open, and never mints a competing page address; following a
result still lands on the canonical Issues detail route. An **edit** tab makes a
node's in-flight change reviewable from the board: it exists **only** while the node has a pending overlay,
and when it does it **leads** (first tab, editing-session count on its face), so a node mid-change — a
freshly-added ghost most of all, otherwise near-empty on spec/history — opens with its change front-and-
centre. It lazily fetches the change to the node's spec.md in the editing worktree against the fork point
(`/api/edit`). The change is git's own word diff, and the pane renders it as a **redline**: words both sides
share are plain, removed words are struck through, added words are tinted, and each hunk is a block labelled
with its starting line. A spec body is hard-wrapped prose, so a line diff reports every re-wrapped line of a
touched paragraph as removed and re-added, and the reader has to hunt for the few words that actually moved.
A word diff ignores re-wrapping and marks only those words. Git computes the diff; the dashboard runs no diff
algorithm of its own. Each worktree's section opens with the shared op mark, the owning session (a link into
it when the board has a live row for it, otherwise the branch name), and whether the change is committed.
It is **memoised** like the history tab (re-opening shows the last change at once instead of
reloading) and **revalidated** on every open, since a pending change is live. The history tab keeps its line
diff.

`panesFor(node)` is the single source of which tabs exist and their order — both the tab bar and App's
keyboard pane-nav read it, so number/Tab keys never cycle to a tab that isn't there. The tab CAPTIONS are
plain labels — no visible key-digit markers (the digit keys still switch panes; that vocabulary belongs to
[[keyboard-nav]] and the help legend, not stamped on every caption) — and the issues tab tallies its
state on its face as an open count and a closed count; a zero count simply doesn't render. The compact
filter row that pane carries leads with the ONE result summary — *showing X of Y* from [[paged-review]]'s current-page item
count and full filtered `total`, never by treating the current 25 rows as the whole model — full words on desktop, a bare X/Y
under the phone breakpoint with the sentence kept in the aria-label; no second control, no facet echo, no
repeat of what the caption already tallies. When `Y > X`, a true **View all** anchor opens the canonical
Issues list with the same fixed `node:` and current compact query, so every result remains reachable.
`panesFor` registers exactly the spec, history and issues panes (edit joins them while a change is in
flight); the issues tab's content is [[dashboard-issues]]', while this node owns the popup shell and the
panes themselves. The **history** tab is
the one merged version log: the latest version sits expanded with its proof, older ones start collapsed and
reveal one at a time on the **down gesture** once you've finished the open one — scrolling past its end, *or*
a `j`/`↓` keypress when there is nothing left to scroll (a short history with no scrollbar, or the bottom of
a long one). Tying reveal to the gesture, not to scroll movement alone, is what keeps a sub-page history from
dead-ending with older versions forever hidden (a header click also toggles by hand). Disclosure stays
strictly per-entry: there is no expand-all control or bulk-expand replacement, so the down gesture and
row-header toggle remain the complete interaction. The version log itself
fetches **when the history tab first shows** (lazy, like edit — most popup opens never visit it) and
persists after, so returning to the tab stays instant. A version's proof is
the **spec.md line diff** it introduced, fetched lazily on expand — every version, memoised by hash (the
latest no longer shipped precomputed); a version with no recorded change says so plainly. That scaffold — scroll container,
latest-expanded reveal, click-toggle, and the per-row header-over-evidence shape — is **data-agnostic**:
the history tab is its one rider, and a row's outbound affordance renders as a sibling of its toggle, never
nested inside it.

The "change it in place" surface — the live terminal — belongs to the *session* doing the changing
(`Enter`; see [[session-console]] and [[command-box]]), keyed to that session rather than pinned to a node.
The graph-only static build is a read-only projection: it supplies the node body from the embedded public
document, exposes only the spec pane, and never attempts backend history/issues/edit requests. The full
dashboard keeps the complete pane registry above. The panel sizes to **itself**, never to xterm's measured
width (each pane scrolls its own content, no stray horizontal scrollbar) — but that sizing lives in `styles.css`, the dashboard's shared stylesheet governed by
[[node-graph]]; this node owns only the popup component, so a style change elsewhere is never drift here.
The original intention survives as one work loop across two truthful surfaces: intent in the node popup,
live change in the session console.

**The body renders through the one shared [[prose-renderer]], which stamps line provenance.** Rendering
markdown is lossy on purpose — paragraphs re-flow, markers are eaten, blank lines vanish — so nothing in the
rendered prose says which lines of the file it came from. The renderer keeps each block's source lines, so
each block it emits carries the body lines that produced it; [[prose-selection]] reads those stamps back to turn a reader's
selection into a line range. Stamping is opt-in per render: a caller that can vouch for where its text sits
in the body passes that offset, and a caller that cannot (an issue body is not a spec body) passes nothing
and gets no stamps at all — a wrong line number would be worse than no addressing. The two-part card
places each part against the whole body before rendering it, and a part it cannot place renders exactly as
before, simply unstamped.

Inline `[[id]]` references emitted by this renderer are document anchors, not decoration: they point to
`#/spec/<id>` and use [[tab-strip]]'s hold gesture for Ctrl/Command-click. The popup and full document
therefore expose the same plain navigation contract.

The current body slice also keeps ordinary Markdown visible as its authored structure: ATX headings retain
their level (`h1` through `h6`), blockquotes remain quoted blocks, standard HTTP(S) links are real anchors,
and Markdown images remain bounded to the body width. These forms share the same line stamps as the blocks
that contain them; unsupported or malformed markup remains escaped readable prose.
