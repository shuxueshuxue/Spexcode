---
title: session-surface
status: active
hue: 160
desc: The session address carries the one visible surface axis; the browser-local preference store only resolves the bare address's base default.
code:
  - spec-dashboard/src/sessionSurface.js
related:
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/project.js
  - spec-dashboard/src/sessionSurface.test.mjs
---

# session-surface

A pane-backed session has one visible surface selected by its address: `?surface=conversation|terminal|diff` or
`?surface=resource:<resourceTabKey>`. The address is the only visible-face selector and is a pure function of
the current URL. Only a user gesture writes it (ordinary navigation or opening/closing a tab); background board
updates never navigate. A bare `#/sessions/<id>` resolves the browser-local base preference and is otherwise
stable.

This store owns only that bare-address base default, not session state or resource selection. Its scoped
localStorage payload contains a default and explicit per-session base overrides. Valid stored values are exactly
`terminal` and `conversation`; the default is Terminal. Headless and read-only sessions resolve Conversation.
The storage key includes the current project scope, so one browser's choice for project A cannot affect project B;
browser storage remains optional, with the same live in-memory result while unavailable.

Resource surfaces are ordinary session object tabs whose identity is their canonical address. The plus picker and
tab deduplication form the complete open list; closing a resource closes that tab and its warm preview, while the
session's terminal/PTY remains untouched. A new posted web resource never becomes visible automatically: it adds
an unread signal, and only clicking that signal navigates to the resource address.
