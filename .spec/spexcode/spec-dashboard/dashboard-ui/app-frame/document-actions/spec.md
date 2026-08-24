---
title: document-actions
status: active
hue: 215
desc: The shell-owned registries for what a document tells the frame about itself — its actions, and its name.
code:
  - spec-dashboard/src/documentActions.jsx
related:
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/StatusBar.jsx
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/workspace-shell/spec.md
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/tab-strip/spec.md
---
# document-actions

The document-actions slot is the tab row's right-edge action surface. A document contributes data through
`useDocumentAction`; the shell contributes the stable registration API and the tab strip contributes the
buttons. Each registration has a document route key, a stable action id, an icon, an accessible label, and a
callback. The state context changes as documents register or dispose, while the API context remains stable so
registrants do not loop when a neighbouring document changes.

The tab strip filters by the active route key. It renders no slot when no action is registered, and it renders
no action from an inactive document. A disabled action stays visible with the document's availability reason
as its tooltip. Optional popup content is rendered inside the action's wrapper, so a picker remains owned by
the slot rather than rebuilding an internal document toolbar.

**A popup must be able to leave the band it is anchored in.** The wrapper positions it under its button; the
band around it must not clip, or the picker paints correctly into a 30px box and the reader sees nothing —
the failure looks exactly like a dead button, because the only visible evidence is the button's own pressed
state. The strip therefore separates the band from the tab scroller ([[workspace-shell]]).

**An action the frame cannot draw, draws itself — and then has to say when it changed.** Most actions are an
icon and a label, and the slot renders them. Some carry content only the document can compute: the session's
Eval door is a real anchor wearing a live measurement glance ([[session-console]]), which is a destination and
a reading, not a callback. Such an action supplies its own element, and the slot renders that element in place
of the button it would otherwise draw. The cost is that registration can no longer tell whether the action
changed: an element is opaque to a value comparison, so a registry that compared only the drawable fields
would keep the FIRST element it was handed while the data behind it moved on — a door still showing last
week's counts. So a self-drawn action names its own render state (`nodeKey`), which is the same device
`menuKey` already is for a popup: the ONE thing the frame needs to know about content it cannot inspect.

**An action that owns a menu declares it.** `haspopup` marks the button as a menu opener, which is both its
a11y contract and the one thing an outside-press dismissal needs to know: a press on a declared opener is
that opener's own, so pressing it again toggles the menu instead of the dismissal closing it and the click
reopening it. Dismissal listens for the PRESS, not the click — the press that opened a menu is over before
the menu exists, so it can never close what it just opened.

## a document's own name

The other thing a document knows and the frame cannot work out is what it is CALLED. [[tab-strip]] labels
every tab from the board's resident projections, and that covers everything the board holds — a node's
title, a session's headline. An issue is the exception: the issues board is paged and a detail fetches its
own, so the strip had the id and nothing else, and drew `#7f3a1b2c` where the reader had written a
sentence.

So the document reports its name and the frame keeps it. Two properties make this a name registry rather
than a cache:

- **One writer per name, and it is the thing named.** That is why this is not the second lookup table the
  strip forbids — that rule forbids a second SOURCE free to disagree with the first, and there is no second
  source here. A document that never reports leaves its tab on the raw selector, which is the same honest
  fallback an unresolvable selector already gets.
- **A name outlives its document's mount**, so it is a module store rather than a context value with
  unmount cleanup. The mounted-document pool evicts documents the strip is still holding tabs for
  ([[workspace-shell]]); a name that died with the mount would blank a label the reader is still looking at.

Keyed by the OBJECT address — page plus selector, no query — because the name belongs to the thing, not to
whichever view state an address variant carries. Actions key on the full canonical hash for the opposite
reason: two faces of one session are two action sets and one name.
