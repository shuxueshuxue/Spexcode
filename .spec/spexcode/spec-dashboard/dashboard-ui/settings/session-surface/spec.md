---
title: session-surface
status: active
hue: 160
desc: One browser- and project-local preference store resolves each pane-backed session's mutually exclusive Terminal or Conversation base surface.
code:
  - spec-dashboard/src/sessionSurface.js
related:
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/project.js
  - spec-dashboard/src/sessionSurface.test.mjs
---

# session-surface

A pane-backed session has one visible base surface: Terminal or Conversation. This store owns that local
presentation choice, not session state. Its scoped localStorage payload contains a default and only explicit
per-session overrides. Valid values are exactly `terminal` and `conversation`; the default is Terminal.

Resolution is an explicit session URL face (`?surface=terminal|conversation`) when present, then the session
override, then the saved default, then Terminal. An explicit URL face writes the same per-session override;
the default URL leaves it untouched. Updating the default never rewrites session overrides. Updating a session
override publishes the new value to the currently mounted console immediately. The storage key includes the current project scope, so one browser's choice for project A cannot
affect project B; browser storage remains optional, with the same live in-memory result while unavailable.

Headless sessions do not consume this store: they are always Conversation. Resource tabs are likewise outside
this store; they temporarily cover the resolved base surface and return to it when closed.
