---
scenarios:
  - name: session-route-surface-ownership
    description: >
      Exercise the routed session document and its terminal/conversation surface choices, including resource
      faces and the document action toolbar.
    expected: >
      A selected session remains one top-level document while the surface query changes the visible face;
      resources use separate file-class tabs and the console does not create a second tab rail.
    tags: [desktop]
    code: [spec-dashboard/src/SessionsView.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/sessionSurface.js]
---

Measure this contract through the dashboard's session surface tests and a settled browser session document.
