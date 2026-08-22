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
