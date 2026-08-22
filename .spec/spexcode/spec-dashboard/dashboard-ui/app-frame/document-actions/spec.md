---
title: document-actions
status: active
hue: 215
desc: The shell-owned registry for actions belonging to the active document.
code:
  - spec-dashboard/src/documentActions.jsx
related:
  - spec-dashboard/src/TabStrip.jsx
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

**An action that owns a menu declares it.** `haspopup` marks the button as a menu opener, which is both its
a11y contract and the one thing an outside-press dismissal needs to know: a press on a declared opener is
that opener's own, so pressing it again toggles the menu instead of the dismissal closing it and the click
reopening it. Dismissal listens for the PRESS, not the click — the press that opened a menu is over before
the menu exists, so it can never close what it just opened.
