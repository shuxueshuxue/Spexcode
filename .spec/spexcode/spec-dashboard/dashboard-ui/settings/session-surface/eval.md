---
scenarios:
  - name: browser-project-session-surface-resolution
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
    code: [spec-dashboard/src/sessionSurface.js]
    related: [spec-dashboard/src/Settings.jsx, spec-dashboard/src/SessionInterface.jsx]
    description: >-
      In a real Chromium session, select Conversation for one pane-backed session, reload it, and use the
      Settings default for a second unchosen session before explicitly returning that session to Terminal.
    expected: >-
      The store resolves each pane-backed base surface as explicit session choice, then project-local default,
      then Terminal. The first Conversation and the second Terminal survive reload independently; changing the
      default never rewrites either explicit choice. Browser storage is the only persistence boundary.
---

# session-surface - yatsu

Drive the actual toolbar and Settings controls in Chromium. Reading localStorage is corroborating evidence for
the browser interaction, not a substitute for it: the visual surface, reload, and mutually exclusive panes are
the observed product behavior.
