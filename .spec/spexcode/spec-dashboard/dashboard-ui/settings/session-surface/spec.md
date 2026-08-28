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

**Two of those four faces are BASE surfaces; the other two are overlays of a base.** Terminal and Conversation
are the only values this store will accept or return — a diff or resource face can be addressed, but it can
never become what a bare session address resolves to, and no gesture may write one here. That asymmetry is the
whole reason an overlay needs a door back: entering one must not be able to redefine where "the session"
is, so leaving one is always the bare address and always lands on the reader's own base. A door that only
opens is how a surface becomes a trap.

This store owns only that bare-address base default, not session state or resource selection. Its scoped
localStorage payload contains a default and explicit per-session base overrides. Valid stored values are exactly
`terminal` and `conversation`; anything else is rejected on write and dropped on read, so a corrupted or
hand-edited payload cannot pin a session to an overlay. The default is Conversation — the terminal-free face
every harness and every lifecycle state can show — and Terminal is a pane-backed session's opt-in, chosen per
session or as the browser's own default. Headless and read-only sessions always resolve Conversation.

The base-surface predicate is an implementation detail of this store. It is not a second public mechanism: callers
use the address-level `isSessionSurface` contract or the read/write functions above, and the module exposes no
standalone base-only compatibility alias.

The storage key includes the current project scope, so one browser's choice for project A cannot affect project B;
browser storage remains optional, with the same live in-memory result while unavailable.

**What is MOUNTED follows the resolved surface, not the stored preference.** The console mounts a session's
conversation whenever the resolved face is Conversation — which the address can decide on its own. Gating the
mount on the stored base instead is what made `?surface=conversation` render an empty pane on a session whose
stored base was Terminal: the terminal layer hidden, the conversation layer never created, and with it the
composer that is the human's only way to speak to that session. The store answers ONE question — what does a
bare address mean — and it must not also be consulted for what is on screen.

Resource surfaces are file-class workspace tabs whose identity is their canonical resource address. The plus
picker and tab deduplication form the complete resource open list; opening one appends beside the session tab
instead of replacing its Terminal/Conversation face. Closing a resource closes that tab and its warm preview,
while the session's terminal/PTY and base-surface preference remain untouched. A new posted web resource never
becomes visible automatically: it adds an unread signal, and only clicking that signal navigates to the resource
address.

**Every overlay has a return leg, and it is the same address in every case.** Esc from a resource, Esc from
the diff, and pressing the diff door while it is lit all navigate to the bare `#/sessions/<id>`. The diff door
is therefore one control in two states rather than an open-only door that disappears once used: it stays in the
actions slot on the diff face, lit, and says it will leave. The tab strip and the finding dock remain the other
ways back, but neither is guaranteed to be showing — a deep link opens exactly one tab, and the dock may be
closed or in its explorer projection — so the surface itself must carry an exit.
