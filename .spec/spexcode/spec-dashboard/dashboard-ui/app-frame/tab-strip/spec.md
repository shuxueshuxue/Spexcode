---
title: tab-strip
status: active
hue: 215
desc: The workspace document strip — one address grammar for opening, focusing, and closing documents.
code:
  - spec-dashboard/src/tabs.js
related:
  - spec-dashboard/src/tabModel.js
  - spec-dashboard/src/tabModel.test.mjs
  - spec-dashboard/src/subtractive-boundaries.test.mjs
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/dragGesture.js
  - spec-dashboard/src/tabStrip.test.mjs
  - spec-dashboard/test/tab-click-activates.e2e.mjs
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/SessionForestPanel.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/SessionsView.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/keymap.js
  - spec-dashboard/src/route.js
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/styles.css
---
# tab-strip

The strip is the workspace working set. It is present on every route, uses the shared `page + param + query`
address grammar, and never creates a second navigation model. Object documents include sessions, files, and
spec nodes, each addressed by its own identity; a resident board (Evals, Issues, Settings) uses one canonical tab
identity while its detail remains route state, because the strip names the board and not the selection inside it.
Graph, empty workspace, bare Sessions, and the New Session form have no document identity and therefore do not
become tabs.

The open list is local workspace state OF ONE PROJECT; the active tab is the URL. A tab is an address
inside a project — a session id, a spec node id, a file path — so the working set is stored under that
project's scope ([[dashboard-shell]]) and never under a bare, origin-wide key: the gateway serves every
project from one origin, so a bare key gives every project on the host the same strip, and opening a
document in one project then shows and closes it in another. A tab click and an ordinary link use the same
navigation path, so the strip, deep links, and browser history agree. Session base faces are URL selectors on one
session tab; published resources are separate file-class tabs. The shell owns the strip's position in the
frame and the document-actions slot at its right edge; documents do not render a second tab rail.

Every tab is an ordinary tab. There is no pinned or preview state: a tab is an address in the working
set, drawn the same way whether it arrived by a plain click, by ctrl/⌘-click, or by creating a session, and
replaced the same way. A tab that could not be replaced was a tab whose history the reader had to remember;
the strip does not ask that of anyone.

**THE WORKING SET IS A TREE OF GROUPS.** One group is the ordinary workspace and behaves exactly as one
strip always did. Splitting one makes a pair; splitting again makes a grid, because the tree is only two
shapes and both nest:

- a **GROUP** is a strip and the documents it holds, with one of them showing. Its band is a real tab strip,
  so a document moved into a group lands in a list the reader can keep growing — not in a slot that holds one.
- a **SPLIT** is two subtrees sharing one box, beside each other or above and below, at a ratio the reader
  drags. It carries no documents of its own; collapse it and its surviving child takes the space.

**A document is in exactly one group.** That invariant is what every move here preserves, and it is why
splitting is a MOVE rather than a copy — a document drawn twice would be two answers to "where is it", and
the strip's own verbs (close others, the tab list) could not name which one they meant. Five rules complete
the model, and each is that invariant seen from one more side:

- **Splitting moves the tab into a new group** beside (`row`) or below (`col`) the one it was in, and that
  group takes focus: the reader pointed at that document, so that is where they now are. A group's ONLY tab
  cannot be split off — the source would empty and the split would collapse in the same gesture — so the verb
  says it is unavailable rather than doing nothing.
- **A drag is the same move without a new place for it.** Dropping a tab on another group's strip moves it
  there, at the position the pointer named; dropping it inside its own strip is the ordinary reorder.
- **An emptied group collapses**, whether it emptied by a drag or by closing its last tab, and its space
  returns to its sibling. The reader lands on that sibling's own document rather than on a blank half-window.
- **Navigating to an address that is open in another group focuses that group** and shows it there. The
  strip must contain the address the reader is on, and one document cannot be in two places, so the workspace
  moves the reader rather than cloning the document.
- **The focused group owns the address bar.** Its showing document IS the URL; moving focus names that
  group's document with a replacing navigation, so the address never describes a cell the reader left.

A route that is NOT a document — the graph, the launch page, the empty workspace — is something the reader
is looking at without holding, so the focused group shows it in place of its own document until a document
address lands again. With no groups at all there is no tree: the routed place is drawn on its own.

The tree survives a reload with the workspace, and a reload that finds the invariant broken — an older
release's flat list, its held slot beside it, a second window's write — repairs it into a valid tree before
painting rather than showing the same document twice.

The cross-surface law is one mechanism: row surfaces use the shared new-tab predicate and tab APIs, while
views write addresses through their host scope — a view's `hold` intent names an address, which joins the
working set before it is moved into the slot. The strip itself owns no session lifecycle actions beyond the shared
tab close menu; session rename/archive/close remains the session document or row menu's concern.

## Desktop-realised affordances

Two gestures are written once here and are merely latent in a browser tab. **⌘/Ctrl+W closes the active tab and
⌘/Ctrl+1–9 focus the Nth tab**: each ordinal is a fixed registry action, with ⌘/Ctrl+9 selecting the last tab;
in a browser those keys belong to the browser and never reach the page, which is why the shell chords are
Alt+Shift; on macOS the desktop Window menu ([[spec-desktop]]) owns the native accelerators as the reliable,
discoverable route and injects the equivalent page keydown, so the keymap ([[keyboard-service]]) fires and
[[tab-lifecycle]]'s close destination decides where focus goes. Whether an unclaimed ⌘ chord would otherwise
reach the page is not established. On Linux, Ctrl chords arrive directly at the page. **Tear-off**: a drag whose release
point is outside the viewport and has no in-strip landing opens the tab's own full URL (including the current
`/p/<id>/` scope) through `window.open` and removes it through the same close path — a popup in a browser, a
real window in the desktop. Both windows talk to the same backend, so no state crosses between them. Neither
gesture asks whether it is running in Electron.
