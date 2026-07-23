---
title: mobile-ui
status: active
session: e335f3af-0695-488c-b12e-5fd1299e8b6a
hue: 210
desc: The phone-sized face of the board — a touch drill-down of the spec tree plus the shared TimelineChat terminal-free session surface, reusing the same polled data and API routes as the desktop.
code:
  - spec-dashboard/src/MobileApp.jsx#MobileApp
  - spec-dashboard/src/MobileApp.jsx#MobileSessionDetail
  - spec-dashboard/src/MobileApp.jsx#MobileNewSession
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/useIsMobile.js
---
# mobile-ui

The desktop board is a zoomable canvas walked with vim keys, chords, and hover popovers —
instruments a phone has no pointer or keyboard for. So a narrow viewport gets a separate,
touch-first face rather than a squeezed graph. The choice is viewport width alone (a media
query, reactive so a rotate or resize flips it with no reload); both faces read the one polled
board, so nothing about the data or the backend forks. The phone face is its **own lazy chunk**
([[dashboard-shell]]): a phone downloads none of the desktop's graph/terminal/annotator libraries.

**Not a degraded desktop — a purpose-built terminal-free surface.** Pane-backed sessions keep their
desktop TUI. A headless session has no pane at any liveness, so both a phone and the desktop console
render the persisted **[[session-timeline]]**: declaration notes are the agent's replies, and status
transitions plus delivered prompts are the conversation. The chat body is one shared
**`TimelineChat`** component (timeline poll + board-push refresh + send-then-refresh,
`replyVia:"note"` fixed); `MobileSessionDetail` is only the phone wrapper around it (identity card,
back control, and eval entry). Viewport width changes chrome and layout, never the conversation model.

**The review and Settings pages are the SAME routed pages, reflowed — never a phone clone.** The phone honors the
[[side-nav]] route family: a `#/evals`/`#/issues` address (list or detail) opened at phone width renders
the SAME [[evals-view]]/[[issues-view]] components and their current [[paged-review]] request inside the phone shell, restacked by [[review-chrome]]'s
one-column reflow (side metadata above the main column — GitHub's own 390px order); the tab bar grows an
Evals and an Issues entry (tapping navigates the route, the active page lights its tab), and Back is the
browser's history exactly as on desktop. A direct `#/settings` address mounts the same [[settings]] page
and [[page-scroll]] above that tab bar even though Settings is not a fifth primary tab. Specs/Sessions
stay the phone-local planes below.

**One API, never its own.** Every read/write the phone makes is a route the desktop already
uses, through the shared `data.js` helpers: the pushed/polled lean board for both planes, the paged
Issues/Evals list endpoints only while their route is open, the
`/api/specs/:id/*` panes (content/history/issues/evals — the SAME React pane components, no second
markdown or diff renderer), `/api/sessions/:id` + `/timeline` for the conversation, and the ONE
`/api/sessions/:id/input` route for sending. The shared terminal-free bit rides that same route as
a flag (`replyVia:"note"`); it describes the session's reply channel, not the viewport, and its
transport phrase lives server-side ([[session-timeline]]).

The two planes, made native to touch:

- **Specs** — the graph becomes a drill-down. A breadcrumb names where you are; tapping a row
  descends into that node. Each node screen is a compact header over the SAME reading panes the
  desktop popup renders. A branch opens to its children first; a leaf opens to its spec.
- **Sessions** — the list IS the desktop console's list: the same zone partition, the same nesting
  forest with fold rails/pods, and the ONE shared avatar-less SessionRow face (colour-coded status
  glyph + live headline) — no mobile-only variant, no second implementation; only the wrapper row
  is touch-sized. Opening one is the terminal-free conversation: a header (current status +
  liveness are the board row's, present-tense), the timeline — day-separated, each status event a
  colored glyph + word + timestamp with the FULL note text beneath, each sent prompt attributed
  (you / the sending session) — and a docked composer whose input and send action share one stable
  vertical box (matching top and bottom edges). The composer stops at the tab bar; `.m-tabbar` alone
  owns the viewport-bottom safe-area inset. Every dispatch from this surface carries
  `replyVia:"note"` SILENTLY — a terminal-free reader can only ever see declaration notes, so
  the reply channel is the surface's fixed property, never a per-message option and never a visible
  control. The note itself is produced when the agent executes the external `spex session <verb>
  --note` CLI; turn-boundary hooks only remind the agent and carry no note data. The
  timeline's pending state reads the GENERIC loading word — never another surface's loading phrase
  (it once borrowed the graph HUD's "loading specs from git…", which read as a wrong screen). The
  detail keeps the conversation tab-less — header, timeline, composer; no tab row spends a line on
  a list a phone reader never used — but the header carries ONE compact **eval** entry: a DOOR that is
  a REAL anchor to the session-scoped Evals list (`#/evals?q=is:eval scope:<id>`, the
  [[address-routing]] projection as its literal href — one ordinary hash push;
  [[session-eval]] — gates strip,
  blind spots, ✦-marked own readings, inherited baseline), the same canonical pages the desktop uses,
  lazily loaded and reflowed to one column. And the conversation is DEEP-LINKABLE: a `#/sessions/<id>`
  address (a shared link, or the scoped eval pages' terminal door — [[evals-view]]) opens that session's
  conversation on a cold phone load, one-way route→state — leaving the detail via its back control is
  phone-local and never rewrites the hash. Reading the measured loss is exactly what a
  phone reviewer needs; ACTING on it (merge/close) stays desktop scope. When the session adapter's
  `messageStream` capability is true, the same header also exposes a **full process** door to the
  native [[message-stream]] view; the capability comes from adapter data, so claude-headless is the
  current provider and all other harnesses omit the door. The scroller is chat-shaped
  but respects the thumb: it opens pinned to the newest entry and follows new ones ONLY while the
  reader is already at the bottom — a reader parked up in history is never yanked down by the
  poll (an unchanged poll answer keeps the old array identity, so nothing re-renders at all).
  Offline shows an honest can't-deliver hint; a failed send fails loud, keeping the draft.
- **Create** — a touch row above the list opens a full-screen composer: the desktop New Session
  tab's phone twin, with ALL substance shared through the one launch path (`launch.js`, split out
  of the desktop console for exactly this reuse): the raw `/preset [[node]]…` grammar request (resolved by
  [[launch]]'s backend owner for every caller), the
  launcher fetch + default resolution + the per-browser remembered launcher choice, so phone and
  desktop agree — and the one `POST /api/sessions`. Launching has one choice — the launcher — and every
  configured profile appears as an ordinary option, with no capability filtering, disabled
  compatibility row, or placeholder. Only the chrome is phone-shaped — textarea, native launcher
  `<select>`, one launch button.
  Where the desktop box fires in the
  background and stays type-ready, the phone AWAITS the create with a busy button: the wait is
  honest (worktree+agent take seconds) and busy-gating doubles as the double-tap guard a touch
  surface needs. Success returns to the list, where the new row lands on the next board push; a
  failed create keeps the draft and fails loud. The draft itself lives above the plane, so a peek
  at the specs tab never loses a half-typed prompt.

It answers "what does the tree say", "what are my agents doing", "talk to them", "start one", and
"what did one actually measure" — from a phone. Merge/close and the live pane stay with the desktop
board: acting on proposals is the manager cockpit's job, a deliberate scope line.

This node's slice of the shared `styles.css` is the narrow-viewport mobile face; classes other surfaces
add there — most recently the eval tab's `.eval-*` verdict/transcript rules from the measure-and-score
reframe — are those features' churn, not mobile-ui's drift.
