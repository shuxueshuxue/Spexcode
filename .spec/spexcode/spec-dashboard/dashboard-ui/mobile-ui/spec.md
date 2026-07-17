---
title: mobile-ui
status: active
session: e335f3af-0695-488c-b12e-5fd1299e8b6a
hue: 210
desc: The phone-sized face of the board — a touch drill-down of the spec tree plus a TERMINAL-FREE session surface (the persisted timeline as the conversation, a composer that asks for note replies), reusing the same polled data, the same API routes, and the same panes as the desktop.
code:
  - spec-dashboard/src/MobileApp.jsx#MobileApp
  - spec-dashboard/src/MobileApp.jsx#MobileSessionDetail
  - spec-dashboard/src/MobileApp.jsx#MobileNewSession
related:
  - spec-dashboard/src/App.jsx
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

**Not a degraded desktop — a different interaction mode: the terminal-free mode.** The desktop's
session surface is a live pane; the phone deliberately mounts none. What replaces it is the
persisted **[[session-timeline]]**: without a pane, the agent's declaration notes ARE its replies,
and the timeline of status transitions + delivered prompts IS the conversation. The mode is
phone-first but not phone-bound — any surface could opt into it later.

**One API, never its own.** Every read/write the phone makes is a route the desktop already
uses, through the shared `data.js` helpers: the pushed/polled board for both planes, the
`/api/specs/:id/*` panes (content/history/issues/evals — the SAME React pane components, no second
markdown or diff renderer), `/api/sessions/:id` + `/timeline` for the conversation, and the ONE
`/api/sessions/:id/input` route for sending. The sole phone-flavored bit rides that same route as
a flag (`replyVia:"note"`), and even its phrase lives server-side ([[session-timeline]]).

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
  (you / the sending session) — and a docked composer. Every dispatch from this surface carries
  `replyVia:"note"` SILENTLY — a terminal-free reader can only ever see declaration notes, so
  asking for the reply there is the surface's fixed property, never a per-message option and never
  a visible control (an earlier toggle chip read as unexplained noise and was deleted). The
  timeline's pending state reads the GENERIC loading word — never another surface's loading phrase
  (it once borrowed the graph HUD's "loading specs from git…", which read as a wrong screen). The
  detail keeps the conversation tab-less — header, timeline, composer; no tab row spends a line on
  a list a phone reader never used — but the header carries ONE compact **eval** entry that flips
  the detail to the session's evaluation: the SAME SessionEvalPane the desktop console's Eval tab
  mounts ([[session-eval]] — gates strip, blind spots, ✦-marked own readings, inherited baseline),
  loaded lazily (a phone that never opens it never downloads the eval family) and restacked by CSS
  to one column at thumb width — master list above, detail below, the desktop fold toggle hidden
  (stacking already gives the detail the full width). Reading the measured loss is exactly what a
  phone reviewer needs; ACTING on it (merge/close) stays desktop scope. The scroller is chat-shaped
  but respects the thumb: it opens pinned to the newest entry and follows new ones ONLY while the
  reader is already at the bottom — a reader parked up in history is never yanked down by the
  poll (an unchanged poll answer keeps the old array identity, so nothing re-renders at all).
  Offline shows an honest can't-deliver hint; a failed send fails loud, keeping the draft.
- **Create** — a touch row above the list opens a full-screen composer: the desktop New Session
  tab's phone twin, with ALL substance shared through the one launch path (`launch.js`, split out
  of the desktop console for exactly this reuse): the `/preset [[node]]…` grammar composition, the
  launcher fetch + default resolution + the per-browser remembered picks — launcher AND session
  mode, one localStorage key per axis, so phone and desktop agree, with [[launcher-select]]'s
  illegal-combo fallback surfacing its notice here too — and the one `POST /api/sessions`. Only
  the chrome is phone-shaped — textarea, the shared session-mode toggle at touch size
  ([[launcher-select]]'s ⌨/◇ switch, the same component the desktop pop card mounts), native
  launcher `<select>` (an option the armed mode can't launch is disabled), one launch button.
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
